import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTranscript, handoff } from '../src/connectors.mjs';
import { Store } from '../src/store.mjs';
import { LAN, seal, unseal, privateAddress } from '../src/lan.mjs';
import { createApp } from '../src/server.mjs';

const device = { id: 'device-a', name: 'Work desktop', platform: 'win32' };
const fixture = name => fs.readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentbridge-test-'));
const generic = text => JSON.stringify({ tool: 'vscode', id: text, projectPath: '/projects/app', messages: [{ role: 'user', content: text }] });

test('Claude parser retains conversation, metadata, raw data and tool results without inventing user messages', () => {
  const raw = fixture('claude.jsonl'); const s = parseTranscript(raw, 'claude.jsonl', device);
  assert.equal(s.tool, 'claude'); assert.equal(s.messages.length, 3); assert.equal(s.events.length, 1);
  assert.equal(s.events[0].output, 'export function validateToken() {}'); assert.equal(s.branch, 'feature/auth');
  assert.equal(s.nativeId, '11111111-2222-4333-8444-555555555555'); assert.equal(s.raw, raw); assert.equal(s.shared, false);
});
test('Codex parser avoids duplicated event messages and connects tool results', () => {
  const s = parseTranscript(fixture('codex.jsonl'), 'rollout.jsonl', device);
  assert.equal(s.tool, 'codex'); assert.equal(s.messages.length, 2); assert.equal(s.events.length, 1);
  assert.equal(s.events[0].output, 'Token bucket implementation'); assert.equal(s.commit, 'abcdef');
});
test('OpenCode JSON exports preserve text, tools and project metadata', () => {
  const s = parseTranscript(fixture('opencode.json'), 'export.json', device);
  assert.equal(s.tool, 'opencode'); assert.equal(s.title, 'Add search'); assert.equal(s.messages.length, 2);
  assert.equal(s.events[0].output, 'List source'); assert.equal(s.projectName, 'studio');
});
test('Generic exports and AgentBridge round trips are supported', () => {
  const s = parseTranscript(generic('Implement search'), 'editor.json', device);
  const p = parseTranscript(JSON.stringify({ format: 'agentbridge-session-v1', session: s }), 'package.json', { ...device, id: 'device-b' });
  assert.equal(p.messages[0].text, 'Implement search'); assert.equal(p.originDevice, 'device-b'); assert.equal(p.sourcePath, '');
  assert.match(handoff(s, 'Codex'), /Destination: Codex/); assert.match(handoff(s), /does not restore native agent state/);
});
test('Parser accepts an incomplete live tail, rejects malformed middle records and unsupported exports', () => {
  assert.equal(parseTranscript(`${fixture('claude.jsonl')}\n{"unfinished":`, 'live.jsonl', device).messages.length, 3);
  assert.throws(() => parseTranscript(`${fixture('claude.jsonl')}\nwrong\n{}`, 'bad.jsonl', device), /Invalid JSONL/);
  assert.throws(() => parseTranscript('{"hello":true}', 'unknown.json', device), /No supported messages/);
  assert.throws(() => parseTranscript('x'.repeat(17 * 1024 * 1024), 'large.json', device), /16 MB/);
});
test('Storage survives restart and preserves local annotations across transcript updates', () => {
  const directory = temporary();
  try {
    const store = new Store(directory, 'Test'); const s = parseTranscript(generic('Task'), 'task.json', store.state.device);
    store.upsert(s); store.state.sessions[0].starred = true; store.state.sessions[0].note = 'Next step'; store.state.sessions[0].shared = true; store.save();
    store.upsert({ ...s, raw: 'updated', fingerprint: 'updated' });
    const restored = new Store(directory);
    assert.equal(restored.state.sessions[0].starred, true); assert.equal(restored.state.sessions[0].note, 'Next step');
    assert.equal(restored.state.sessions[0].shared, true); assert.equal(restored.state.sessions[0].raw, 'updated');
    assert.equal(JSON.stringify(restored.publicState()).includes('"raw"'), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('Encryption authenticates key, purpose and content; only literal private IPv4 addresses are accepted', () => {
  const packet = seal('secret', { transcript: 'private conversation' }, 'sync');
  assert.deepEqual(unseal('secret', packet, 'sync'), { transcript: 'private conversation' });
  assert.equal(JSON.stringify(packet).includes('private conversation'), false);
  assert.throws(() => unseal('wrong', packet, 'sync')); assert.throws(() => unseal('secret', packet, 'pair'));
  assert.throws(() => unseal('secret', { ...packet, data: 'bad' }, 'sync'));
  for (const ip of ['192.168.1.10', '10.0.0.2', '172.16.0.5', '127.0.0.1']) assert.equal(privateAddress(ip), true);
  for (const host of ['8.8.8.8', 'example.com', '169.254.1.1', '172.32.0.1']) assert.equal(privateAddress(host), false);
});
test('Two independent devices pair, exchange only selected sessions, update and revoke access', async () => {
  const da = temporary(), db = temporary();
  const a = new Store(da, 'Desktop'), b = new Store(db, 'Laptop');
  const la = new LAN(a, { port: 0, host: '127.0.0.1' }), lb = new LAN(b, { port: 0, host: '127.0.0.1' });
  try {
    await la.start(); await lb.start();
    const publicSession = parseTranscript(generic('Shared work'), 'shared.json', a.state.device); publicSession.shared = true;
    a.upsert(publicSession); a.upsert(parseTranscript(generic('Private work'), 'private.json', a.state.device));
    const localB = parseTranscript(generic('Laptop task'), 'task.json', b.state.device); localB.shared = true; b.upsert(localB);
    const invitation = la.invite();
    await lb.pair({ host: '127.0.0.1', port: la.port, code: invitation.code, invitationId: invitation.id });
    assert.equal(a.state.peers.length, 1); assert.equal(b.state.peers.length, 1);
    assert.equal(b.state.sessions.some(s => s.title === 'Shared work'), true); assert.equal(b.state.sessions.some(s => s.title === 'Private work'), false);
    assert.equal(a.state.sessions.some(s => s.title === 'Laptop task'), true);
    const remote = b.state.sessions.find(s => s.title === 'Shared work'); assert.equal(remote.sourcePath, ''); assert.equal(remote.shared, false);
    assert.equal(lb.shared().length, 1);
    await assert.rejects(() => lb.pair({ host: '127.0.0.1', port: la.port, code: invitation.code, invitationId: invitation.id }));
    a.state.sessions.find(s => s.id === publicSession.id).note = 'Source next step'; a.save(); await lb.syncAll();
    assert.equal(b.state.sessions.find(s => s.id === publicSession.id).note, 'Source next step');
    b.state.sessions.find(s => s.id === publicSession.id).note = 'Laptop personal note'; b.save();
    a.state.sessions.find(s => s.id === publicSession.id).note = 'Updated source note'; a.save(); await lb.syncAll();
    assert.equal(b.state.sessions.find(s => s.id === publicSession.id).note, 'Laptop personal note');
    const s = a.state.sessions.find(s => s.id === publicSession.id); s.raw = 'updated transcript'; s.fingerprint = 'version-2'; a.save();
    await lb.syncAll(); assert.equal(b.state.sessions.find(s => s.id === publicSession.id).raw, 'updated transcript');
    b.state.sessions.find(s => s.id === publicSession.id).note = ''; b.save();
    s.shared = false; a.save(); await lb.syncAll(); assert.equal(b.state.sessions.some(s => s.id === publicSession.id), false);
    a.state.peers = []; a.save(); const results = await lb.syncAll(); assert.equal(results[0].ok, false);
  } finally { await la.close(); await lb.close(); fs.rmSync(da, { recursive: true, force: true }); fs.rmSync(db, { recursive: true, force: true }); }
});
test('Replay packets and forged origin identities are rejected', () => {
  const directory = temporary(); const store = new Store(directory); const lan = new LAN(store, { port: 0 });
  try {
    lan.checkReplay('a', 'nonce'); assert.throws(() => lan.checkReplay('a', 'nonce'), /Duplicate/);
    const s = parseTranscript(generic('Task'), 'task.json', device);
    assert.throws(() => lan.receive([s], { ...device, id: 'device-b' }), /Invalid session/);
    assert.throws(() => lan.receive([{ ...s, messages: [{ role: 'user', text: {}, timestamp: 'now' }] }], device), /Invalid message/);
    assert.equal(store.state.sessions.length, 0);
  } finally { clearInterval(lan.timer); fs.rmSync(directory, { recursive: true, force: true }); }
});
test('Local control API requires authentication, rejects foreign origins and provides import/search/export/handoff', async () => {
  const directory = temporary(); const app = await createApp({ dataDir: directory, lanPort: 0 });
  const origin = new URL(app.url).origin;
  const call = async (route, method = 'GET', body) => { const res = await fetch(`${origin}/api/${route}`, { method, headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, data: await res.json() }; };
  try {
    assert.equal((await fetch(`${origin}/api/state`)).status, 401);
    assert.equal((await fetch(`${origin}/api/state`, { headers: { Authorization: `Bearer ${app.token}`, Origin: 'https://untrusted.example' } })).status, 403);
    const response = await call('import', 'POST', { filename: 'claude.jsonl', content: fixture('claude.jsonl') }); assert.equal(response.status, 200);
    const id = encodeURIComponent(response.data.id);
    const search = await call('search?q=expiry'); assert.equal(search.data.ids.length, 1);
    const info = await call(`sessions/${id}/inspect`); assert.equal(info.data.nativeAvailable, false);
    const exported = await call(`sessions/${id}/export`); assert.equal(exported.data.format, 'agentbridge-session-v1');
    const transfer = await call(`sessions/${id}/handoff?target=OpenCode`); assert.match(transfer.data.content, /Destination: OpenCode/);
    await call('demo', 'POST'); const data = await call('state'); const sample = data.data.sessions.find(s => s.demo);
    assert.equal((await call(`sessions/${encodeURIComponent(sample.id)}`, 'PATCH', { shared: true })).status, 400);
    await call('settings', 'PATCH', { lanEnabled: true }); assert.equal((await call('state')).data.lan.enabled, true);
    await call('settings', 'PATCH', { lanEnabled: false }); assert.equal((await call('state')).data.lan.enabled, false);
  } finally { await app.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
test('Scan imports fixture directories only and offers native resume only for original local files', async () => {
  const directory = temporary(); const oldClaude = process.env.CLAUDE_CONFIG_DIR, oldCodex = process.env.CODEX_HOME;
  const claudeRoot = path.join(directory, 'claude'), codexRoot = path.join(directory, 'codex'), project = path.join(directory, 'project');
  fs.mkdirSync(path.join(claudeRoot, 'projects', 'project'), { recursive: true }); fs.mkdirSync(path.join(codexRoot, 'sessions'), { recursive: true }); fs.mkdirSync(project);
  fs.writeFileSync(path.join(claudeRoot, 'projects', 'project', 'session.jsonl'), fixture('claude.jsonl').replace('/projects/example-api', project));
  fs.writeFileSync(path.join(codexRoot, 'sessions', 'session.jsonl'), fixture('codex.jsonl'));
  process.env.CLAUDE_CONFIG_DIR = claudeRoot; process.env.CODEX_HOME = codexRoot;
  let app;
  try {
    app = await createApp({ dataDir: path.join(directory, 'state'), lanPort: 0 });
    const result = await app.scan(); assert.equal(result.changed, 2); assert.equal((await app.scan()).changed, 0);
    const s = app.store.state.sessions.find(s => s.tool === 'claude');
    const response = await fetch(`${new URL(app.url).origin}/api/sessions/${encodeURIComponent(s.id)}/inspect`, { headers: { Authorization: `Bearer ${app.token}` } });
    const checks = await response.json(); assert.equal(checks.nativeAvailable, true); assert.match(checks.command, /claude --resume/);
    assert.equal(fs.readFileSync(s.sourcePath, 'utf8').includes('Fix the expired token'), true);
  } finally {
    if (app) await app.close();
    if (oldClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = oldClaude;
    if (oldCodex === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = oldCodex;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

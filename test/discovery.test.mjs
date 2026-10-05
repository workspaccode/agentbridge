import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { sourceCandidates, discoverSources, expandScanPath } from '../src/discovery.mjs';
import { scanSource } from '../src/readers.mjs';
import { parseTranscript } from '../src/connectors.mjs';
import { createApp } from '../src/server.mjs';
import { Store } from '../src/store.mjs';
import { LAN } from '../src/lan.mjs';

const device = { id: 'fixture-device', name: 'Fixture workstation', platform: 'darwin' };
const timestamp = '2026-10-05T07:00:00Z';
const when = Date.parse(timestamp);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentbridge-discovery-'));
const write = (folder, relative, content) => { const filename = path.join(folder, relative); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, typeof content === 'string' ? content : JSON.stringify(content)); return filename; };
const copilot = () => ({ version: 3, sessionId: 'copilot-1', creationDate: when, customTitle: 'Fix the search panel', requests: [{ timestamp: when, message: { text: 'Fix <script>window.injected = true</script>' }, response: [{ value: 'Fixed the empty search results.' }, { kind: 'toolInvocationSerialized', toolId: 'readFile', toolSpecificData: { path: 'app.js' }, resultDetails: 'Read 20 lines' }] }] });
const apiHistory = () => [{ role: 'user', content: [{ type: 'text', text: 'Repair login' }] }, { role: 'assistant', content: [{ type: 'text', text: 'Checking the handler' }, { type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'login.js' } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: [{ type: 'text', text: 'return login()' }] }] }];
const gemini = () => ({ sessionId: 'gemini-1', projectHash: 'project-hash', startTime: timestamp, lastUpdated: timestamp, messages: [{ id: 'u1', type: 'user', timestamp, content: [{ text: 'Add tests' }] }, { id: 'a1', type: 'gemini', timestamp, content: [{ text: 'Added tests' }], toolCalls: [{ id: 't1', name: 'run_tests', args: { command: 'npm test' }, result: [{ text: 'Passing' }] }] }] });
const source = (root, tool, kind = tool) => ({ id: `test-${tool}`, tool, kind, root, host: '', scope: '', label: tool, status: 'ready', detected: true });

test('Windows paths honor APPDATA/USERPROFILE and CLI overrides without guessing macOS conventions', () => {
  const home = 'C:\\Users\\Ali';
  const env = { APPDATA: 'D:\\Roaming', CLAUDE_CONFIG_DIR: 'D:\\Claude', CODEX_HOME: 'D:\\Codex', GEMINI_CLI_HOME: 'D:\\GeminiHome', XDG_DATA_HOME: 'D:\\Data', OPENCODE_DB: 'custom.db', VSCODE_PORTABLE: 'D:\\Portable' };
  const sources = sourceCandidates({ platform: 'win32', home, env });
  assert.ok(sources.some(s => s.root === 'D:\\Roaming\\Code\\User'));
  assert.ok(sources.some(s => s.root === 'D:\\Roaming\\Cursor\\User\\globalStorage\\saoudrizwan.claude-dev\\tasks'));
  assert.ok(sources.some(s => s.root === 'D:\\Claude\\projects'));
  assert.ok(sources.some(s => s.root === 'D:\\Codex\\archived_sessions'));
  assert.ok(sources.some(s => s.root === 'D:\\GeminiHome\\.gemini\\tmp'));
  assert.ok(sources.some(s => s.root === 'D:\\Data\\opencode\\custom.db'));
  assert.ok(sources.some(s => s.root === 'D:\\Portable\\user-data\\User'));
  assert.ok(sourceCandidates({ platform: 'win32', home, env: {} }).some(s => s.root === `${home}\\AppData\\Roaming\\Code\\User`));
});
test('macOS and Linux paths, named profiles and custom directories are discovered', () => {
  const mac = sourceCandidates({ platform: 'darwin', home: '/Users/Ali', env: {} });
  assert.ok(mac.some(s => s.root === '/Users/Ali/Library/Application Support/Code - Insiders/User'));
  assert.ok(mac.some(s => s.root === '/Users/Ali/.local/share/opencode'));
  assert.ok(sourceCandidates({ platform: 'linux', home: '/home/a', env: { XDG_CONFIG_HOME: '/cfg' } }).some(s => s.root === '/cfg/VSCodium/User'));
  const folder = tmp();
  try {
    write(folder, 'custom/User/profiles/p1/globalStorage/rooveterinaryinc.roo-cline/tasks/r1/api_conversation_history.json', apiHistory());
    const discovered = discoverSources({ platform: process.platform, home: folder, env: {}, scanPaths: { vscode: [path.join(folder, 'custom/User')] } });
    assert.ok(discovered.some(s => s.tool === 'roo' && s.label.includes('profile p1') && s.detected));
    assert.ok(discovered.some(s => s.tool === 'claude' && !s.detected && s.status === 'not-found'));
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
test('custom paths expand environment variables safely and reject relative/control/missing-variable input', () => {
  assert.equal(expandScanPath('%appdata%\\Code\\User', { platform: 'win32', home: 'C:\\Users\\A', env: { APPDATA: 'D:\\Roaming' } }), 'D:\\Roaming\\Code\\User');
  assert.equal(expandScanPath('~/.gemini/tmp', { platform: 'darwin', home: '/Users/A', env: {} }), '/Users/A/.gemini/tmp');
  assert.equal(expandScanPath('${CUSTOM}/sessions', { platform: 'linux', home: '/a', env: { CUSTOM: '/data' } }), '/data/sessions');
  for (const value of ['relative/path', '/path\nattack', '$MISSING/sessions']) assert.throws(() => expandScanPath(value, { platform: 'linux', home: '/a', env: {} }));
  assert.throws(() => expandScanPath('\\Code', { platform: 'win32', env: {} }));
});
test('Copilot JSON and mutation logs reconstruct text, tools, edits and portable project URIs', () => {
  const initial = copilot(); initial.workingDirectory = 'file:///C:/Projects/search';
  const raw = JSON.stringify(initial);
  const session = parseTranscript(raw, 'copilot.json', device);
  assert.equal(session.tool, 'vscode'); assert.equal(session.projectPath, 'C:\\Projects\\search');
  assert.equal(session.messages.length, 2); assert.equal(session.events[0].name, 'readFile');
  const log = [{ kind: 0, v: initial }, { kind: 1, k: ['requests', 0, 'response', 0, 'value'], v: 'Updated answer' }, { kind: 2, k: ['requests'], v: [{ timestamp: when + 1000, message: { text: 'Second question' }, response: ['Second answer'] }] }, { kind: 3, k: ['customTitle'] }].map(r => JSON.stringify(r)).join('\n');
  const replayed = parseTranscript(log + '\n{"kind":', 'copilot.jsonl', device);
  assert.deepEqual(replayed.messages.map(m => m.text), [initial.requests[0].message.text, 'Updated answer', 'Second question', 'Second answer']);
  assert.equal(replayed.nativeId, 'copilot-1'); assert.equal(replayed.raw, log + '\n{"kind":');
});
test('Copilot mutation logs reject prototype pollution, nonexistent targets and excessive array lengths', () => {
  for (const operation of [{ kind: 1, k: ['__proto__', 'polluted'], v: true }, { kind: 1, k: ['constructor', 'prototype', 'polluted'], v: true }, { kind: 2, k: ['requests'], i: 1000000000 }, { kind: 1, k: ['requests', 'length'], v: 1000000000 }, { kind: 1, k: ['requests', 0, 'response', '1000000000'], v: 'x' }, { kind: 1, k: ['missing', 'value'], v: 'x' }, { kind: 99 }]) {
    assert.throws(() => parseTranscript([JSON.stringify({ kind: 0, v: copilot() }), JSON.stringify(operation)].join('\n'), 'bad.jsonl', device));
  }
  assert.equal({}.polluted, undefined);
});
test('Gemini JSON and JSONL replay patches, rewinds, metadata and tool results without duplicates', () => {
  const initial = gemini(); const json = parseTranscript(JSON.stringify(initial), 'gemini.json', device);
  assert.equal(json.tool, 'gemini'); assert.equal(json.events[0].output, JSON.stringify([{ text: 'Passing' }], null, 2));
  const records = [{ sessionId: initial.sessionId, projectHash: initial.projectHash, startTime: timestamp }, ...initial.messages, { $patch: { id: 'a1', content: [{ text: 'Patched answer' }], toolCalls: [{ id: 't1', result: [{ text: 'Updated test output' }] }] } }, { id: 'u2', type: 'user', content: 'Abandoned', timestamp }, { $rewindTo: 'u2' }, { $set: { summary: 'Test suite', lastUpdated: timestamp } }];
  const replayed = parseTranscript(records.map(r => JSON.stringify(r)).join('\n'), 'gemini.jsonl', device);
  assert.equal(replayed.title, 'Test suite'); assert.deepEqual(replayed.messages.map(m => m.text), ['Add tests', 'Patched answer']);
  assert.match(replayed.events[0].output, /Updated test output/); assert.equal(replayed.nativeId, 'gemini-1');
});
test('Cline/Roo histories preserve tool results and keep sessions in different editors distinct', () => {
  const raw = JSON.stringify(apiHistory());
  const context = { tool: 'roo', nativeId: 'task-1', timestamp, host: 'VS Code', identityScope: 'VS Code' };
  const a = parseTranscript(raw, 'api_conversation_history.json', device, '/tasks/task-1/file.json', context);
  const b = parseTranscript(raw, 'api_conversation_history.json', device, '/cursor/task-1/file.json', { ...context, host: 'Cursor', identityScope: 'Cursor' });
  assert.equal(a.tool, 'roo'); assert.equal(a.messages.length, 2); assert.equal(a.events[0].output, 'return login()'); assert.notEqual(a.id, b.id);
  assert.equal(a.updatedAt, new Date(timestamp).toISOString()); assert.equal(b.sourceHost, 'Cursor');
});
test('scanner reads Copilot workspace/empty-window chats, prefers JSONL and skips credentials, symlinks and malformed files', async () => {
  const folder = tmp();
  try {
    const root = path.join(folder, 'User');
    write(root, 'workspaceStorage/ws/workspace.json', { folder: 'file:///projects/search' });
    const legacy = write(root, 'workspaceStorage/ws/chatSessions/copilot-1.json', copilot());
    write(root, 'workspaceStorage/ws/chatSessions/copilot-1.jsonl', JSON.stringify({ kind: 0, v: copilot() }) + '\n');
    write(root, 'globalStorage/emptyWindowChatSessions/other.json', { ...copilot(), sessionId: 'copilot-2' });
    write(root, 'globalStorage/unrelated/auth.json', { messages: [{ role: 'user', content: 'DO NOT READ' }] });
    write(root, 'workspaceStorage/ws/chatSessions/broken.json', '{malformed');
    const big = write(root, 'workspaceStorage/ws/chatSessions/large.json', ''); fs.truncateSync(big, 17 * 1024 * 1024);
    try { fs.symlinkSync(legacy, path.join(root, 'workspaceStorage/ws/chatSessions/link.json')); } catch (e) { if (!['EPERM', 'EACCES'].includes(e.code)) throw e; }
    const sessions = []; const report = await scanSource(source(root, 'vscode'), device, s => { sessions.push(s); return true; });
    assert.equal(sessions.length, 2); assert.equal(report.read, 2); assert.equal(report.skipped, 2); assert.equal(report.status, 'partial');
    assert.equal(sessions.find(s => s.nativeId === 'copilot-1').projectPath, '/projects/search');
    assert.equal(sessions.some(s => s.raw.includes('DO NOT READ')), false); assert.equal(sessions.some(s => s.sourcePath === legacy), false);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
test('OpenCode legacy stores assemble a stable export and reject path traversal in native IDs', async () => {
  const folder = tmp();
  try {
    write(folder, 'storage/session/project/ses_1.json', { id: 'ses_1', title: 'Legacy', directory: '/projects/app', time: { created: when, updated: when } });
    write(folder, 'storage/message/ses_1/msg_1.json', { id: 'msg_1', role: 'user', time: { created: when } });
    write(folder, 'storage/part/msg_1/prt_1.json', { id: 'prt_1', type: 'text', text: 'Legacy prompt' });
    write(folder, 'storage/session/project/bad.json', { id: '../../auth' });
    write(folder, 'auth.json', { secret: 'DO_NOT_READ_AUTH_FILE' });
    const sessions = []; const report = await scanSource(source(folder, 'opencode'), device, s => { sessions.push(s); return true; });
    assert.equal(report.read, 1); assert.equal(report.skipped, 1); assert.equal(sessions[0].messages[0].text, 'Legacy prompt');
    assert.equal(sessions[0].raw.includes('DO_NOT_READ_AUTH_FILE'), false);
    assert.match(sessions[0].sourceFormat, /assembled export/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
test('OpenCode SQLite reads active WAL data and both schemas, without changing DB/WAL or exporting credential tables', async () => {
  const folder = tmp(); const filename = path.join(folder, 'opencode.db'); const db = new DatabaseSync(filename);
  const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  try {
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE session(id TEXT PRIMARY KEY,title TEXT,directory TEXT,time_created INTEGER,time_updated INTEGER); CREATE TABLE message(id TEXT,session_id TEXT,data TEXT,time_created INTEGER); CREATE TABLE part(id TEXT,message_id TEXT,session_id TEXT,data TEXT); CREATE TABLE session_message(id TEXT,session_id TEXT,type TEXT,data TEXT,time_created INTEGER,seq INTEGER); CREATE TABLE credential(secret TEXT);');
    db.prepare('INSERT INTO credential VALUES (?)').run('PRIVATE_CREDENTIAL_NOT_A_TRANSCRIPT');
    db.prepare('INSERT INTO session VALUES (?,?,?,?,?)').run('ses_1', 'V1', '/projects/app', when, when);
    db.prepare('INSERT INTO session VALUES (?,?,?,?,?)').run('ses_2', 'V2', '/projects/app', when, when);
    db.prepare('INSERT INTO message VALUES (?,?,?,?)').run('msg_1', 'ses_1', JSON.stringify({ role: 'user' }), when);
    db.prepare('INSERT INTO part VALUES (?,?,?,?)').run('prt_1', 'msg_1', 'ses_1', JSON.stringify({ type: 'text', text: 'V1 prompt' }));
    db.prepare('INSERT INTO session_message VALUES (?,?,?,?,?,?)').run('msg_2', 'ses_2', 'user', JSON.stringify({ text: 'V2 prompt' }), when, 1);
    db.prepare('INSERT INTO session_message VALUES (?,?,?,?,?,?)').run('msg_3', 'ses_2', 'assistant', JSON.stringify({ content: [{ type: 'text', text: 'V2 answer' }, { type: 'tool', name: 'read_file', state: { input: { path: 'a' }, content: [{ type: 'text', text: 'Tool output' }] } }] }), when + 1, 2);
    const before = [digest(filename), digest(`${filename}-wal`)]; const sessions = [];
    const report = await scanSource(source(folder, 'opencode'), device, s => { sessions.push(s); return true; });
    assert.equal(report.read, 2, JSON.stringify(report)); assert.deepEqual([digest(filename), digest(`${filename}-wal`)], before);
    assert.ok(sessions.some(s => s.messages[0].text === 'V1 prompt')); assert.ok(sessions.some(s => s.messages.some(m => m.text === 'V2 answer')));
    assert.equal(sessions.find(s => s.nativeId === 'ses_2').events[0].output, 'Tool output');
    assert.ok(sessions.every(s => !s.raw.includes('PRIVATE_CREDENTIAL')));
  } finally { db.close(); fs.rmSync(folder, { recursive: true, force: true }); }
});
test('API persists custom locations, scopes scans, refreshes idempotently and preserves private sharing choices', async () => {
  const folder = tmp(); let app;
  const opts = { dataDir: path.join(folder, 'state'), lanPort: 0, scanContext: { home: folder, env: {} } };
  try {
    const root = path.join(folder, 'custom/tasks'); const file = write(root, 'task-1/api_conversation_history.json', apiHistory());
    app = await createApp(opts); let origin = new URL(app.url).origin;
    const call = async (route, method = 'GET', body) => { const response = await fetch(`${origin}/api/${route}`, { method, headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: response.status, data: await response.json() }; };
    assert.equal((await fetch(`${origin}/api/scan-paths`, { method: 'PATCH', body: '{}' })).status, 401);
    assert.equal((await call('scan-paths', 'PATCH', { tool: 'roo', paths: ['relative'] })).status, 400);
    assert.equal((await call('scan-paths', 'PATCH', { tool: 'roo', paths: [root] })).status, 200);
    const result = await call('scan', 'POST', { tool: 'roo' }); assert.equal(result.data.changed, 1); assert.ok(result.data.sources.every(s => s.tool === 'roo'));
    const session = app.store.state.sessions[0]; assert.equal(session.shared, false);
    await call(`sessions/${encodeURIComponent(session.id)}`, 'PATCH', { starred: true, note: 'My note', shared: true });
    assert.equal((await call('scan', 'POST', { tool: 'roo' })).data.changed, 0);
    const content = apiHistory(); content[0].content[0].text = 'Updated prompt'; fs.writeFileSync(file, JSON.stringify(content));
    assert.equal((await call('scan', 'POST', { tool: 'roo' })).data.changed, 1);
    assert.equal(app.store.state.sessions[0].note, 'My note'); assert.equal(app.store.state.sessions[0].starred, true); assert.equal(app.store.state.sessions[0].shared, true);
    await app.close(); app = await createApp(opts); origin = new URL(app.url).origin;
    assert.deepEqual(app.store.state.settings.scanPaths.roo, [root]);
    assert.equal((await call('state')).data.connectors.find(c => c.id === 'roo').detected, true);
    assert.equal((await call('scan', 'POST', { tool: 'not-a-tool' })).status, 400);
  } finally { if (app) await app.close(); fs.rmSync(folder, { recursive: true, force: true }); }
});
test('default IDE/CLI layouts discover and read histories, archives and subagents without modifying sources', async () => {
  const folder = tmp(); let app;
  const options = { platform: process.platform, home: folder, env: {} };
  try {
    const locations = sourceCandidates(options);
    const root = (tool, kind = tool) => locations.find(s => s.tool === tool && s.kind === kind).root;
    const project = path.join(folder, 'project'); fs.mkdirSync(project);
    const claude = { type: 'user', sessionId: 'parent-session', cwd: project, timestamp, message: { role: 'user', content: 'Parent prompt' } };
    write(root('claude'), 'project/parent-session.jsonl', JSON.stringify(claude) + '\n');
    write(root('claude'), 'project/parent-session/subagents/agent-a.jsonl', JSON.stringify({ ...claude, message: { role: 'user', content: 'Subagent prompt' } }) + '\n');
    const archive = locations.find(s => s.tool === 'codex' && s.root.endsWith('archived_sessions')).root;
    write(archive, 'archive.jsonl', [{ type: 'session_meta', payload: { id: 'archive', cwd: project }, timestamp }, { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: 'Archived prompt' }] }, timestamp }].map(r => JSON.stringify(r)).join('\n'));
    write(root('gemini'), 'project-hash/chats/session.json', gemini());
    write(root('vscode'), 'workspaceStorage/ws/chatSessions/copilot.json', copilot());
    write(root('cline'), 'task-1/api_conversation_history.json', apiHistory());
    write(root('roo'), 'task-1/api_conversation_history.json', apiHistory());
    write(root('cline', 'unsupported'), 'credentials.db', 'PRIVATE_NOT_A_TRANSCRIPT');
    const historyFiles = [root('claude'), archive, root('gemini'), root('vscode'), root('cline'), root('roo')].flatMap(dir => fs.readdirSync(dir, { recursive: true }).map(name => path.join(dir, name)).filter(file => fs.statSync(file).isFile()));
    const before = historyFiles.map(file => fs.readFileSync(file, 'utf8'));
    app = await createApp({ dataDir: path.join(folder, 'state'), lanPort: 0, scanContext: options });
    const sources = discoverSources(options); assert.equal(sources.find(s => s.kind === 'unsupported').status, 'unsupported');
    const result = await app.scan(); assert.equal(result.changed, 7); assert.equal(result.errors.length, 0);
    assert.deepEqual(historyFiles.map(file => fs.readFileSync(file, 'utf8')), before);
    assert.ok(app.store.state.sessions.every(s => !s.shared && !s.raw.includes('PRIVATE_NOT_A_TRANSCRIPT')));
    const parents = app.store.state.sessions.filter(s => s.tool === 'claude'); assert.notEqual(parents[0].id, parents[1].id);
    for (const session of parents) {
      const response = await fetch(`${new URL(app.url).origin}/api/sessions/${encodeURIComponent(session.id)}/inspect`, { headers: { Authorization: `Bearer ${app.token}` } });
      const checks = await response.json(); assert.equal(checks.nativeAvailable, !session.sourceFormat.includes('subagent'));
    }
  } finally { if (app) await app.close(); fs.rmSync(folder, { recursive: true, force: true }); }
});
test('unsupported OpenCode database schemas are reported and never replaced by stale legacy snapshots', async () => {
  const folder = tmp(); const filename = path.join(folder, 'opencode.db'); const db = new DatabaseSync(filename);
  try {
    db.exec('CREATE TABLE unsupported(id TEXT);');
    write(folder, 'storage/session/project/ses_1.json', { id: 'ses_1', title: 'Stale' });
    write(folder, 'storage/message/ses_1/msg_1.json', { id: 'msg_1', role: 'user' });
    write(folder, 'storage/part/msg_1/prt_1.json', { type: 'text', text: 'Stale prompt' });
    const sessions = []; const report = await scanSource(source(folder, 'opencode'), device, s => sessions.push(s));
    assert.equal(sessions.length, 0); assert.equal(report.status, 'partial'); assert.match(report.errors[0], /Unsupported OpenCode SQLite schema/);
  } finally { db.close(); fs.rmSync(folder, { recursive: true, force: true }); }
});
test('new connector sessions pass encrypted transport validation and retain editor/format provenance', () => {
  const folder = tmp(); const remote = tmp(); const a = new Store(folder), b = new Store(remote); const la = new LAN(a, { port: 0 }), lb = new LAN(b, { port: 0 });
  try {
    for (const tool of ['gemini', 'cline', 'roo']) {
      const s = parseTranscript(JSON.stringify({ tool, id: `session-${tool}`, sourceHost: 'VS Code', sourceFormat: 'fixture', messages: [{ role: 'user', content: 'Keep my context' }] }), 'fixture.json', a.state.device);
      s.shared = true; a.upsert(s);
    }
    lb.receive(la.shared(), a.state.device);
    assert.equal(b.state.sessions.length, 3); assert.ok(b.state.sessions.every(s => s.sourceHost === 'VS Code' && s.sourceFormat === 'fixture' && s.shared === false));
  } finally { clearInterval(la.timer); clearInterval(lb.timer); fs.rmSync(folder, { recursive: true, force: true }); fs.rmSync(remote, { recursive: true, force: true }); }
});

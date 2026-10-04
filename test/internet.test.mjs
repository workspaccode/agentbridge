import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { createApp } from '../src/server.mjs';
import { Store } from '../src/store.mjs';
import { createRelay } from '../relay/server.mjs';
import { relayURL } from '../src/internet.mjs';
import { parseTranscript } from '../src/connectors.mjs';
import { createIdentity, publicIdentity, validateIdentity, channelKey, signRequest } from '../src/identity.mjs';
import { seal, unseal } from '../src/lan.mjs';

const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentbridge-internet-'));
const token = randomBytes(32).toString('hex');
const transcript = (text, id = 'work') => JSON.stringify({ id, tool: 'vscode', messages: [{ role: 'user', content: text }] });
function enable(app, relay) { Object.assign(app.store.state.settings, { internetEnabled: true, relayUrl: relay.url, relayToken: token }); app.store.save(); }
async function enroll(a, b) {
  await a.internet.tick(); await b.internet.tick();
  await a.internet.connect(b.internet.identity.id); await b.internet.tick();
  assert.equal(a.store.state.internet.peers.length, 0); assert.equal(b.store.state.internet.peers.length, 0);
  await b.internet.approve(b.store.state.internet.incoming[0].requestId);
  await a.internet.tick();
}

test('Device IDs bind to both public keys and survive state migration and restart without exposing private keys', () => {
  const directory = temporary();
  try {
    const first = new Store(directory); const id = first.state.internet.identity.id;
    assert.match(id, /^AB-(?:[A-F0-9]{6}-){3}[A-F0-9]{6}$/); assert.equal(new Store(directory).state.internet.identity.id, id);
    const pub = publicIdentity(first.state.internet.identity); assert.equal(validateIdentity(pub).id, id);
    const second = createIdentity(); assert.throws(() => validateIdentity({ ...pub, encryptionKey: second.encryptionKey }));
    first.state.settings.relayToken = token;
    assert.equal(JSON.stringify(first.publicState()).includes(token), false);
    assert.equal(JSON.stringify(first.publicState()).includes('PRIVATE KEY'), false);
    const a = createIdentity(), b = createIdentity();
    assert.equal(channelKey(a, publicIdentity(b), 'approved'), channelKey(b, publicIdentity(a), 'approved'));
    assert.notEqual(channelKey(a, publicIdentity(b), 'old'), channelKey(a, publicIdentity(b), 'new'));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('Relay configuration requires HTTPS except loopback, and rejects embedded credentials or path/query injection', () => {
  assert.equal(relayURL('https://relay.example.com/'), 'https://relay.example.com');
  assert.equal(relayURL('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  for (const url of ['http://relay.example.com', 'http://192.168.1.20', 'https://user:pass@relay.example.com', 'https://relay.example.com/path', 'https://relay.example.com/?secret=x']) assert.throws(() => relayURL(url));
});
test('Relay rejects unauthorized requests, forged signatures and replay, including after restart', async () => {
  const directory = temporary(); let relay = await createRelay({ directory, accessToken: token });
  const identity = createIdentity(); const record = publicIdentity(identity);
  const envelope = signRequest(identity, '/v1/register', { identity: record }, randomBytes(16).toString('hex'));
  const send = async (body, code = token) => fetch(`${relay.url}/v1/register`, { method: 'POST', headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await send(envelope, 'wrong')).status, 401);
    assert.equal((await send({ ...envelope, signature: 'forged' })).status, 400);
    assert.equal((await send(envelope)).status, 200);
    assert.equal((await send(envelope)).status, 400);
    await relay.close(); relay = await createRelay({ directory, accessToken: token });
    assert.equal((await send(envelope)).status, 400);
    assert.equal((await fetch(`${relay.url}/health`)).status, 200);
  } finally { await relay.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
test('Internet pairing requires approval and transfers selected-only encrypted snapshots through the relay', async () => {
  const directory = temporary(); const relay = await createRelay({ directory: path.join(directory, 'relay'), accessToken: token });
  const a = await createApp({ dataDir: path.join(directory, 'a'), name: 'Desktop', lanPort: 0 });
  const b = await createApp({ dataDir: path.join(directory, 'b'), name: 'Laptop', lanPort: 0 });
  try {
    enable(a, relay); enable(b, relay);
    const s = parseTranscript(transcript('TOP_SECRET_SELECTED_SESSION'), 'session.json', a.store.state.device); s.shared = true; a.store.upsert(s);
    a.store.upsert(parseTranscript(transcript('PRIVATE_UNSHARED_SESSION', 'private'), 'private.json', a.store.state.device));
    await a.internet.tick(); await b.internet.tick();
    await a.internet.connect(b.internet.identity.id); await b.internet.tick();
    assert.equal(b.store.state.sessions.length, 0); assert.equal(b.store.state.internet.incoming.length, 1); assert.equal(a.store.state.internet.peers.length, 0);
    await b.internet.approve(b.store.state.internet.incoming[0].requestId); await a.internet.tick();
    assert.equal(a.store.state.internet.peers.length, 1);
    const onDisk = fs.readFileSync(path.join(directory, 'relay', 'relay.json'), 'utf8');
    assert.equal(onDisk.includes('TOP_SECRET_SELECTED_SESSION'), false); assert.equal(onDisk.includes('PRIVATE_UNSHARED_SESSION'), false); assert.equal(onDisk.includes('Desktop'), false);
    await b.internet.tick(); assert.equal(b.store.state.sessions.length, 1); assert.equal(b.store.state.sessions[0].receivedVia, 'internet'); assert.equal(b.store.state.sessions[0].shared, false);
    assert.equal(b.store.state.settings.lanEnabled, false); assert.equal(b.lan.server, null);
    await b.internet.send(b.store.state.internet.peers[0].identity, b.store.state.internet.peers[0].channel, { kind: 'snapshot', sequence: 1, sessions: [] }, 'snapshot');
    await a.internet.tick(); // Recipient owns no sessions from B; no unsafe cross-origin writes.
    const state = await fetch(`${new URL(a.url).origin}/api/state`, { headers: { Authorization: `Bearer ${a.token}` } });
    const raw = await state.text(); assert.equal(raw.includes('PRIVATE KEY'), false); assert.equal(raw.includes(token), false);
    a.store.state.sessions.find(x => x.id === s.id).shared = false; a.store.save(); await a.internet.tick(true); await b.internet.tick();
    assert.equal(b.store.state.sessions.length, 0);
  } finally { await a.close(); await b.close(); await relay.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
test('Offline queued updates survive relay/client restart and encrypted payloads allow delayed delivery', async () => {
  const directory = temporary(); let relay = await createRelay({ directory: path.join(directory, 'relay'), accessToken: token });
  const a = await createApp({ dataDir: path.join(directory, 'a'), lanPort: 0 });
  let b = await createApp({ dataDir: path.join(directory, 'b'), lanPort: 0 });
  try {
    enable(a, relay); enable(b, relay); await enroll(a, b); const id = b.internet.identity.id;
    await b.close(); b = null;
    const s = parseTranscript(transcript('Queued while laptop was offline'), 'session.json', a.store.state.device); s.shared = true; a.store.upsert(s); await a.internet.tick(true);
    await relay.close(); relay = await createRelay({ directory: path.join(directory, 'relay'), accessToken: token });
    b = await createApp({ dataDir: path.join(directory, 'b'), lanPort: 0 }); enable(b, relay);
    assert.equal(b.internet.identity.id, id); await b.internet.tick(); assert.equal(b.store.state.sessions[0].title, 'Queued while laptop was offline');
    const now = Date.now; let packet;
    try { Date.now = () => now() - 10 * 60 * 1000; packet = seal('key', { work: 'delayed' }, 'offline'); } finally { Date.now = now; }
    assert.throws(() => unseal('key', packet, 'offline')); assert.deepEqual(unseal('key', packet, 'offline', 7 * 24 * 60 * 60 * 1000), { work: 'delayed' });
  } finally { await a.close(); if (b) await b.close(); await relay.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
test('Rejected requests are blocked and unsolicited acceptance cannot create a trusted peer', async () => {
  const directory = temporary(); const relay = await createRelay({ directory: path.join(directory, 'relay'), accessToken: token });
  const a = await createApp({ dataDir: path.join(directory, 'a'), lanPort: 0 }), b = await createApp({ dataDir: path.join(directory, 'b'), lanPort: 0 });
  try {
    enable(a, relay); enable(b, relay); await a.internet.tick(); await b.internet.tick();
    await b.internet.send(publicIdentity(a.internet.identity), 'pair', { kind: 'pair-accept', requestId: randomBytes(16).toString('hex'), channel: randomBytes(32).toString('hex'), device: b.store.state.device });
    await a.internet.tick(); assert.equal(a.store.state.internet.peers.length, 0);
    await a.internet.connect(b.internet.identity.id); await b.internet.tick(); await b.internet.reject(b.store.state.internet.incoming[0].requestId); await a.internet.tick();
    assert.equal(a.store.state.internet.outgoing.length, 0); assert.equal(b.store.state.internet.blocked.includes(a.internet.identity.id), true);
    await a.internet.connect(b.internet.identity.id); await b.internet.tick(); assert.equal(b.store.state.internet.incoming.length, 0); assert.equal(b.store.state.internet.peers.length, 0);
  } finally { await a.close(); await b.close(); await relay.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
test('Revocation purges queued updates, notifies peers and prevents old-channel session delivery', async () => {
  const directory = temporary(); const relay = await createRelay({ directory: path.join(directory, 'relay'), accessToken: token });
  const a = await createApp({ dataDir: path.join(directory, 'a'), lanPort: 0 }), b = await createApp({ dataDir: path.join(directory, 'b'), lanPort: 0 });
  try {
    enable(a, relay); enable(b, relay); await enroll(a, b);
    const oldPeer = { ...a.store.state.internet.peers[0] };
    const s = parseTranscript(transcript('Should not arrive after revoke'), 'session.json', a.store.state.device); s.shared = true; a.store.upsert(s); await a.internet.tick(true);
    const result = await a.internet.revoke(b.internet.identity.id); assert.equal(result.notified, true);
    await b.internet.tick(); assert.equal(b.store.state.internet.peers.length, 0); assert.equal(b.store.state.sessions.length, 0);
    await a.internet.send(oldPeer.identity, oldPeer.channel, { kind: 'snapshot', sequence: 100, sessions: [s] }, 'snapshot');
    await b.internet.tick(); assert.equal(b.store.state.sessions.length, 0);
  } finally { await a.close(); await b.close(); await relay.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

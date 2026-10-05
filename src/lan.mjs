import http from 'node:http';
import os from 'node:os';
import { TOOL_IDS } from './connectors.mjs';
import net from 'node:net';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';

export const MAX_BODY = 24 * 1024 * 1024;
export function privateAddress(host) {
  if (net.isIP(host) !== 4) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
export const addresses = () => {
  try { return Object.values(os.networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal && privateAddress(n.address)).map(n => n.address); }
  catch { return []; } // Restricted hosts may disallow network-interface enumeration.
};
export async function readJSON(req, limit = MAX_BODY) {
  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new Error('Request is too large. Export fewer or smaller sessions.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
export function sendJSON(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(data);
}
function aesKey(secret) { return createHash('sha256').update(secret).digest(); }
export function seal(secret, body, purpose) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', aesKey(secret), iv);
  cipher.setAAD(Buffer.from(purpose));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ time: Date.now(), body })), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') };
}
export function unseal(secret, packet, purpose, maxAgeMs = 5 * 60 * 1000) {
  if (!packet || typeof packet.iv !== 'string' || typeof packet.tag !== 'string' || typeof packet.data !== 'string') throw new Error('Invalid encrypted packet.');
  const iv = Buffer.from(packet.iv, 'base64'), tag = Buffer.from(packet.tag, 'base64');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted packet.');
  const decipher = createDecipheriv('aes-256-gcm', aesKey(secret), iv);
  decipher.setAAD(Buffer.from(purpose)); decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(Buffer.from(packet.data, 'base64')), decipher.final()]);
  const result = JSON.parse(plain.toString('utf8'));
  if (!Number.isFinite(result.time) || result.time > Date.now() + 5 * 60 * 1000 || Date.now() - result.time > maxAgeMs) throw new Error('Packet expired. Check both computers’ clocks.');
  return result.body;
}
function request(host, port, route, body) {
  if (!privateAddress(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Enter a private LAN IPv4 address and valid port.');
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    if (Buffer.byteLength(payload) > MAX_BODY) return reject(new Error('Shared sessions exceed the 24 MB transfer limit. Unshare some sessions.'));
    const req = http.request({ hostname: host, port, path: route, method: 'POST', timeout: 12000, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, async res => {
      try { const result = await readJSON(res); if (res.statusCode !== 200) throw new Error(result.error || 'Peer rejected the request.'); resolve(result); } catch (error) { reject(error); }
    });
    req.on('timeout', () => req.destroy(new Error('Device unreachable. Check its LAN address, port, and firewall.')));
    req.on('error', reject); req.end(payload);
  });
}
const safeString = (value, max) => typeof value === 'string' && value.length <= max;
function validateDevice(device) {
  if (!device || !safeString(device.id, 80) || !/^[a-zA-Z0-9-]{1,80}$/.test(device.id) || !safeString(device.name, 100) || !safeString(device.platform, 30)) throw new Error('Invalid device identity.');
}

export class LAN {
  constructor(store, { port = 47832, host = '0.0.0.0' } = {}) {
    this.store = store; this.port = port; this.host = host; this.server = null; this.invitation = null; this.seen = new Map(); this.busy = false;
    this.timer = setInterval(() => { if (store.state.settings.lanEnabled && store.state.settings.autoSync) this.syncAll(); }, 30000);
    this.timer.unref();
  }
  async start() {
    if (this.server) return;
    const server = http.createServer((req, res) => this.handle(req, res));
    server.requestTimeout = 15000; server.headersTimeout = 10000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(this.port, this.host, resolve); });
    this.server = server; this.port = server.address().port;
  }
  async stop() {
    this.invitation = null;
    if (this.server) { const server = this.server; this.server = null; await new Promise(resolve => server.close(resolve)); }
  }
  async close() { clearInterval(this.timer); await this.stop(); }
  info() { return { enabled: Boolean(this.server), port: this.port, addresses: addresses() }; }
  invite() {
    if (!this.server) throw new Error('Enable LAN sharing first.');
    const code = randomBytes(32).toString('base64url');
    this.invitation = { code, id: randomBytes(8).toString('hex'), expires: Date.now() + 10 * 60 * 1000 };
    return { ...this.invitation, ...this.info() };
  }
  checkReplay(identity, iv) {
    const now = Date.now();
    for (const [key, expires] of this.seen) if (expires < now) this.seen.delete(key);
    const key = `${identity}:${iv}`;
    if (this.seen.has(key)) throw new Error('Duplicate packet rejected.');
    if (this.seen.size >= 10000) throw new Error('Too many requests. Retry later.');
    this.seen.set(key, now + 10 * 60 * 1000);
  }
  shared() {
    // Only locally owned sessions may be published. Received copies are never relayed.
    return this.store.state.sessions.filter(s => s.shared && !s.demo && s.originDevice === this.store.state.device.id).map(({ sourcePath, localProjectPath, shared, starred, importedAt, ...s }) => s);
  }
  receive(sessions, peer) {
    if (!Array.isArray(sessions) || sessions.length > 500) throw new Error('Invalid session batch (maximum 500).');
    const incoming = sessions.map(s => {
      if (!s || s.originDevice !== peer.id || !safeString(s.id, 200) || !s.id.startsWith(`${s.tool}:${peer.id}:`) || !TOOL_IDS.includes(s.tool) || !safeString(s.nativeId, 500) || !safeString(s.title, 200) || !safeString(s.raw, 16 * 1024 * 1024) || !safeString(s.projectPath, 4000) || !safeString(s.projectName, 200) || !safeString(s.branch, 500) || !safeString(s.commit, 500) || !safeString(s.fingerprint, 100) || !safeString(s.filename, 500) || s.sourceHost !== undefined && !safeString(s.sourceHost, 100) || s.sourceFormat !== undefined && !safeString(s.sourceFormat, 100) || !safeString(s.note, 20000) || !Array.isArray(s.messages) || !Array.isArray(s.events) || !Number.isFinite(Date.parse(s.updatedAt)) || !Number.isFinite(Date.parse(s.createdAt))) throw new Error('Invalid session data.');
      for (const m of s.messages) if (!m || !['user', 'assistant', 'system', 'developer', 'tool'].includes(m.role) || !safeString(m.text, 16 * 1024 * 1024) || !safeString(m.timestamp, 100)) throw new Error('Invalid message.');
      for (const e of s.events) if (!e || !safeString(e.name, 500) || !safeString(e.input, 16 * 1024 * 1024) || !safeString(e.output, 16 * 1024 * 1024) || !safeString(e.timestamp, 100)) throw new Error('Invalid tool event.');
      // Pick fields explicitly: peers cannot inject paths, resume flags, or demo state.
      return { id: s.id, nativeId: s.nativeId, title: s.title, tool: s.tool, projectPath: s.projectPath, projectName: s.projectName, branch: s.branch, commit: s.commit, createdAt: s.createdAt, updatedAt: s.updatedAt, messages: s.messages, events: s.events, raw: s.raw, filename: s.filename, sourceHost: s.sourceHost || '', sourceFormat: s.sourceFormat || '', fingerprint: s.fingerprint, originDevice: peer.id, originName: peer.name, originPlatform: peer.platform, receivedVia: peer.transport || 'lan', sourcePath: '', localProjectPath: '', shared: false, starred: false, demo: false, note: s.note, originNote: s.note, importedAt: new Date().toISOString() };
    });
    let changed = 0;
    for (const session of incoming) if (this.store.upsert(session)) changed++;
    // Unpublishing removes an unchanged remote cache. A personal note/star keeps it as a local archive.
    const ids = new Set(incoming.map(s => s.id));
    this.store.state.sessions = this.store.state.sessions.filter(s => s.originDevice !== peer.id || ids.has(s.id) || s.starred || s.note || s.localProjectPath);
    return changed;
  }
  async pair({ host, port, code, invitationId }) {
    if (!this.server) throw new Error('Enable LAN sharing first.');
    if (!safeString(code, 100) || !/^[A-Za-z0-9_-]{43}$/.test(code) || !/^[a-f0-9]{16}$/.test(invitationId || '')) throw new Error('Copy the invitation code and ID from the other computer.');
    const packet = seal(code, { device: this.store.state.device, port: this.port }, 'pair-request');
    const result = await request(host, Number(port), '/bridge/pair', { invitationId, packet });
    const reply = unseal(code, result.packet, 'pair-response'); validateDevice(reply.device);
    if (reply.requestId !== packet.iv) throw new Error('Pairing response does not match the request.');
    if (reply.device.id === this.store.state.device.id) throw new Error('Cannot pair this device with itself.');
    if (!/^[A-Za-z0-9_-]{43}$/.test(reply.key)) throw new Error('Invalid pairing response.');
    const peer = { ...reply.device, host, port: Number(port), key: reply.key, status: 'paired', lastSync: null };
    this.store.state.peers = this.store.state.peers.filter(p => p.id !== peer.id);
    this.store.state.peers.push(peer); this.store.log(`Paired with ${peer.name}`); this.store.save();
    await this.sync(peer);
    return { name: peer.name };
  }
  async sync(peer) {
    try {
      const packet = seal(peer.key, { sessions: this.shared() }, `sync-request:${this.store.state.device.id}`);
      const result = await request(peer.host, peer.port, '/bridge/sync', { deviceId: this.store.state.device.id, packet });
      const reply = unseal(peer.key, result.packet, `sync-response:${peer.id}`);
      if (reply.requestId !== packet.iv) throw new Error('Sync response does not match the request.');
      this.checkReplay(peer.id, result.packet.iv);
      const changed = this.receive(reply.sessions, peer);
      peer.status = 'online'; peer.lastSync = new Date().toISOString(); delete peer.error;
      if (changed) this.store.log(`Received ${changed} session update(s) from ${peer.name}`);
      this.store.save(); return { id: peer.id, ok: true, changed };
    } catch (error) { peer.status = 'offline'; peer.error = error.message; this.store.save(); return { id: peer.id, ok: false, error: error.message }; }
  }
  async syncAll() {
    if (this.busy || !this.server) return [];
    this.busy = true;
    try { const results = []; for (const peer of this.store.state.peers) results.push(await this.sync(peer)); return results; }
    finally { this.busy = false; }
  }
  async handle(req, res) {
    try {
      if (req.method !== 'POST') return sendJSON(res, 404, { error: 'Not found' });
      const host = req.socket.remoteAddress?.replace(/^::ffff:/, '');
      if (!privateAddress(host)) return sendJSON(res, 403, { error: 'LAN addresses only' });
      const body = await readJSON(req);
      if (req.url === '/bridge/pair') {
        const invitation = this.invitation;
        if (!invitation || invitation.expires < Date.now() || body.invitationId !== invitation.id) throw new Error('Invitation is invalid or expired.');
        const incoming = unseal(invitation.code, body.packet, 'pair-request'); validateDevice(incoming.device);
        if (incoming.device.id === this.store.state.device.id) throw new Error('Cannot pair this device with itself.');
        if (!Number.isInteger(incoming.port) || incoming.port < 1 || incoming.port > 65535) throw new Error('Invalid port.');
        this.checkReplay(incoming.device.id, body.packet.iv);
        this.invitation = null;
        const key = randomBytes(32).toString('base64url');
        const peer = { ...incoming.device, host, port: incoming.port, key, status: 'paired', lastSync: null };
        this.store.state.peers = this.store.state.peers.filter(p => p.id !== peer.id);
        this.store.state.peers.push(peer); this.store.log(`Paired with ${peer.name}`); this.store.save();
        return sendJSON(res, 200, { packet: seal(invitation.code, { device: this.store.state.device, key, requestId: body.packet.iv }, 'pair-response') });
      }
      if (req.url === '/bridge/sync') {
        const peer = this.store.state.peers.find(p => p.id === body.deviceId);
        if (!peer) throw new Error('Device is not paired.');
        const incoming = unseal(peer.key, body.packet, `sync-request:${peer.id}`);
        this.checkReplay(peer.id, body.packet.iv);
        const changed = this.receive(incoming.sessions, peer);
        peer.host = host; peer.status = 'online'; peer.lastSync = new Date().toISOString(); delete peer.error;
        if (changed) this.store.log(`Received ${changed} session update(s) from ${peer.name}`);
        this.store.save();
        return sendJSON(res, 200, { packet: seal(peer.key, { sessions: this.shared(), requestId: body.packet.iv }, `sync-response:${this.store.state.device.id}`) });
      }
      return sendJSON(res, 404, { error: 'Not found' });
    } catch { if (!res.headersSent) sendJSON(res, 400, { error: 'Request rejected. Check pairing details, session limits, and device clocks.' }); }
  }
}

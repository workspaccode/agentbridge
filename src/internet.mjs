import { randomBytes, createHash } from 'node:crypto';
import { publicIdentity, validateIdentity, channelKey, signRequest, PUBLIC_ID } from './identity.mjs';
import { seal, unseal, MAX_BODY, readJSON } from './lan.mjs';

const WEEK = 7 * 24 * 60 * 60 * 1000;
export function relayURL(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Enter a valid HTTPS relay URL.'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) || url.pathname !== '/') throw new Error('Use an HTTPS relay origin, such as https://relay.example.com. HTTP is allowed only on localhost for testing.');
  return url.origin;
}
function validateDevice(device, localID) {
  if (!device || typeof device.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(device.id) || device.id === localID || typeof device.name !== 'string' || device.name.length > 100 || typeof device.platform !== 'string' || device.platform.length > 30) throw new Error('Invalid remote device details.');
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class Internet {
  constructor(store, sessions) {
    this.store = store; this.sessions = sessions; this.busy = false; this.registered = ''; this.status = 'disabled'; this.error = ''; this.lastContact = null;
    this.timer = setInterval(() => { if (store.state.settings.internetEnabled) this.tick().catch(() => {}); }, 15000); this.timer.unref();
  }
  close() { clearInterval(this.timer); }
  get identity() { return this.store.state.internet.identity; }
  get data() { return this.store.state.internet; }
  info() {
    return { publicId: this.identity.id, enabled: this.store.state.settings.internetEnabled, relayUrl: this.store.state.settings.relayUrl, tokenConfigured: Boolean(this.store.state.settings.relayToken), status: this.status, error: this.error, lastContact: this.lastContact,
      peers: this.data.peers.map(({ identity, channel, publishedHash, sequence, receivedSequence, ...peer }) => peer),
      incoming: this.data.incoming.map(({ identity, ...request }) => request), outgoing: this.data.outgoing.map(({ identity, ...request }) => request), blocked: this.data.blocked };
  }
  ensureEnabled() { if (!this.store.state.settings.internetEnabled) throw new Error('Enable Internet sharing and configure your relay first.'); }
  async request(route, data) {
    this.ensureEnabled();
    const url = relayURL(this.store.state.settings.relayUrl);
    if (!this.store.state.settings.relayToken) throw new Error('Enter your relay access code.');
    const envelope = signRequest(this.identity, route, data, randomBytes(16).toString('hex'));
    const content = JSON.stringify(envelope);
    if (Buffer.byteLength(content) > MAX_BODY) throw new Error('Shared sessions exceed the 24 MB encrypted request limit. Share fewer sessions.');
    const response = await fetch(`${url}${route}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${this.store.state.settings.relayToken}`, 'Content-Type': 'application/json' }, body: content });
    const result = await readJSON(response.body);
    if (!response.ok) throw new Error(result.error || 'Relay rejected the request.');
    this.lastContact = new Date().toISOString(); this.status = 'connected'; this.error = '';
    return result;
  }
  async register() {
    const configuration = digest([this.store.state.settings.relayUrl, this.store.state.settings.relayToken]);
    if (this.registered !== configuration) { await this.request('/v1/register', { identity: publicIdentity(this.identity) }); this.registered = configuration; }
  }
  async send(remote, channel, body, slot = 'control') {
    const packet = seal(channelKey(this.identity, remote, channel), body, `internet:${this.identity.id}:${remote.id}:${channel}`);
    return this.request('/v1/send', { to: remote.id, channel, slot, packet });
  }
  async connect(value) {
    this.ensureEnabled(); const id = String(value || '').trim().toUpperCase();
    if (!PUBLIC_ID.test(id)) throw new Error('Enter the complete AB device ID.');
    if (id === this.identity.id) throw new Error('This is your own device ID.');
    if (this.data.peers.some(p => p.publicId === id)) throw new Error('This device is already paired.');
    await this.register();
    const lookup = await this.request('/v1/lookup', { id });
    const remote = validateIdentity(lookup.identity, id);
    const requestId = randomBytes(16).toString('hex');
    await this.send(remote, 'pair', { kind: 'pair-request', requestId, device: this.store.state.device });
    this.data.outgoing = this.data.outgoing.filter(r => r.publicId !== id);
    this.data.blocked = this.data.blocked.filter(blocked => blocked !== id);
    this.data.outgoing.push({ publicId: id, requestId, identity: remote, createdAt: Date.now() });
    this.store.log(`Internet pairing request sent to ${id}`); this.store.save();
    return { pending: true, publicId: id };
  }
  addPeer(record, device, channel) {
    validateDevice(device, this.store.state.device.id);
    if (!/^[a-f0-9]{64}$/.test(channel)) throw new Error('Invalid approved channel.');
    if (this.data.peers.some(p => p.id === device.id && p.publicId !== record.id)) throw new Error('Origin identity conflict.');
    this.data.peers = this.data.peers.filter(p => p.publicId !== record.id);
    const peer = { ...device, id: record.id, sourceDeviceId: device.id, transport: 'internet', publicId: record.id, identity: record, channel, status: 'paired', lastSync: null, sequence: 0, receivedSequence: 0, publishedHash: '' };
    this.data.peers.push(peer); return peer;
  }
  async approve(requestId) {
    this.ensureEnabled(); await this.register();
    const incoming = this.data.incoming.find(r => r.requestId === requestId);
    if (!incoming || incoming.createdAt < Date.now() - WEEK || this.data.blocked.includes(incoming.publicId)) throw new Error('Pairing request is unavailable or expired.');
    const channel = randomBytes(32).toString('hex');
    await this.send(incoming.identity, 'pair', { kind: 'pair-accept', requestId, channel, device: this.store.state.device });
    this.addPeer(incoming.identity, incoming.device, channel);
    this.data.incoming = this.data.incoming.filter(r => r.publicId !== incoming.publicId);
    this.store.log(`Approved Internet pairing with ${incoming.device.name}`); this.store.save();
    return { ok: true };
  }
  async reject(requestId) {
    const incoming = this.data.incoming.find(r => r.requestId === requestId);
    if (!incoming) throw new Error('Pairing request not found.');
    // Block locally even if the remote relay is unavailable.
    this.data.blocked = [...new Set([...this.data.blocked, incoming.publicId])];
    this.data.incoming = this.data.incoming.filter(r => r.publicId !== incoming.publicId); this.store.save();
    try { await this.register(); await this.send(incoming.identity, 'pair', { kind: 'pair-reject', requestId }); } catch { /* Local block remains effective. */ }
    return { ok: true };
  }
  async revoke(publicId) {
    const peer = this.data.peers.find(p => p.publicId === publicId);
    if (!peer) throw new Error('Internet peer not found.');
    this.data.peers = this.data.peers.filter(p => p.publicId !== publicId);
    this.data.outgoing = this.data.outgoing.filter(r => r.publicId !== publicId);
    this.data.incoming = this.data.incoming.filter(r => r.publicId !== publicId);
    this.data.blocked = [...new Set([...this.data.blocked, publicId])];
    this.store.log(`Revoked Internet access for ${peer.name}`); this.store.save();
    let notified = false;
    try { await this.register(); await this.request('/v1/purge', { to: publicId }); await this.send(peer.identity, peer.channel, { kind: 'revoke' }); notified = true; } catch { /* Rejection of incoming data is local and immediate. */ }
    return { ok: true, notified };
  }
  async process(message) {
    if (!message || typeof message.id !== 'string' || message.to !== this.identity.id || this.data.processed.includes(message.id)) return;
    const record = validateIdentity(message.identity, message.from);
    if (this.data.blocked.includes(record.id)) return;
    if (typeof message.channel !== 'string' || !/^(pair|[a-f0-9]{64})$/.test(message.channel)) throw new Error('Invalid message channel.');
    const peer = this.data.peers.find(p => p.publicId === record.id);
    if (message.channel !== 'pair' && (!peer || message.channel !== peer.channel)) return;
    const body = unseal(channelKey(this.identity, record, message.channel), message.packet, `internet:${record.id}:${this.identity.id}:${message.channel}`, WEEK);
    if (message.channel === 'pair') {
      if (typeof body.requestId !== 'string' || !/^[a-f0-9]{32}$/.test(body.requestId)) throw new Error('Invalid pairing request.');
      if (body.kind === 'pair-request') {
        validateDevice(body.device, this.store.state.device.id);
        if (peer) return;
        this.data.incoming = this.data.incoming.filter(r => r.publicId !== record.id);
        if (this.data.incoming.length >= 50) throw new Error('Too many pending pairing requests.');
        this.data.incoming.push({ publicId: record.id, identity: record, requestId: body.requestId, device: body.device, createdAt: Date.now() });
        this.store.log(`Internet pairing request from ${body.device.name}`);
      } else if (body.kind === 'pair-accept') {
        const outgoing = this.data.outgoing.find(r => r.publicId === record.id && r.requestId === body.requestId);
        if (!outgoing || outgoing.createdAt < Date.now() - WEEK) return;
        this.addPeer(record, body.device, body.channel);
        this.data.outgoing = this.data.outgoing.filter(r => r.publicId !== record.id);
        this.store.log(`Internet pairing approved by ${body.device.name}`);
      } else if (body.kind === 'pair-reject') this.data.outgoing = this.data.outgoing.filter(r => !(r.publicId === record.id && r.requestId === body.requestId));
      else throw new Error('Unknown pairing message.');
    } else if (body.kind === 'snapshot') {
      if (!Number.isSafeInteger(body.sequence) || body.sequence <= peer.receivedSequence) return;
      const changed = this.sessions.receive(body.sessions, peer);
      peer.receivedSequence = body.sequence; peer.lastSync = new Date().toISOString(); peer.status = 'received';
      if (changed) this.store.log(`Internet: received ${changed} session update(s) from ${peer.name}`);
    } else if (body.kind === 'revoke') {
      this.data.peers = this.data.peers.filter(p => p.publicId !== record.id);
      this.data.blocked = [...new Set([...this.data.blocked, record.id])];
      this.store.log(`Internet access revoked by ${peer.name}`);
    } else throw new Error('Unknown encrypted message.');
  }
  async poll() {
    const response = await this.request('/v1/poll', {});
    if (!Array.isArray(response.messages) || response.messages.length > 30) throw new Error('Invalid relay mailbox response.');
    const acknowledgments = [];
    for (const message of response.messages) {
      try { await this.process(message); }
      catch { this.store.log('Rejected an invalid Internet message'); }
      if (typeof message?.id === 'string' && message.id.length <= 100) {
        acknowledgments.push(message.id); this.data.processed.push(message.id);
      }
    }
    this.data.processed = [...new Set(this.data.processed)].slice(-2000);
    this.data.incoming = this.data.incoming.filter(r => r.createdAt >= Date.now() - WEEK);
    this.data.outgoing = this.data.outgoing.filter(r => r.createdAt >= Date.now() - WEEK);
    this.store.save();
    if (acknowledgments.length) await this.request('/v1/ack', { ids: acknowledgments });
    return acknowledgments.length;
  }
  async publish(force = false) {
    // Internet ownership is bound to the cryptographic ID, never a sender-chosen UUID.
    const sessions = this.sessions.shared().map(s => ({ ...s, id: s.id.replace(`${s.tool}:${this.store.state.device.id}:`, `${s.tool}:${this.identity.id}:`), originDevice: this.identity.id }));
    const hash = digest(sessions), results = [];
    for (const peer of this.data.peers) {
      if (!force && peer.publishedHash === hash) continue;
      try {
        const sequence = peer.sequence + 1;
        await this.send(peer.identity, peer.channel, { kind: 'snapshot', sequence, sessions }, 'snapshot');
        peer.sequence = sequence; peer.publishedHash = hash; peer.status = 'queued'; delete peer.error;
        results.push({ publicId: peer.publicId, ok: true });
      } catch (error) { peer.error = error.message; results.push({ publicId: peer.publicId, ok: false, error: error.message }); }
    }
    this.store.save(); return results;
  }
  async tick(force = false) {
    if (!this.store.state.settings.internetEnabled || this.busy) return { results: [], busy: this.busy };
    this.busy = true;
    try {
      await this.register(); const received = await this.poll();
      const results = force || this.store.state.settings.autoSync ? await this.publish(force) : [];
      return { received, results };
    } catch (error) { this.error = error.message; this.status = 'unreachable'; this.registered = ''; throw error; }
    finally { this.busy = false; }
  }
}

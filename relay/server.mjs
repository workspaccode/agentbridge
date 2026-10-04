import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateIdentity, verifyRequest, PUBLIC_ID } from '../src/identity.mjs';
import { readJSON, sendJSON, MAX_BODY } from '../src/lan.mjs';

export const RETENTION = 7 * 24 * 60 * 60 * 1000;
export async function createRelay({ directory, accessToken, port = 0, host = '127.0.0.1', maxStorage = 128 * 1024 * 1024 } = {}) {
  if (typeof accessToken !== 'string' || accessToken.length < 32 || accessToken.length > 200) throw new Error('Set a relay access token of 32–200 characters.');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'relay.json');
  const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { devices: {}, mail: [], nonces: {} };
  const rates = new Map();
  const save = () => { fs.writeFileSync(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 }); fs.renameSync(`${file}.tmp`, file); };
  function prune() {
    const now = Date.now();
    state.mail = state.mail.filter(m => m.expires > now);
    for (const [key, expiry] of Object.entries(state.nonces)) if (expiry <= now) delete state.nonces[key];
    for (const [key, value] of rates) if (value.until <= now) rates.delete(key);
  }
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return sendJSON(res, 200, { ok: true, protocol: 'agentbridge-relay-v1' });
      if (req.method !== 'POST' || !['/v1/register', '/v1/lookup', '/v1/send', '/v1/poll', '/v1/ack', '/v1/purge'].includes(req.url)) return sendJSON(res, 404, { error: 'Not found' });
      const supplied = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
      const token = Buffer.from(accessToken);
      if (supplied.length !== token.length || !timingSafeEqual(supplied, token)) return sendJSON(res, 401, { error: 'Relay access code is required.' });
      prune();
      const ip = req.socket.remoteAddress;
      const rate = rates.get(ip) || { count: 0, until: Date.now() + 60000 };
      if (++rate.count > 300) return sendJSON(res, 429, { error: 'Request limit reached. Retry in a minute.' });
      rates.set(ip, rate);
      const envelope = await readJSON(req);
      const identity = req.url === '/v1/register' ? validateIdentity(envelope.data?.identity, envelope.id) : state.devices[envelope.id];
      if (!identity) return sendJSON(res, 403, { error: 'Register this device first.' });
      verifyRequest(identity, envelope, req.url);
      const nonce = `${identity.id}:${envelope.nonce}`;
      if (state.nonces[nonce]) throw new Error('Signed request replay rejected.');
      if (Object.keys(state.nonces).length >= 10000) throw new Error('Relay request capacity reached.');
      state.nonces[nonce] = Date.now() + 10 * 60 * 1000;
      const data = envelope.data || {};
      let result;
      if (req.url === '/v1/register') {
        if (!state.devices[identity.id] && Object.keys(state.devices).length >= 500) throw new Error('Relay device limit reached.');
        state.devices[identity.id] = identity; result = { ok: true, id: identity.id };
      }
      if (req.url === '/v1/lookup') {
        if (!PUBLIC_ID.test(data.id || '')) throw new Error('Invalid device ID.');
        const record = state.devices[data.id];
        if (!record) return sendJSON(res, 404, { error: 'Device ID was not found on this relay. Enable Internet sharing on the other device first.' });
        result = { identity: record };
      }
      if (req.url === '/v1/send') {
        if (!PUBLIC_ID.test(data.to || '') || data.to === identity.id || !state.devices[data.to]) throw new Error('Unknown destination ID.');
        if (typeof data.channel !== 'string' || !/^(pair|[a-f0-9]{64})$/.test(data.channel) || !['control', 'snapshot'].includes(data.slot)) throw new Error('Invalid message channel.');
        const p = data.packet;
        if (!p || typeof p.iv !== 'string' || !/^[A-Za-z0-9+/]{16}$/.test(p.iv) || typeof p.tag !== 'string' || Buffer.from(p.tag, 'base64').length !== 16 || typeof p.data !== 'string' || p.data.length > MAX_BODY) throw new Error('Invalid encrypted message.');
        const next = state.mail.filter(m => !(data.slot === 'snapshot' && m.from === identity.id && m.to === data.to && m.channel === data.channel && m.slot === 'snapshot'));
        const message = { id: randomUUID(), from: identity.id, to: data.to, channel: data.channel, slot: data.slot, packet: { iv: p.iv, tag: p.tag, data: p.data }, identity, createdAt: Date.now(), expires: Date.now() + RETENTION };
        if (Buffer.byteLength(JSON.stringify(message)) > MAX_BODY - 8192) throw new Error('Encrypted message is too large for mailbox delivery.');
        if (next.filter(m => m.to === data.to).length >= 200 || next.length >= 2000) throw new Error('Relay mailbox is full.');
        if (Buffer.byteLength(JSON.stringify(next)) + Buffer.byteLength(JSON.stringify(message)) > maxStorage) throw new Error('Relay storage quota reached.');
        next.push(message); state.mail = next; result = { ok: true, messageId: message.id };
      }
      if (req.url === '/v1/poll') {
        const messages = []; let bytes = 0;
        for (const m of state.mail.filter(m => m.to === identity.id)) {
          const size = Buffer.byteLength(JSON.stringify(m));
          if (messages.length >= 30 || bytes + size > MAX_BODY - 4096) break;
          bytes += size; messages.push(m);
        }
        result = { messages };
      }
      if (req.url === '/v1/ack') {
        if (!Array.isArray(data.ids) || data.ids.length > 30 || data.ids.some(id => typeof id !== 'string' || id.length > 100)) throw new Error('Invalid acknowledgments.');
        state.mail = state.mail.filter(m => !(m.to === identity.id && data.ids.includes(m.id))); result = { ok: true };
      }
      if (req.url === '/v1/purge') {
        if (!PUBLIC_ID.test(data.to || '')) throw new Error('Invalid destination ID.');
        state.mail = state.mail.filter(m => !(m.from === identity.id && m.to === data.to)); result = { ok: true };
      }
      save(); return sendJSON(res, 200, result);
    } catch (error) { if (!res.headersSent) sendJSON(res, 400, { error: error.message }); }
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const timer = setInterval(() => { prune(); save(); }, 60000); timer.unref();
  return { server, state, url: `http://127.0.0.1:${server.address().port}`, close: async () => { clearInterval(timer); await new Promise(resolve => server.close(resolve)); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const relay = await createRelay({ directory: process.env.AGENTBRIDGE_RELAY_DATA || fileURLToPath(new URL('./.data/', import.meta.url)), accessToken: process.env.AGENTBRIDGE_RELAY_TOKEN, port: Number(process.env.PORT || 8787), host: process.env.HOST || '0.0.0.0' });
  console.log(`AgentBridge relay listening on port ${relay.server.address().port}. Put it behind HTTPS for Internet use.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await relay.close(); process.exit(0); });
}

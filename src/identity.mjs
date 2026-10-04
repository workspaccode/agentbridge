import { generateKeyPairSync, createHash, createPublicKey, createPrivateKey, diffieHellman, hkdfSync, sign, verify } from 'node:crypto';

export const PUBLIC_ID = /^AB-(?:[A-F0-9]{6}-){3}[A-F0-9]{6}$/;
const encoding = { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } };
export function deviceID(signingKey, encryptionKey) {
  const digest = createHash('sha256').update(`${signingKey}\n${encryptionKey}`).digest('hex').slice(0, 24).toUpperCase();
  return `AB-${digest.match(/.{6}/g).join('-')}`;
}
export function createIdentity() {
  const signing = generateKeyPairSync('ed25519', encoding), encryption = generateKeyPairSync('x25519', encoding);
  return { id: deviceID(signing.publicKey, encryption.publicKey), signingKey: signing.publicKey, signingPrivate: signing.privateKey, encryptionKey: encryption.publicKey, encryptionPrivate: encryption.privateKey };
}
export function publicIdentity(identity) {
  const record = { id: identity.id, signingKey: identity.signingKey, encryptionKey: identity.encryptionKey };
  return { ...record, proof: sign(null, Buffer.from(JSON.stringify(record)), identity.signingPrivate).toString('base64') };
}
export function validateIdentity(record, expectedID = record?.id) {
  if (!record || !PUBLIC_ID.test(record.id) || record.id !== expectedID || typeof record.signingKey !== 'string' || record.signingKey.length > 500 || typeof record.encryptionKey !== 'string' || record.encryptionKey.length > 500 || typeof record.proof !== 'string' || record.proof.length > 200) throw new Error('Invalid device identity.');
  if (createPublicKey(record.signingKey).asymmetricKeyType !== 'ed25519' || createPublicKey(record.encryptionKey).asymmetricKeyType !== 'x25519' || deviceID(record.signingKey, record.encryptionKey) !== record.id) throw new Error('Device ID does not match its keys.');
  const canonical = { id: record.id, signingKey: record.signingKey, encryptionKey: record.encryptionKey };
  if (!verify(null, Buffer.from(JSON.stringify(canonical)), record.signingKey, Buffer.from(record.proof, 'base64'))) throw new Error('Invalid identity proof.');
  return { ...canonical, proof: record.proof };
}
export function channelKey(identity, remote, channel = 'pair') {
  validateIdentity(remote);
  const secret = diffieHellman({ privateKey: createPrivateKey(identity.encryptionPrivate), publicKey: createPublicKey(remote.encryptionKey) });
  const endpoints = [identity.id, remote.id].sort().join(':');
  return Buffer.from(hkdfSync('sha256', secret, Buffer.from(channel), Buffer.from(`agentbridge-internet-v1:${endpoints}`), 32)).toString('base64url');
}
export function signRequest(identity, route, data, nonce, timestamp = Date.now()) {
  const body = { id: identity.id, route, timestamp, nonce, data };
  return { ...body, signature: sign(null, Buffer.from(JSON.stringify(body)), identity.signingPrivate).toString('base64') };
}
export function verifyRequest(record, envelope, route) {
  if (!envelope || envelope.id !== record.id || envelope.route !== route || typeof envelope.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(envelope.nonce) || typeof envelope.signature !== 'string' || envelope.signature.length > 200 || !Number.isFinite(envelope.timestamp) || Math.abs(Date.now() - envelope.timestamp) > 5 * 60 * 1000) throw new Error('Invalid or expired signed request.');
  const canonical = { id: envelope.id, route: envelope.route, timestamp: envelope.timestamp, nonce: envelope.nonce, data: envelope.data };
  if (!verify(null, Buffer.from(JSON.stringify(canonical)), record.signingKey, Buffer.from(envelope.signature, 'base64'))) throw new Error('Request signature rejected.');
}

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Store } from './store.mjs';
import { LAN, readJSON, sendJSON } from './lan.mjs';
import { CONNECTORS, parseTranscript, handoff } from './connectors.mjs';
import { demoSessions } from './demo.mjs';
import { Internet, relayURL } from './internet.mjs';
import { discoverSources, expandScanPath } from './discovery.mjs';
import { scanSource } from './readers.mjs';

const run = promisify(execFile);
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const quote = value => process.platform === 'win32' ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`;

export async function createApp({ dataDir, name, port = 0, lanPort = 47832, lanHost, scanContext = {} } = {}) {
  const store = new Store(dataDir, name);
  const token = randomBytes(32).toString('hex');
  const lan = new LAN(store, { port: lanPort, host: lanHost });
  const internet = new Internet(store, lan);
  const sources = () => discoverSources({ ...scanContext, scanPaths: store.state.settings.scanPaths });
  let scanning = false;
  async function scan(tool = '') {
    if (tool && !CONNECTORS.some(c => c.id === tool)) throw new Error('Unknown connector.');
    if (scanning) return { changed: 0, skipped: 0, errors: [], busy: true };
    scanning = true;
    try {
      let changed = 0, skipped = 0; const errors = [], reports = [];
      for (const source of sources().filter(s => !tool || s.tool === tool)) {
        const report = await scanSource(source, store.state.device, session => store.upsert(session));
        reports.push(report); changed += report.changed; skipped += report.skipped;
        for (const error of report.errors) if (errors.length < 20) errors.push(`${source.label}: ${error}`);
      }
      const previous = tool ? (store.state.scanSummary?.sources || []).filter(s => s.tool !== tool) : [];
      store.state.scanSummary = { timestamp: new Date().toISOString(), sources: [...previous, ...reports] };
      store.log(`Local scan: ${changed} updated, ${skipped} skipped`); store.save();
      return { changed, skipped, errors, limited: reports.some(s => s.limited), sources: reports };
    } finally { scanning = false; }
  }
  if (store.state.settings.lanEnabled) {
    try { await lan.start(); } catch (error) { store.state.settings.lanEnabled = false; store.log(`LAN listener could not start: ${error.message}`); store.save(); }
  }
  const scanTimer = setInterval(() => { if (store.state.settings.autoScan) scan().catch(() => {}); }, 60000);
  scanTimer.unref();

  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host;
      if (host !== `127.0.0.1:${server.address().port}`) return sendJSON(res, 403, { error: 'Invalid host' });
      const origin = `http://${host}`;
      if (req.headers.origin && req.headers.origin !== origin) return sendJSON(res, 403, { error: 'Invalid origin' });
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      const url = new URL(req.url, origin);
      if (!url.pathname.startsWith('/api/')) {
        const assets = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/icon.svg': ['icon.svg', 'image/svg+xml'] };
        const asset = assets[url.pathname];
        if (!asset || req.method !== 'GET') return sendJSON(res, 404, { error: 'Not found' });
        res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(path.join(publicDir, asset[0]))); return;
      }
      const received = String(req.headers.authorization || '').replace(/^Bearer /, '');
      if (received.length !== token.length || !timingSafeEqual(Buffer.from(received), Buffer.from(token))) return sendJSON(res, 401, { error: 'Open the app from its startup URL to authenticate.' });
      const body = ['POST', 'PATCH', 'DELETE'].includes(req.method) ? await readJSON(req) : {};
      const respond = result => sendJSON(res, 200, result);
      if (url.pathname === '/api/state' && req.method === 'GET') {
        const discovered = sources().map(s => ({ ...s, lastScan: store.state.scanSummary?.sources.find(r => r.id === s.id) || null }));
        return respond({ ...store.publicState(), lan: lan.info(), internet: internet.info(), scanSummary: store.state.scanSummary || null, connectors: CONNECTORS.map(c => {
          const locations = discovered.filter(s => s.tool === c.id);
          return { ...c, sources: locations, root: locations.find(s => s.detected)?.root || locations[0]?.root || null, detected: locations.some(s => s.detected && s.kind !== 'unsupported'), nativeResume: ['claude', 'codex'].includes(c.id) };
        }) });
      }
      if (url.pathname === '/api/internet/settings' && req.method === 'PATCH') {
        if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw new Error('Invalid Internet setting.');
        const endpoint = body.relayUrl !== undefined ? relayURL(body.relayUrl) : store.state.settings.relayUrl;
        const access = body.relayToken !== undefined ? body.relayToken : store.state.settings.relayToken;
        if (typeof access !== 'string' || access.length > 200 || (body.enabled && access.length < 32)) throw new Error('The relay access code must be 32–200 characters.');
        if (body.enabled && !endpoint) throw new Error('Configure your HTTPS relay first.');
        store.state.settings.relayUrl = endpoint; store.state.settings.relayToken = access;
        if (body.enabled !== undefined) store.state.settings.internetEnabled = body.enabled;
        internet.registered = ''; internet.status = store.state.settings.internetEnabled ? 'configured' : 'disabled'; internet.error = ''; store.save();
        if (store.state.settings.internetEnabled) {
          try { await internet.tick(); } catch (error) { return respond({ ok: true, connected: false, error: error.message }); }
        }
        return respond({ ok: true, connected: store.state.settings.internetEnabled });
      }
      if (url.pathname === '/api/internet/connect' && req.method === 'POST') return respond(await internet.connect(body.id));
      if (url.pathname === '/api/internet/approve' && req.method === 'POST') return respond(await internet.approve(body.requestId));
      if (url.pathname === '/api/internet/reject' && req.method === 'POST') return respond(await internet.reject(body.requestId));
      if (url.pathname === '/api/internet/sync' && req.method === 'POST') {
        internet.ensureEnabled(); return respond(await internet.tick(true));
      }
      if (url.pathname === '/api/internet/revoke' && req.method === 'POST') return respond(await internet.revoke(body.id));
      if (url.pathname === '/api/internet/unblock' && req.method === 'POST') {
        store.state.internet.blocked = store.state.internet.blocked.filter(id => id !== body.id); store.save(); return respond({ ok: true });
      }
      if (url.pathname === '/api/search' && req.method === 'GET') {
        const q = (url.searchParams.get('q') || '').slice(0, 1000).toLowerCase();
        return respond({ ids: store.state.sessions.filter(s => !q || [s.title, s.projectName, s.branch, s.originName, s.note, ...s.messages.map(m => m.text), ...s.events.flatMap(e => [e.name, e.input, e.output])].some(value => String(value || '').toLowerCase().includes(q))).map(s => s.id) });
      }
      if (url.pathname === '/api/scan' && req.method === 'POST') {
        if (body.tool !== undefined && typeof body.tool !== 'string') throw new Error('Invalid connector.');
        return respond(await scan(body.tool || ''));
      }
      if (url.pathname === '/api/scan-paths' && req.method === 'PATCH') {
        if (!CONNECTORS.some(c => c.id === body.tool) || !Array.isArray(body.paths) || body.paths.length > 8) throw new Error('Choose a connector and up to eight custom paths.');
        const paths = [...new Set(body.paths.map(value => expandScanPath(value, scanContext)))];
        store.state.settings.scanPaths[body.tool] = paths; store.save(); return respond({ ok: true, paths });
      }
      if (url.pathname === '/api/import' && req.method === 'POST') {
        if (typeof body.filename !== 'string' || body.filename.length > 500) throw new Error('Invalid filename.');
        const session = parseTranscript(body.content, body.filename, store.state.device);
        store.upsert(session); store.log(`Imported ${session.title}`); store.save(); return respond({ id: session.id });
      }
      if (url.pathname === '/api/demo' && req.method === 'POST') {
        for (const session of demoSessions(store.state.device)) store.upsert(session);
        store.save(); return respond({ ok: true });
      }
      if (url.pathname === '/api/demo' && req.method === 'DELETE') { store.state.sessions = store.state.sessions.filter(s => !s.demo); store.save(); return respond({ ok: true }); }
      if (url.pathname === '/api/settings' && req.method === 'PATCH') {
        if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100)) throw new Error('Device name must be 1–100 characters.');
        for (const key of ['lanEnabled', 'autoSync', 'autoScan']) if (body[key] !== undefined && typeof body[key] !== 'boolean') throw new Error('Invalid settings value.');
        if (body.lanEnabled === true) await lan.start();
        if (body.lanEnabled === false) await lan.stop();
        for (const key of ['lanEnabled', 'autoSync', 'autoScan']) if (typeof body[key] === 'boolean') store.state.settings[key] = body[key];
        if (body.name) store.state.device.name = body.name.trim();
        store.save(); return respond({ ok: true });
      }
      if (url.pathname === '/api/invite' && req.method === 'POST') return respond(lan.invite());
      if (url.pathname === '/api/pair' && req.method === 'POST') return respond(await lan.pair(body));
      if (url.pathname === '/api/sync' && req.method === 'POST') return respond({ results: await lan.syncAll() });
      if (url.pathname.startsWith('/api/peers/') && req.method === 'DELETE') {
        const id = decodeURIComponent(url.pathname.slice('/api/peers/'.length));
        store.state.peers = store.state.peers.filter(p => p.id !== id); store.log('Device access revoked'); store.save(); return respond({ ok: true });
      }
      const match = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(export|raw|handoff|inspect))?$/);
      if (match) {
        const session = store.state.sessions.find(s => s.id === decodeURIComponent(match[1]));
        if (!session) return sendJSON(res, 404, { error: 'Session not found' });
        const action = match[2];
        if (req.method === 'PATCH' && !action) {
          if (body.shared !== undefined && typeof body.shared !== 'boolean') throw new Error('Invalid sharing value.');
          if (body.shared && (session.demo || session.originDevice !== store.state.device.id)) throw new Error('Only your real local sessions can be shared.');
          for (const key of ['note', 'localProjectPath']) if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > (key === 'note' ? 20000 : 4000))) throw new Error(`Invalid ${key}.`);
          for (const key of ['shared', 'starred']) if (typeof body[key] === 'boolean') session[key] = body[key];
          for (const key of ['note', 'localProjectPath']) if (typeof body[key] === 'string') session[key] = body[key];
          store.save(); return respond({ ok: true });
        }
        if (req.method === 'DELETE' && !action) { store.state.sessions = store.state.sessions.filter(s => s.id !== session.id); store.save(); return respond({ ok: true }); }
        if (req.method !== 'GET') return sendJSON(res, 405, { error: 'Method not allowed' });
        if (action === 'export') {
          const { sourcePath, shared, starred, ...portable } = session;
          return respond({ format: 'agentbridge-session-v1', session: portable });
        }
        if (action === 'raw') return respond({ filename: session.filename, content: session.raw });
        if (action === 'handoff') return respond({ content: handoff(session, url.searchParams.get('target')?.slice(0, 100)) });
        if (action === 'inspect') {
          const directory = session.localProjectPath || (session.originDevice === store.state.device.id ? session.projectPath : '');
          const checks = { directory, exists: Boolean(directory && fs.existsSync(directory)), nativeAvailable: false, command: '', branch: '', commit: '', dirty: false, warnings: [] };
          if (!checks.exists) checks.warnings.push('Map this session to an existing local project folder.');
          if (checks.exists) {
            try {
              const git = async args => (await run('git', ['-C', directory, ...args], { timeout: 4000, maxBuffer: 1024 * 1024 })).stdout.trim();
              checks.branch = await git(['branch', '--show-current']); checks.commit = await git(['rev-parse', 'HEAD']); checks.dirty = Boolean(await git(['status', '--porcelain']));
              if (session.branch && session.branch !== checks.branch) checks.warnings.push(`Recorded branch ${session.branch} differs from local ${checks.branch || '(detached HEAD)'}.`);
              if (session.commit && session.commit !== checks.commit) checks.warnings.push('The local commit differs from the recorded commit.');
              if (checks.dirty) checks.warnings.push('This project has uncommitted changes.');
            } catch { checks.warnings.push('Git repository information is unavailable.'); }
          }
          const native = session.originDevice === store.state.device.id && !session.demo && !session.sourceFormat?.includes('subagent') && session.sourcePath && fs.existsSync(session.sourcePath) && /^[a-zA-Z0-9_-]{1,100}$/.test(session.nativeId) && ['claude', 'codex'].includes(session.tool);
          checks.nativeAvailable = Boolean(native && checks.exists);
          if (checks.nativeAvailable) {
            const cd = process.platform === 'win32' ? `Set-Location -LiteralPath ${quote(directory)}` : `cd -- ${quote(directory)}`;
            checks.command = `${cd}\n${session.tool === 'claude' ? 'claude --resume' : 'codex resume'} ${quote(session.nativeId)}`;
          } else checks.warnings.push('Native resume is unavailable here. Use the context handoff or download the original transcript.');
          return respond(checks);
        }
        const { raw, sourcePath, ...detail } = session; return respond(detail);
      }
      return sendJSON(res, 404, { error: 'Not found' });
    } catch (error) { if (!res.headersSent) sendJSON(res, 400, { error: error.message }); }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}/#${token}`;
  return { store, lan, internet, server, token, url, scan, close: async () => { clearInterval(scanTimer); internet.close(); await lan.close(); await new Promise(resolve => server.close(resolve)); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const app = await createApp({ port: Number(process.env.AGENTBRIDGE_PORT || 4317), lanPort: Number(process.env.AGENTBRIDGE_LAN_PORT || 47832) });
  console.log(`\nAgentBridge is running. Open this private local URL:\n${app.url}\n\nPress Ctrl+C to stop.\n`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}

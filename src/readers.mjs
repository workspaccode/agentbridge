import fs from 'node:fs/promises';
import path from 'node:path';
import { parseTranscript } from './connectors.mjs';
import { localPath } from './formats.mjs';

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 500;
const MAX_ROWS = 10000;
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value);

export async function readText(filename) {
  const info = await fs.lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Only regular transcript files are read.');
  if (info.size > MAX_BYTES) throw new Error('Transcript exceeds the 16 MB limit.');
  const raw = await fs.readFile(filename, 'utf8');
  if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error('Transcript grew beyond the 16 MB limit.');
  return { raw, timestamp: info.mtime.toISOString() };
}

async function walk(root, accept, result, depth = 0) {
  if (depth > 8 || result.visited >= 10000 || result.files.length >= 2000) { result.limited = true; return; }
  const info = await fs.lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) return;
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (++result.visited > 10000 || result.files.length >= 2000) { result.limited = true; break; }
    if (entry.isSymbolicLink()) continue;
    const filename = path.join(root, entry.name);
    if (entry.isDirectory() && !['node_modules', '.git', 'logs', 'log', 'checkpoints', 'cache', 'backups'].includes(entry.name)) {
      try { await walk(filename, accept, result, depth + 1); }
      catch (e) { if (!['ENOENT', 'ENOTDIR'].includes(e.code) && result.errors.length < 10) result.errors.push(`${entry.name}: ${e.code || 'unreadable directory'}`); }
    } else if (entry.isFile() && accept(filename)) {
      try { const info = await fs.stat(filename); result.files.push({ filename, modified: info.mtimeMs }); }
      catch (e) { if (result.errors.length < 10) result.errors.push(`${entry.name}: ${e.code || 'unreadable file'}`); }
    }
  }
}

async function candidates(source) {
  const result = { files: [], visited: 0, limited: false, errors: [] };
  const root = source.root;
  const accept = filename => {
    const relative = path.relative(root, filename).split(path.sep);
    const name = relative.at(-1);
    if (['claude', 'codex'].includes(source.kind)) return name.endsWith('.jsonl');
    if (source.kind === 'gemini') return /\.(json|jsonl)$/.test(name) && (relative.includes('chats') || path.basename(root) === 'chats');
    if (['cline', 'roo'].includes(source.kind)) return name === 'api_conversation_history.json';
    if (source.kind === 'vscode') return /\.(json|jsonl)$/.test(name) && name !== 'index.json' && ['chatSessions', 'emptyWindowChatSessions', 'transferredChatSessions'].some(folder => relative.includes(folder) || path.basename(root) === folder);
    return false;
  };
  if (source.kind === 'vscode' && path.basename(root) === 'User') {
    // Do not descend into unrelated extension/credential stores.
    for (const relative of ['workspaceStorage', 'globalStorage/emptyWindowChatSessions', 'globalStorage/transferredChatSessions']) {
      const folder = path.join(root, ...relative.split('/'));
      try {
        if (!(await fs.lstat(folder)).isSymbolicLink()) await walk(folder, accept, result);
      } catch (e) { if (!['ENOENT', 'ENOTDIR'].includes(e.code)) result.errors.push(`${relative}: ${e.code || 'unreadable'}`); }
    }
  } else await walk(root, accept, result);
  result.files.sort((a, b) => b.modified - a.modified || a.filename.localeCompare(b.filename));
  // Prefer current operation logs over a legacy snapshot with the same basename.
  const logs = new Set(result.files.filter(f => f.filename.endsWith('.jsonl')).map(f => f.filename.slice(0, -1)));
  result.files = result.files.filter(f => !f.filename.endsWith('.json') || !logs.has(f.filename));
  if (result.files.length > MAX_FILES) result.limited = true;
  result.files = result.files.slice(0, MAX_FILES);
  return result;
}

async function workspaceFolder(filename) {
  const marker = `${path.sep}chatSessions${path.sep}`;
  const index = filename.indexOf(marker);
  if (index < 0) return '';
  try { return localPath(JSON.parse((await readText(path.join(filename.slice(0, index), 'workspace.json'))).raw).folder); }
  catch { return ''; }
}

function context(source, filename, timestamp) {
  const subagent = source.tool === 'claude' && path.relative(source.root, filename).split(path.sep).includes('subagents');
  return { tool: source.tool, host: source.host, identityScope: subagent ? `subagent:${path.basename(filename)}` : source.scope, nativeId: ['cline', 'roo'].includes(source.tool) ? path.basename(path.dirname(filename)) : path.basename(filename).replace(/\.jsonl?$/, ''), timestamp, sourceFormat: subagent ? 'Claude subagent (handoff only)' : undefined };
}

async function legacyOpenCode(root, source, device, acceptSession, report) {
  const result = { files: [], visited: 0, limited: false, errors: [] };
  try { await walk(path.join(root, 'session'), f => f.endsWith('.json'), result); }
  catch (e) { if (['ENOENT', 'ENOTDIR'].includes(e.code)) return; throw e; }
  report.errors.push(...result.errors.slice(0, 10 - report.errors.length));
  report.limited ||= result.limited || result.files.length > MAX_FILES;
  result.files.sort((a, b) => b.modified - a.modified);
  for (const { filename } of result.files.slice(0, MAX_FILES)) {
    try {
      const { raw, timestamp } = await readText(filename); const info = JSON.parse(raw);
      if (!identifier(info.id)) throw new Error('Unsupported OpenCode session identifier.');
      let total = Buffer.byteLength(raw); const messages = [];
      const msgDir = path.join(root, 'message', info.id);
      let messageFiles = []; try { if (!(await fs.lstat(msgDir)).isSymbolicLink()) messageFiles = await fs.readdir(msgDir); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (messageFiles.length > MAX_ROWS) throw new Error('OpenCode message limit exceeded.');
      for (const name of messageFiles.filter(f => f.endsWith('.json')).sort()) {
        const message = await readText(path.join(msgDir, name)); total += Buffer.byteLength(message.raw);
        if (total > MAX_BYTES) throw new Error('OpenCode session exceeds 16 MB.');
        const meta = JSON.parse(message.raw);
        if (!identifier(meta.id)) throw new Error('Unsupported OpenCode message identifier.');
        const parts = [];
        let partFiles = []; const partDir = path.join(root, 'part', meta.id);
        try { if (!(await fs.lstat(partDir)).isSymbolicLink()) partFiles = await fs.readdir(partDir); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        if (partFiles.length > MAX_ROWS) throw new Error('OpenCode part limit exceeded.');
        for (const partFile of partFiles.filter(f => f.endsWith('.json')).sort()) {
          const part = await readText(path.join(partDir, partFile)); total += Buffer.byteLength(part.raw);
          if (total > MAX_BYTES) throw new Error('OpenCode session exceeds 16 MB.');
          parts.push(JSON.parse(part.raw));
        }
        messages.push({ info: meta, parts });
      }
      messages.sort((a, b) => (a.info.time?.created || 0) - (b.info.time?.created || 0) || a.info.id.localeCompare(b.info.id));
      const exportRaw = JSON.stringify({ info, messages });
      await acceptSession(parseTranscript(exportRaw, `${info.id}.json`, device, filename, { ...context(source, filename, timestamp), sourceFormat: 'OpenCode legacy JSON (assembled export)' })); report.read++;
    } catch (e) { report.skipped++; if (report.errors.length < 10) report.errors.push(`${path.basename(filename)}: ${e.message}`); }
  }
}

const rowQueries = {
  message: 'SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created, id LIMIT 10001',
  part: 'SELECT id, message_id, data FROM part WHERE session_id = ? ORDER BY id LIMIT 10001',
  session_message: 'SELECT id, type, data, time_created FROM session_message WHERE session_id = ? ORDER BY seq, id LIMIT 10001'
};
const sizeQueries = {
  message: 'SELECT count(*) AS count, coalesce(sum(length(CAST(data AS BLOB))),0) AS size FROM message WHERE session_id = ?',
  part: 'SELECT count(*) AS count, coalesce(sum(length(CAST(data AS BLOB))),0) AS size FROM part WHERE session_id = ?',
  session_message: 'SELECT count(*) AS count, coalesce(sum(length(CAST(data AS BLOB))),0) AS size FROM session_message WHERE session_id = ?'
};
async function sqliteOpenCode(filename, source, device, acceptSession, report) {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); }
  catch { throw new Error('SQLite reading requires Node.js 22.13+ or a desktop build with node:sqlite. JSON imports still work.'); }
  if ((await fs.lstat(filename)).isSymbolicLink()) return;
  const database = new DatabaseSync(filename, { readOnly: true, allowExtension: false });
  try {
    database.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 1500; BEGIN;');
    const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));
    if (!tables.has('session') || !tables.has('session_message') && !(tables.has('message') && tables.has('part'))) throw new Error('Unsupported OpenCode SQLite schema.');
    const rows = database.prepare('SELECT id, title, directory, time_created, time_updated FROM session ORDER BY time_updated DESC, id LIMIT 501').all();
    report.limited ||= rows.length > MAX_FILES;
    const readRows = (table, id, budget) => {
      const size = database.prepare(sizeQueries[table]).get(id);
      budget.value += Number(size.size);
      if (Number(size.count) > MAX_ROWS || budget.value > MAX_BYTES) throw new Error('OpenCode session exceeds the row or 16 MB limit.');
      return database.prepare(rowQueries[table]).all(id);
    };
    for (const row of rows.slice(0, MAX_FILES)) {
      try {
        const budget = { value: 0 }; let messages = [];
        if (tables.has('session_message')) messages = readRows('session_message', row.id, budget).map(m => ({ ...JSON.parse(m.data), id: m.id, type: m.type, time: { created: m.time_created } }));
        if (!messages.length && tables.has('message') && tables.has('part')) {
          const info = readRows('message', row.id, budget); const parts = readRows('part', row.id, budget);
          const byMessage = new Map();
          for (const part of parts) { if (!byMessage.has(part.message_id)) byMessage.set(part.message_id, []); byMessage.get(part.message_id).push({ ...JSON.parse(part.data), id: part.id }); }
          messages = info.map(m => ({ info: { ...JSON.parse(m.data), id: m.id, time: { created: m.time_created } }, parts: byMessage.get(m.id) || [] }));
        }
        const info = { id: row.id, title: row.title, directory: row.directory, time: { created: row.time_created, updated: row.time_updated } };
        const raw = JSON.stringify({ info, messages });
        await acceptSession(parseTranscript(raw, `${row.id}.json`, device, filename, { ...context(source, filename, row.time_updated), sourceFormat: 'OpenCode SQLite (assembled export)' })); report.read++;
      } catch (e) { report.skipped++; if (report.errors.length < 10) report.errors.push(`OpenCode session: ${e.message}`); }
    }
  } finally { database.close(); }
}

export async function scanSource(source, device, acceptSession) {
  const report = { id: source.id, tool: source.tool, root: source.root, label: source.label, status: source.status, read: 0, changed: 0, skipped: 0, errors: [], limited: false };
  if (source.status !== 'ready') return report;
  const accept = async session => {
    if (session.tool !== source.tool) throw new Error('File does not match this connector.');
    if (await acceptSession(session)) report.changed++;
  };
  try {
    if (source.kind === 'opencode-db') await sqliteOpenCode(source.root, source, device, accept, report);
    else if (source.kind === 'opencode') {
      const entries = await fs.readdir(source.root, { withFileTypes: true });
      const dbs = entries.filter(e => e.isFile() && /^opencode(?:-[a-zA-Z0-9._-]+)?\.db$/.test(e.name));
      for (const entry of dbs) {
        try { await sqliteOpenCode(path.join(source.root, entry.name), source, device, accept, report); }
        catch (e) { if (report.errors.length < 10) report.errors.push(`${entry.name}: ${e.message}`); }
      }
      // Prefer a migrated database; use legacy files only when no DB exists.
      if (!dbs.length) {
        await legacyOpenCode(path.join(source.root, 'storage'), source, device, accept, report);
        const project = path.join(source.root, 'project');
        let projects = []; try { projects = await fs.readdir(project, { withFileTypes: true }); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        for (const entry of projects.slice(0, 100).filter(e => e.isDirectory() && !e.isSymbolicLink())) await legacyOpenCode(path.join(project, entry.name, 'storage'), source, device, accept, report);
      }
    } else {
      const files = await candidates(source); report.errors.push(...files.errors.slice(0, 10)); report.limited = files.limited;
      for (const { filename } of files.files) {
        try {
          const { raw, timestamp } = await readText(filename); const ctx = context(source, filename, timestamp);
          if (source.kind === 'vscode') ctx.projectPath = await workspaceFolder(filename);
          await accept(parseTranscript(raw, path.basename(filename), device, filename, ctx)); report.read++;
        } catch (e) { report.skipped++; if (report.errors.length < 10) report.errors.push(`${path.basename(filename)}: ${e.message}`); }
      }
    }
    report.status = report.errors.length || report.limited ? 'partial' : report.read ? 'scanned' : 'empty';
  } catch (e) { report.status = 'error'; report.errors.push(e.message); }
  return report;
}

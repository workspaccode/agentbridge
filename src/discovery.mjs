import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { TOOL_IDS } from './connectors.mjs';

const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 16);
export function sourceCandidates({ platform = process.platform, home = platform === 'win32' ? process.env.USERPROFILE || os.homedir() : os.homedir(), env = process.env, scanPaths = {} } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const candidates = [];
  const add = (tool, root, kind = tool, host = '', label = host || tool) => {
    const candidate = { id: digest(`${tool}:${root}`), tool, root, kind, host, label, scope: host ? `${host}:${label}` : '' };
    const key = platform === 'win32' ? root.toLowerCase() : root;
    if (!candidates.some(c => c.tool === tool && (platform === 'win32' ? c.root.toLowerCase() : c.root) === key)) candidates.push(candidate);
  };
  add('claude', p.join(env.CLAUDE_CONFIG_DIR || p.join(home, '.claude'), 'projects'), 'claude', '', 'Claude Code transcripts');
  const codex = env.CODEX_HOME || p.join(home, '.codex');
  add('codex', p.join(codex, 'sessions'), 'codex', '', 'Codex sessions');
  add('codex', p.join(codex, 'archived_sessions'), 'codex', '', 'Codex archived sessions');
  add('gemini', p.join(env.GEMINI_CLI_HOME || home, '.gemini', 'tmp'), 'gemini', '', 'Gemini CLI chats');
  const openCode = p.join(env.XDG_DATA_HOME || p.join(home, '.local', 'share'), 'opencode');
  add('opencode', openCode, 'opencode', '', 'OpenCode CLI / desktop');
  if (env.OPENCODE_DB && env.OPENCODE_DB !== ':memory:') add('opencode', p.isAbsolute(env.OPENCODE_DB) ? env.OPENCODE_DB : p.join(openCode, env.OPENCODE_DB), 'opencode-db', '', 'OpenCode database override');

  const appData = platform === 'win32' ? env.APPDATA || p.join(home, 'AppData', 'Roaming') : platform === 'darwin' ? p.join(home, 'Library', 'Application Support') : env.XDG_CONFIG_HOME || p.join(home, '.config');
  const editors = [['Code', 'VS Code'], ['Code - Insiders', 'VS Code Insiders'], ['VSCodium', 'VSCodium'], ['Cursor', 'Cursor'], ['Windsurf', 'Windsurf']];
  const users = editors.map(([folder, host]) => ({ root: p.join(appData, folder, 'User'), host, label: host }));
  if (env.VSCODE_PORTABLE) users.push({ root: p.join(env.VSCODE_PORTABLE, 'user-data', 'User'), host: 'VS Code', label: 'VS Code portable' });
  if (env.VSCODE_APPDATA) users.push({ root: p.join(env.VSCODE_APPDATA, 'Code', 'User'), host: 'VS Code', label: 'VS Code app-data override' });
  for (const user of users) {
    add('vscode', user.root, 'vscode', user.host, user.label);
    add('cline', p.join(user.root, 'globalStorage', 'saoudrizwan.claude-dev', 'tasks'), 'cline', user.host, `${user.label} · Cline`);
    add('roo', p.join(user.root, 'globalStorage', 'rooveterinaryinc.roo-cline', 'tasks'), 'roo', user.host, `${user.label} · Roo Code`);
  }
  // Detect the new Cline SDK store honestly; its schema is distinct from extension tasks.
  add('cline', env.CLINE_SESSION_DATA_DIR || p.join(env.CLINE_DATA_DIR || p.join(env.CLINE_DIR || p.join(home, '.cline'), 'data'), 'sessions'), 'unsupported', 'Cline CLI / SDK', 'Cline SDK store (reader not available)');
  for (const tool of TOOL_IDS) for (const root of scanPaths[tool] || []) {
    add(tool, root, tool === 'opencode' && /\.db$/i.test(root) ? 'opencode-db' : tool, 'Custom location', `Custom ${tool} · ${digest(root).slice(0, 6)}`);
    if (tool === 'vscode') {
      add('cline', p.join(root, 'globalStorage', 'saoudrizwan.claude-dev', 'tasks'), 'cline', 'Custom editor', `Custom editor · Cline · ${digest(root).slice(0, 6)}`);
      add('roo', p.join(root, 'globalStorage', 'rooveterinaryinc.roo-cline', 'tasks'), 'roo', 'Custom editor', `Custom editor · Roo Code · ${digest(root).slice(0, 6)}`);
    }
  }
  return candidates;
}

export function discoverSources(options = {}) {
  const candidates = sourceCandidates(options);
  // Named profiles have their own extension/global storage. Probe only this known directory.
  for (const candidate of [...candidates].filter(c => c.kind === 'vscode')) {
    const profiles = path.join(candidate.root, 'profiles');
    try {
      if (fs.lstatSync(profiles).isSymbolicLink()) continue;
      for (const entry of fs.readdirSync(profiles, { withFileTypes: true }).slice(0, 100)) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const root = path.join(profiles, entry.name);
        for (const [tool, relative] of [['vscode', ''], ['cline', 'globalStorage/saoudrizwan.claude-dev/tasks'], ['roo', 'globalStorage/rooveterinaryinc.roo-cline/tasks']]) {
          const location = relative ? path.join(root, ...relative.split('/')) : root;
          candidates.push({ id: digest(`${tool}:${location}`), tool, root: location, kind: tool, host: candidate.host, label: `${candidate.label} · profile ${entry.name}`, scope: `${candidate.scope}:profile:${entry.name}` });
        }
      }
    } catch { /* A missing profiles folder is normal. */ }
  }
  return candidates.map(candidate => {
    let status = 'not-found', error = '', detected = false;
    try {
      const info = fs.lstatSync(candidate.root);
      if (info.isSymbolicLink()) { status = 'symlink-skipped'; error = 'Symbolic-link roots are not scanned. Add the actual storage directory.'; }
      else if (!(candidate.kind === 'opencode-db' ? info.isFile() : info.isDirectory())) status = 'wrong-type';
      else {
        detected = true; fs.accessSync(candidate.root, fs.constants.R_OK);
        status = candidate.kind === 'unsupported' ? 'unsupported' : 'ready';
        if (candidate.kind === 'unsupported') error = 'New Cline CLI/SDK session storage is distinct from extension task history; export a transcript instead.';
      }
    } catch (e) { if (!['ENOENT', 'ENOTDIR'].includes(e.code)) { status = 'unreadable'; error = 'Storage path is not readable by this user.'; } }
    return { ...candidate, detected, status, error };
  });
}

export function expandScanPath(input, { platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  if (typeof input !== 'string' || !input.trim() || input.length > 4000 || /[\x00-\x1f]/.test(input)) throw new Error('Provide a valid storage path.');
  const p = platform === 'win32' ? path.win32 : path.posix;
  let value = input.trim().replace(/^~(?=[/\\]|$)/, () => home);
  value = value.replace(/%([a-zA-Z_][a-zA-Z\d_]*)%|\$\{([a-zA-Z_][a-zA-Z\d_]*)\}|\$([a-zA-Z_][a-zA-Z\d_]*)/g, (_match, a, b, c) => {
    const key = a || b || c;
    const actual = Object.keys(env).find(name => platform === 'win32' ? name.toUpperCase() === key.toUpperCase() : name === key);
    if (!actual || !env[actual]) throw new Error(`Environment variable ${key} is unavailable. Use an absolute path.`);
    return env[actual];
  });
  if (!p.isAbsolute(value) || platform === 'win32' && !/^(?:[a-z]:[/\\]|\\\\)/i.test(value)) throw new Error('Use an absolute storage path.');
  return p.normalize(value);
}

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export function defaultDataDir() {
  if (process.env.AGENTBRIDGE_DATA_DIR) return process.env.AGENTBRIDGE_DATA_DIR;
  if (process.platform === 'win32') return path.join(process.env.APPDATA || os.homedir(), 'AgentBridge');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'AgentBridge');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'agentbridge');
}

export class Store {
  constructor(directory = defaultDataDir(), name = os.hostname()) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = path.join(directory, 'state.json');
    this.state = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {
      version: 1, device: { id: randomUUID(), name, platform: process.platform },
      settings: { lanEnabled: false, autoSync: true, autoScan: false }, peers: [], sessions: [], activity: []
    };
    this.save();
  }
  save() {
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.state), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }
  log(message) {
    this.state.activity.unshift({ id: randomUUID(), message, timestamp: new Date().toISOString() });
    this.state.activity = this.state.activity.slice(0, 100);
  }
  upsert(session) {
    const index = this.state.sessions.findIndex(s => s.id === session.id);
    if (index < 0) this.state.sessions.unshift(session);
    else {
      const previous = this.state.sessions[index];
      if (previous.fingerprint === session.fingerprint && previous.originNote === session.originNote) return false;
      const note = previous.originNote !== undefined && previous.note === previous.originNote ? session.note : previous.note;
      this.state.sessions[index] = { ...session, shared: previous.shared, starred: previous.starred, note, localProjectPath: previous.localProjectPath };
    }
    this.save();
    return true;
  }
  publicState() {
    return {
      device: this.state.device, settings: this.state.settings,
      peers: this.state.peers.map(({ key, ...peer }) => peer),
      sessions: this.state.sessions.map(({ raw, messages, events, sourcePath, ...s }) => ({ ...s, messageCount: messages.length, eventCount: events.length, preview: messages.findLast(m => m.role === 'assistant')?.text.slice(0, 220) || '' })),
      activity: this.state.activity
    };
  }
}

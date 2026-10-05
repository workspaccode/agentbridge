/* AgentBridge renderer: local HTTP API only, no Node.js access. */
const icons = {
  sessions: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h6M8 17h4"/>',
  project: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/>',
  devices: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 21h8m-4-5v5"/>',
  integrations: '<path d="M8 3v4m8-4v4M6 7h12v5a6 6 0 0 1-12 0zm6 11v3"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  settings: '<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  sync: '<path d="M20 8a8 8 0 0 0-14-2L3 9m0-6v6h6M4 16a8 8 0 0 0 14 2l3-3m0 6v-6h-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10m12-10v3c0 3-3 3-6 3H6"/>',
  message: '<path d="M21 4H3v14h5l4 3 4-3h5z"/><path d="M7 9h10M7 13h6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-7z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.sessions}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = document.querySelector('#app'), modal = document.querySelector('#modal');
const initialToken = location.hash.slice(1);
if (initialToken) { sessionStorage.setItem('agentbridge-token', initialToken); history.replaceState(null, '', '/'); }
let token = sessionStorage.getItem('agentbridge-token') || '';
let state, page = 'sessions', filter = 'all', sort = 'recent', query = '', selected = null, detailTab = 'conversation', dirty = false, searchIds = null, searchTimer, toastTimer;
const tools = () => state.connectors;
const tool = id => tools().find(c => c.id === id) || tools().at(-1);
const relative = timestamp => {
  if (!timestamp) return 'Not yet';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(timestamp)) / 60000));
  if (minutes < 1) return 'Just now'; if (minutes < 60) return `${minutes}m ago`; if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
};
const platform = id => ({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[id] || id);
function toast(message, error = false) { const el = document.querySelector('#toast'); el.textContent = message; el.className = `show${error ? ' error' : ''}`; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.className = '', 4800); }
async function api(route, options = {}) {
  const response = await fetch(`/api/${route}`, { ...options, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers }, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
async function refresh(render = true) { state = await api('state'); if (render) draw(); }
const button = (label, action, symbol, classes = '', attrs = '') => `<button class="${classes}" data-action="${action}" ${attrs}>${symbol ? icon(symbol) : ''}${label}</button>`;
function pill(session) { return session.demo ? '<span class="pill demo">Example</span>' : session.originDevice !== state.device.id ? `<span class="pill remote">${session.receivedVia === 'internet' ? 'Internet copy' : 'LAN copy'}</span>` : session.shared ? '<span class="pill shared"><i class="dot"></i>Shared</span>' : '<span class="pill">Private</span>'; }
function toolAvatar(id) { return `<div class="tool-avatar ${esc(id)}">${esc(tool(id).short)}</div>`; }

function shell(body) {
  const nav = [['sessions', 'All sessions', 'sessions'], ['projects', 'Projects', 'project'], ['devices', 'Devices', 'devices'], ['internet', 'Internet sharing', 'globe'], ['integrations', 'Integrations', 'integrations'], ['activity', 'Activity', 'activity']];
  return `<div class="shell"><aside class="sidebar"><div class="brand"><img src="/icon.svg" alt=""><span>AgentBridge<em>KEEP YOUR CONTEXT</em></span></div><div class="workspace"><div class="avatar">P</div><div><strong>Personal workspace</strong><small>Local-first · v0.3.0</small></div>${icon('down')}</div><div class="nav-label">WORKSPACE</div><nav class="nav">${nav.map(([id, name, symbol]) => `<button data-action="nav" data-page="${id}" class="${page === id ? 'active' : ''}" title="${name}">${icon(symbol)}<span>${name}</span>${id === 'sessions' ? `<span class="nav-count">${state.sessions.length}</span>` : ''}</button>`).join('')}</nav><div class="sidebar-bottom"><nav class="nav"><button data-action="nav" data-page="settings" class="${page === 'settings' ? 'active' : ''}">${icon('settings')}<span>Settings</span></button></nav><div class="local-status"><i class="dot"></i>Local workspace ready</div><div class="side-device"><div class="avatar">${icon('devices')}</div><div><strong>${esc(state.device.name)}</strong><small>${platform(state.device.platform)} · this device</small></div></div></div></aside><main class="main"><header class="topbar"><div class="breadcrumb">Workspace <span>/</span> <b>${selected ? 'Session' : page === 'sessions' ? 'All sessions' : page.charAt(0).toUpperCase() + page.slice(1)}</b></div><div class="top-meta"><span class="pill">${icon('lock')}Local-first</span><span><i class="dot ${state.lan.enabled ? '' : 'off'}"></i> ${state.lan.enabled ? 'LAN sharing enabled' : 'LAN sharing off'}</span></div></header><div class="content">${body}<div class="footer-note">${icon('lock')}You choose what to share. Internet transfers are encrypted between paired devices.</div></div></main></div>`;
}
function header(title, subtitle, actions = '', eyebrow = '') {
  return `<div class="page-header"><div>${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}<h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="actions">${actions}</div></div>`;
}
function samples() { return state.sessions.some(s => s.demo) ? `<div class="sample-banner"><span>Example sessions are visible. They are fictional, cannot be shared, and do not represent your devices.</span>${button('Remove examples', 'remove-demo', 'close', 'ghost')}</div>` : ''; }
function empty() { return `<div class="empty"><div class="empty-icon">${icon('sessions')}</div><h2>Your next session starts here.</h2><p>Bring your AI coding history into one place. Find a conversation, carry its context, and pick up on another computer.</p><div class="actions">${button('Scan this computer', 'scan', 'search', 'primary')}${button('Import transcript', 'import', 'upload')}</div>${button('Explore example sessions', 'demo', 'arrow', 'ghost link')}</div>`; }
function sessionCard(s) {
  return `<article class="session-card" data-action="session" data-id="${esc(s.id)}" role="button" tabindex="0" aria-label="Open ${esc(s.title)}"><div class="session-top">${toolAvatar(s.tool)}<div><h3 class="session-title">${esc(s.title)}</h3><div class="session-meta"><span>${esc(tool(s.tool).name)}</span><span>·</span>${icon('project')}<span>${esc(s.projectName)}</span>${s.branch ? `<span>·</span>${icon('branch')}<span>${esc(s.branch)}</span>` : ''}</div></div>${button('', 'star', 'star', `ghost icon-button star ${s.starred ? 'selected' : ''}`, `data-id="${esc(s.id)}" aria-label="${s.starred ? 'Unstar' : 'Star'} session"`)}</div><p class="session-desc">${esc(s.preview || 'Open this session to view its conversation and recorded activity.')}</p><div class="session-footer">${pill(s)}${icon('devices')}<span>${s.originDevice === state.device.id ? 'This device' : esc(s.originName)}</span>${icon('message')}<span>${s.messageCount} messages</span><span class="time">${relative(s.updatedAt)}</span>${icon('arrow')}</div></article>`;
}
function sessionMatches(s) { return (filter === 'all' || (filter === 'starred' ? s.starred : s.tool === filter)) && (!query || !searchIds || searchIds.has(s.id)); }
function sortedSessions() { return state.sessions.filter(sessionMatches).sort(sort === 'title' ? (a, b) => a.title.localeCompare(b.title) : (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)); }
function sessionsPage() {
  const real = state.sessions.filter(s => !s.demo);
  const groups = new Set(real.map(s => s.projectName));
  const stats = [['sessions', 'Real sessions', real.length, 'All connected tools'], ['integrations', 'Active connectors', new Set(real.map(s => s.tool)).size, `${tools().length} supported connectors`], ['devices', 'Paired devices', state.peers.length, state.lan.enabled ? 'Encrypted LAN transport' : 'Enable LAN to connect'], ['project', 'Projects', groups.size, 'Context tied to your code']];
  const list = sortedSessions();
  return header('Your sessions, everywhere.', 'One home for your AI coding conversations. Pick up where you left off.', button('Scan local sessions', 'scan', 'sync') + button('Import session', 'import', 'plus', 'primary'), 'A little less starting over') + samples() + `<div class="stats">${stats.map(([symbol, label, value, foot]) => `<div class="stat"><div class="stat-label">${icon(symbol)}${label}</div><div class="stat-value">${value}<span></span></div><div class="stat-foot ${symbol === 'devices' && state.lan.enabled ? 'green' : ''}">${foot}</div></div>`).join('')}</div><div class="dashboard-grid"><section><div class="filter-row">${[['all', 'All sessions'], ...tools().map(c => [c.id, c.name]), ['starred', 'Starred']].map(([id, label]) => `<button data-action="filter" data-filter="${id}" class="${filter === id ? 'active' : ''}">${label}${id === 'all' ? `<span class="filter-count">${state.sessions.length}</span>` : ''}</button>`).join('')}</div><div class="toolbar"><div class="search">${icon('search')}<input id="search" placeholder="Search conversations, projects, or tool activity…" aria-label="Search sessions" value="${esc(query)}"></div><select id="sort" aria-label="Sort sessions"><option value="recent" ${sort === 'recent' ? 'selected' : ''}>Most recent</option><option value="title" ${sort === 'title' ? 'selected' : ''}>Title A–Z</option></select></div><div class="results-label"><span id="result-count">${list.length} session${list.length === 1 ? '' : 's'}</span><span>Stored locally</span></div><div class="session-list" id="session-list">${state.sessions.length ? list.map(sessionCard).join('') || '<div class="empty"><h2>No matching sessions</h2><p>Try another search or tool filter.</p></div>' : empty()}</div></section><aside class="dashboard-rail"><div class="rail-section"><div class="rail-heading"><h2>Your devices</h2><span>${1 + state.peers.length} total</span></div>${deviceRow(state.device, true)}${state.peers.map(p => deviceRow(p)).join('')}${button('Connect another device', 'nav', 'plus', 'rail-cta', 'data-page="devices"')}</div><div class="rail-section"><div class="rail-heading"><h2>Recent activity</h2>${button('View all', 'nav', '', 'ghost small', 'data-page="activity"')}</div>${state.activity.slice(0, 4).map(a => `<div class="activity-item">${esc(a.message)}<small>${relative(a.timestamp)}</small></div>`).join('') || '<p class="subtitle">Imports and sync updates will appear here.</p>'}</div><div class="hint-card">${icon('bolt')}<h3>Different agent. Same context.</h3><p>Carry a conversation from Claude Code to Codex, OpenCode, or your editor with a portable handoff.</p>${button('See integrations', 'nav', 'arrow', '', 'data-page="integrations"')}</div></aside></div>`;
}
function deviceRow(device, local = false) { return `<div class="device-row"><div class="device-icon">${icon('devices')}</div><div><strong>${esc(device.name)}</strong><small>${platform(device.platform)} · ${local ? 'This device' : device.status === 'online' ? 'Last contacted ' + relative(device.lastSync) : 'Not connected'}</small></div><i class="dot ${local || device.status === 'online' ? '' : 'off'}"></i></div>`; }
function devicesPage() {
  return header('Keep your computers connected.', 'Pair once, then share selected sessions over your local network.', button('Sync now', 'sync', 'sync') + button('Create invitation', 'invite', 'plus', 'primary')) + `<div class="notice">${icon('lock')}Session payloads use authenticated AES-256-GCM encryption. Only a computer with your one-time invitation can pair. The invitation expires in 10 minutes.</div><div class="panels"><section class="panel"><div class="panel-header"><div class="device-icon">${icon('devices')}</div><div><h2>${esc(state.device.name)}</h2><div class="tagline">THIS COMPUTER</div></div><span class="pill">${platform(state.device.platform)}</span></div><div class="setting-row"><div><strong>LAN sharing</strong><p>Allow paired devices to exchange selected sessions. Your desktop control API stays on localhost.</p></div><input type="checkbox" class="toggle" data-setting="lanEnabled" aria-label="Enable LAN sharing" ${state.settings.lanEnabled ? 'checked' : ''}></div><div class="field"><label>LAN address</label><code>${state.lan.addresses.length ? state.lan.addresses.map(esc).join(' · ') : 'No private IPv4 interface detected'} : ${state.lan.port}</code><small>Both computers must be online on the same LAN. Automatic discovery is planned; this version pairs by address.</small></div></section><section class="panel"><h2>Join another computer</h2><p>Create an invitation on your other computer, then paste it here. Enable LAN sharing on both devices.</p><form id="pair-form"><div class="field"><label for="invitation">Pairing invitation</label><textarea id="invitation" placeholder="AB1|192.168.1.25|47832|invitation-id|one-time-code" required></textarea></div><button class="primary" type="submit">${icon('devices')}Pair computer</button></form></section></div><div class="spaced row-between"><h2>Paired computers</h2><span class="muted small">${state.peers.length} trusted device${state.peers.length === 1 ? '' : 's'}</span></div><div class="panels spaced">${state.peers.map(p => `<section class="panel device-card"><div class="panel-header"><div class="device-icon">${icon('devices')}</div><div><h2 class="device-name">${esc(p.name)}</h2><p class="subtitle">${platform(p.platform)}</p></div><span class="pill"><i class="dot ${p.status === 'online' ? '' : 'off'}"></i>${p.status === 'online' ? 'Last sync succeeded' : 'Offline / paired'}</span></div><div class="device-address">${esc(p.host)}:${p.port}</div><p class="last-sync">Last synchronized: ${relative(p.lastSync)}</p>${p.error ? `<p class="error-text">${esc(p.error)}</p>` : ''}${button('Revoke access', 'revoke', 'close', 'ghost small danger', `data-id="${esc(p.id)}"`)}</section>`).join('') || '<p class="subtitle">No paired computers yet. Create an invitation to connect your second machine.</p>'}</div>`;
}
function internetPage() {
  const net = state.internet;
  return header('Share sessions across the Internet.', 'Connect by device ID, approve the request, and carry your coding context across networks.', button('Check requests & sync', 'internet-sync', 'sync', 'primary')) +
    `<div class="notice">${icon('lock')}Your ID identifies this device. Pairing requires approval on the other computer. Only selected sessions are shared; the relay stores encrypted payloads.</div>
    <div class="panels"><section class="panel"><h2>Your device ID</h2><p>This ID stays the same after restarting the app. Give it to your other computer.</p><div class="public-device-id mono">${esc(net.publicId)}</div><div class="actions spaced">${button('Copy my ID', 'copy-public-id', 'copy')}</div><div class="field"><label>Relay connection</label><span class="pill ${net.status === 'connected' ? 'shared' : ''}">${esc(net.enabled ? net.status : 'Disabled')}</span><small>${net.lastContact ? 'Relay last contacted: ' + relative(net.lastContact) : 'Configure the same HTTPS relay on both computers.'}</small></div>${net.error ? `<p class="error-text">${esc(net.error)}</p>` : ''}</section>
    <section class="panel"><h2>Connect using an ID</h2><p>Enter the ID shown on your other computer. It will receive a request to approve this connection.</p><form id="internet-connect-form"><div class="field"><label for="remote-device-id">Other device ID</label><input id="remote-device-id" class="mono" placeholder="AB-123456-ABCDEF-123456-ABCDEF" maxlength="32" required></div><button type="submit" class="primary" ${net.enabled ? '' : 'disabled'}>${icon('plus')}Request connection</button></form>${!net.enabled ? '<p class="subtitle">Save the relay configuration below to enable Internet sharing.</p>' : ''}</section></div>
    <section class="panel spaced"><h2>Internet relay configuration</h2><p>Both computers need the same HTTPS relay URL and its access code. No incoming ports are needed on your computers. Run the included relay on a server using the deployment guide in docs/INTERNET.md.</p><form id="internet-settings-form"><div class="panels"><div class="field"><label for="relay-url">HTTPS relay URL</label><input id="relay-url" type="url" placeholder="https://relay.example.com" value="${esc(net.relayUrl)}" required></div><div class="field"><label for="relay-token">Relay access code</label><input id="relay-token" type="password" autocomplete="off" placeholder="${net.tokenConfigured ? 'Saved — leave blank to keep it' : '32–200 characters'}" maxlength="200" ${net.tokenConfigured ? '' : 'required'}><small>Access codes and device private keys stay in this computer's local store.</small></div></div><div class="setting-row"><div><strong>Enable Internet sharing</strong><p>Check for connection requests every 15 seconds. Automatic session publishing follows your automatic synchronization setting.</p></div><input id="internet-enabled" type="checkbox" class="toggle" aria-label="Enable Internet sharing" ${net.enabled ? 'checked' : ''}></div><button type="submit">${icon('check')}Save Internet settings</button></form></section>
    ${net.incoming.length ? `<section class="panel spaced"><h2>Connection requests</h2><p>Compare the ID with the one on the other computer before approving.</p>${net.incoming.map(r => `<div class="internet-request"><div><strong>${esc(r.device.name)}</strong><p class="mono">${esc(r.publicId)}</p><small class="muted">${platform(r.device.platform)} · ${relative(r.createdAt)}</small></div><div class="actions">${button('Reject & block', 'internet-reject', 'close', 'small danger', `data-request="${esc(r.requestId)}"`)}${button('Approve connection', 'internet-approve', 'check', 'primary small', `data-request="${esc(r.requestId)}"`)}</div></div>`).join('')}</section>` : ''}
    ${net.outgoing.length ? `<section class="panel spaced"><h2>Waiting for approval</h2>${net.outgoing.map(r => `<div class="context-row"><b class="mono">${esc(r.publicId)}</b><span>Open Internet sharing on that device and approve.</span></div>`).join('')}</section>` : ''}
    <div class="row-between spaced"><h2>Internet connections</h2><span class="muted small">${net.peers.length} paired</span></div><div class="panels spaced">${net.peers.map(p => `<section class="panel"><div class="panel-header"><div class="device-icon">${icon('globe')}</div><div><h2>${esc(p.name)}</h2><p class="subtitle">${platform(p.platform)}</p></div><span class="pill">${p.status === 'queued' ? 'Update queued' : p.status === 'received' ? 'Update received' : 'Paired'}</span></div><p class="mono public-peer-id">${esc(p.publicId)}</p><p class="subtitle">Last received update: ${relative(p.lastSync)}. Queued updates can be collected later.</p>${p.error ? `<p class="error-text">${esc(p.error)}</p>` : ''}<div class="actions spaced">${button('Revoke Internet access', 'internet-revoke', 'close', 'small danger', `data-id="${esc(p.publicId)}"`)}</div></section>`).join('') || '<p class="subtitle">No Internet connections yet. Send a connection request using the other device’s ID.</p>'}</div>
    ${net.blocked.length ? `<section class="panel spaced"><h2>Blocked IDs</h2>${net.blocked.map(id => `<div class="row-between spaced"><code>${esc(id)}</code>${button('Unblock', 'internet-unblock', '', 'small', `data-id="${esc(id)}"`)}</div>`).join('')}</section>` : ''}`;
}
function projectsPage() {
  const groups = new Map();
  for (const s of state.sessions) { if (!groups.has(s.projectName)) groups.set(s.projectName, []); groups.get(s.projectName).push(s); }
  return header('The context behind your code.', 'Sessions grouped by project. Map a local folder before continuing on another computer.') + samples() + `<div class="project-grid">${[...groups.entries()].map(([name, items]) => `<section class="panel project-card">${icon('project')}<h2>${esc(name)}</h2><p>${esc(items[0].localProjectPath || items[0].projectPath || 'No folder recorded')}</p><div class="capabilities">${[...new Set(items.map(s => s.tool))].map(id => `<span class="pill">${esc(tool(id).name)}</span>`).join('')}</div><div class="row-between"><span class="muted small">${items.length} session${items.length === 1 ? '' : 's'}</span>${button('Open latest', 'session', 'arrow', 'small', `data-id="${esc(items.sort((a,b) => new Date(b.updatedAt)-new Date(a.updatedAt))[0].id)}"`)}</div></section>`).join('') || empty()}</div>`;
}
function sourceLocation(source) {
  const last = source.lastScan;
  const status = source.status === 'ready' && last ? last.status : source.status;
  const label = { ready: 'Ready to scan', scanned: 'Read successfully', empty: 'No supported sessions', partial: 'Some files skipped', error: 'Read failed', 'not-found': 'Not found', unreadable: 'Permission required', unsupported: 'Reader unavailable', 'symlink-skipped': 'Symlink skipped', 'wrong-type': 'Wrong path type' }[status] || status;
  return `<div class="source-location"><div class="row-between"><strong>${esc(source.label)}</strong><span class="pill ${status === 'scanned' ? 'shared' : ''}">${esc(label)}</span></div><code>${esc(source.root)}</code>${last && source.detected ? `<small>${last.read} sessions read · ${last.skipped} skipped${last.limited ? ' · scan limit reached' : ''}</small>` : ''}${source.error ? `<small class="error-text">${esc(source.error)}</small>` : ''}${last?.errors.length ? `<details><summary>Read errors (${last.errors.length})</summary><pre>${esc(last.errors.join('\n'))}</pre></details>` : ''}</div>`;
}
function integrationsPage() {
  const custom = state.settings.scanPaths || {};
  return header('Your tools. One session library.', 'Automatically find IDE and CLI histories on this computer. Scanning keeps every session private.', button('Scan all sources', 'scan', 'search', 'primary') + button('Import transcript', 'import', 'upload')) + `<div class="notice">${icon('info')}Paths are detected for ${platform(state.device.platform)}. A detected folder is not proof its chat format is supported. Last scan: ${state.scanSummary ? relative(state.scanSummary.timestamp) : 'Not run yet'}.</div><div class="panels">${tools().map(c => {
    const found = c.sources.filter(s => s.detected || !['not-found', 'wrong-type'].includes(s.status));
    const absent = c.sources.filter(s => !found.includes(s));
    return `<section class="panel connector-panel" data-connector="${esc(c.id)}"><div class="panel-header">${toolAvatar(c.id)}<div><h2>${esc(c.name)}</h2><p class="subtitle">${esc(c.mode)}</p></div><span class="pill ${c.detected ? 'shared' : ''}">${found.filter(s => s.detected && s.kind !== 'unsupported').length} paths found</span></div><p class="connector-detail">${esc(c.description)}</p><div class="capabilities"><span class="pill shared">View history</span><span class="pill shared">Context handoff</span><span class="pill">${c.nativeResume ? 'Local CLI resume command' : 'Handoff / original export'}</span></div>${found.map(sourceLocation).join('')}${absent.length ? `<details class="checked-paths"><summary>Other paths checked (${absent.length})</summary>${absent.map(sourceLocation).join('')}</details>` : ''}<div class="actions">${button('Scan this tool', 'scan', 'search', 'small', `data-tool="${esc(c.id)}"`)}${button('Add storage path', 'add-path', 'plus', 'small', `data-tool="${esc(c.id)}"`)}</div>${(custom[c.id] || []).length ? `<div class="custom-paths"><strong>Custom locations</strong>${custom[c.id].map((root, i) => `<div><code>${esc(root)}</code>${button('', 'remove-path', 'close', 'ghost icon-button', `data-tool="${esc(c.id)}" data-index="${i}" aria-label="Remove custom path"`)}</div>`).join('')}</div>` : ''}</section>`;
  }).join('')}</div><div class="notice warning spaced">${icon('info')}Native Cursor/Windsurf chats, JetBrains assistants and new Cline SDK/CLI databases need separate readers. Supported Cline/Roo task files inside compatible editors are scanned. WSL, SSH and container histories need an accessible custom location or exported transcript.</div>`;
}
function activityPage() { return header('A timeline of your workspace.', 'Imports, local scans, pairing, and session transfers.') + `<div class="panel activity-full">${state.activity.map(a => `<div class="activity-item">${esc(a.message)}<small>${new Date(a.timestamp).toLocaleString()}</small></div>`).join('') || '<p class="muted">No activity yet. Import a session or pair another computer to get started.</p>'}</div>`; }
function settingsPage() {
  return header('Make yourself at home.', 'Local settings for this computer.') + `<div class="panel"><h2>Device identity</h2><form id="name-form"><div class="field"><label for="device-name">Computer name</label><input id="device-name" value="${esc(state.device.name)}" maxlength="100" required></div><button type="submit" class="small">Save name</button></form><div class="setting-row"><div><strong>Automatic session synchronization</strong><p>Sync LAN devices every 30 seconds and publish Internet updates every 15 seconds when those channels are enabled. Only selected sessions are sent.</p></div><input type="checkbox" class="toggle" data-setting="autoSync" aria-label="Automatic synchronization" ${state.settings.autoSync ? 'checked' : ''}></div><div class="setting-row"><div><strong>Refresh local transcripts automatically</strong><p>Refresh supported IDE and CLI histories every minute. Reads source files without modifying them.</p></div><input type="checkbox" class="toggle" data-setting="autoScan" aria-label="Automatic transcript scan" ${state.settings.autoScan ? 'checked' : ''}></div><div class="setting-row"><div><strong>Example sessions</strong><p>Explore the interface using fictional conversations. Examples are excluded from LAN sharing.</p></div>${button(state.sessions.some(s => s.demo) ? 'Remove examples' : 'Load examples', state.sessions.some(s => s.demo) ? 'remove-demo' : 'demo', '', 'small')}</div></div><div class="panel spaced"><h2>About this version</h2><p>AgentBridge 0.3.0 · Windows / macOS / Linux source project.</p><p>Local session database, transcript import, cross-tool handoff, encrypted LAN sync, and Internet sharing by device ID are implemented. Remote native state restoration, automatic device discovery, source code transfer, and OS credential-vault storage are planned. Session data and pairing keys are stored in a local file protected by OS file permissions; disk encryption is managed by your operating system.</p></div>`;
}
function detailPage(s) {
  const remote = s.originDevice !== state.device.id;
  const rows = [['Tool', tool(s.tool).name], ['Editor / source', s.sourceHost || 'CLI / imported transcript'], ['Format', s.sourceFormat || 'Original transcript'], ['Project', s.projectName], ['Branch', s.branch || 'Not recorded'], ['Commit', s.commit ? s.commit.slice(0, 12) : 'Not recorded'], ['Source device', s.originName], ['Messages', s.messages.length], ['Tool events', s.events.length]];
  return button('All sessions', 'back', 'back', 'ghost back') + `<div class="page-header detail-header"><div><p class="eyebrow">${esc(tool(s.tool).name)} SESSION</p><h1>${esc(s.title)}</h1><p class="subtitle">${esc(s.projectName)} · Updated ${relative(s.updatedAt)} · ${remote ? esc(s.originName) : 'This device'} ${pill(s)}</p></div><div class="actions">${button('Export', 'export', 'download', '', `data-id="${esc(s.id)}"`)}${button('Continue', 'continue', 'arrow', 'primary', `data-id="${esc(s.id)}"`)}</div></div>${s.demo ? '<div class="notice warning">'+icon('info')+'This is a fictional example. Native resume and LAN sharing are unavailable.</div>' : ''}<div class="detail-layout"><section><div class="detail-tabs">${button(`Conversation (${s.messages.length})`, 'detail-tab', 'message', detailTab === 'conversation' ? 'active' : '', 'data-tab="conversation"')}${button(`Tool activity (${s.events.length})`, 'detail-tab', 'terminal', detailTab === 'tools' ? 'active' : '', 'data-tab="tools"')}${button('Original transcript', 'raw', 'download', 'ghost', `data-id="${esc(s.id)}"`)}</div>${detailTab === 'conversation' ? `<div class="conversation">${s.messages.map(m => `<article class="message ${esc(m.role)}"><div class="avatar">${m.role === 'user' ? 'YOU' : tool(s.tool).short}</div><div class="message-body"><div class="message-heading">${m.role === 'user' ? 'You' : m.role === 'assistant' ? esc(tool(s.tool).name) : esc(m.role)}<time>${new Date(m.timestamp).toLocaleString()}</time></div><div class="message-text">${esc(m.text)}</div></div></article>`).join('')}</div>` : `<div class="conversation">${s.events.map(e => `<details class="tool-event"><summary>${esc(e.name)} · ${relative(e.timestamp)}</summary><h4>Input</h4><pre>${esc(e.input || '(Not recorded)')}</pre><h4>Output</h4><pre>${esc(e.output || '(Not recorded)')}</pre></details>`).join('') || '<p class="muted">No supported tool events found in this transcript.</p>'}</div>`}</section><aside class="detail-rail"><section class="panel"><h2>Session context</h2>${rows.map(([label, value]) => `<div class="context-row"><span>${label}</span><b>${esc(value)}</b></div>`).join('')}<div class="setting-row"><div><strong>Share with paired devices</strong><p>${remote ? 'Received copies are not relayed.' : s.demo ? 'Examples stay local.' : 'Includes the transcript and tool output over enabled LAN and Internet connections. Review first.'}</p></div><input type="checkbox" class="toggle" data-session-share="${esc(s.id)}" aria-label="Share this session with paired devices" ${s.shared ? 'checked' : ''} ${s.demo || remote ? 'disabled' : ''}></div></section><section class="panel"><h2>Continue with context</h2><form id="context-form" data-id="${esc(s.id)}"><div class="field"><label for="local-path">Project folder on this computer</label><input id="local-path" placeholder="${state.device.platform === 'win32' ? 'C:\\Projects\\my-app' : '/Users/me/projects/my-app'}" value="${esc(s.localProjectPath || (remote ? '' : s.projectPath))}"><small>Code files are not transferred by session sync.</small></div><div class="field"><label for="handoff-note">What should the next agent know?</label><textarea id="handoff-note" placeholder="Current progress, blockers, and next steps…">${esc(s.note)}</textarea></div><button class="full-width small" type="submit">Save context</button></form>${button('Create handoff', 'handoff', 'bolt', 'ghost small full-width spaced', `data-id="${esc(s.id)}"`)}</section></aside></div>`;
}
function draw() {
  if (!state) return;
  const pages = { sessions: sessionsPage, devices: devicesPage, internet: internetPage, projects: projectsPage, integrations: integrationsPage, activity: activityPage, settings: settingsPage };
  app.innerHTML = shell(selected ? detailPage(selected) : pages[page]());
}
function openModal(title, content, actions = '') { modal.innerHTML = `<div class="modal-head"><h2>${title}</h2>${button('', 'close-modal', 'close', 'ghost icon-button', 'aria-label="Close dialog"')}</div>${content}${actions ? `<div class="actions">${actions}</div>` : ''}`; if (!modal.open) modal.showModal(); }
async function copy(content) {
  try { await navigator.clipboard.writeText(content); toast('Copied to clipboard'); }
  catch { openModal('Copy this text', '<p>Select the text below and copy it.</p><textarea id="copy-fallback" readonly></textarea>'); const field = modal.querySelector('textarea'); field.value = content; field.focus(); field.select(); }
}
function download(name, content, type = 'application/json') {
  const link = document.createElement('a'); const url = URL.createObjectURL(new Blob([content], { type }));
  link.href = url; link.download = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 140); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function importFiles(files) {
  let count = 0, errors = [];
  for (const file of files) {
    try { if (file.size > 16 * 1024 * 1024) throw new Error('File exceeds 16 MB.'); await api('import', { method: 'POST', body: { filename: file.name, content: await file.text() } }); count++; }
    catch (error) { errors.push(`${file.name}: ${error.message}`); }
  }
  selected = null; page = 'sessions'; await refresh();
  toast(`${count} session${count === 1 ? '' : 's'} imported${errors.length ? `. ${errors.join(' · ')}` : ''}`, errors.length > 0);
}

document.addEventListener('click', async event => {
  const el = event.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const action = el.dataset.action, id = el.dataset.id;
  try {
    if (dirty && ['nav', 'back', 'session', 'demo', 'remove-demo'].includes(action)) throw new Error('Save your continuation context before leaving this session.');
    if (action === 'nav') { page = el.dataset.page; selected = null; query = ''; searchIds = null; draw(); return; }
    if (action === 'back') { selected = null; page = 'sessions'; draw(); return; }
    if (action === 'filter') { filter = el.dataset.filter; draw(); return; }
    if (action === 'import') { document.querySelector('#file-input').click(); return; }
    if (action === 'add-path') {
      const connector = tool(el.dataset.tool);
      const help = { claude: 'Choose the projects transcript directory.', codex: 'Choose a sessions or archived_sessions directory.', gemini: 'Choose the .gemini/tmp directory or a chats directory.', opencode: 'Choose the OpenCode data directory or a specific .db file.', vscode: 'Choose the editor User directory containing workspaceStorage and globalStorage.', cline: 'Choose the extension tasks directory containing task folders.', roo: 'Choose the Roo Code tasks directory containing task folders.' }[connector.id];
      openModal(`Add a ${connector.name} storage path`, `<form id="scan-path-form" data-tool="${esc(connector.id)}"><p>${esc(help)} Automatic locations remain enabled. You can add up to eight custom locations.</p><div class="field"><label for="scan-path">Storage path on this computer</label><input id="scan-path" required maxlength="4000" placeholder="${state.device.platform === 'win32' ? 'C:\\Users\\me\\AppData\\Roaming\\Code\\User' : '/Users/me/Library/Application Support/Code/User'}"><small>Absolute paths, ~, and available environment variables are accepted.</small></div><button type="submit" class="primary">Save location</button></form>`); return;
    }
    if (action === 'remove-path') {
      const connector = el.dataset.tool;
      const paths = (state.settings.scanPaths[connector] || []).filter((_root, i) => i !== Number(el.dataset.index));
      await api('scan-paths', { method: 'PATCH', body: { tool: connector, paths } }); await refresh(); toast('Custom location removed. Imported sessions stay in your library.'); return;
    }
    if (action === 'close-modal') { modal.close(); return; }
    if (action === 'copy-public-id') { await copy(state.internet.publicId); return; }
    if (action === 'internet-sync') { el.disabled = true; const result = await api('internet/sync', { method: 'POST' }); await refresh(); const failed = result.results.filter(r => !r.ok); toast(result.busy ? 'Internet synchronization is already running' : failed.length ? 'Some updates could not be queued. Check connection details.' : 'Internet requests checked; selected updates queued for paired devices.', failed.length > 0); return; }
    if (action === 'internet-approve' || action === 'internet-reject') { el.disabled = true; await api(`internet/${action === 'internet-approve' ? 'approve' : 'reject'}`, { method: 'POST', body: { requestId: el.dataset.request } }); await refresh(); toast(action === 'internet-approve' ? 'Connection approved. Synchronize to share selected sessions.' : 'Request rejected and ID blocked'); return; }
    if (action === 'internet-revoke') { openModal('Revoke Internet access?', '<p>Future updates from this ID will be rejected. Already downloaded sessions cannot be remotely erased.</p>', button('Cancel', 'close-modal', '') + button('Revoke access', 'internet-confirm-revoke', 'close', 'danger', `data-id="${esc(id)}"`)); return; }
    if (action === 'internet-confirm-revoke') { const result = await api('internet/revoke', { method: 'POST', body: { id } }); modal.close(); await refresh(); toast(result.notified ? 'Internet access revoked; peer notified' : 'Access blocked locally. The relay could not be notified.'); return; }
    if (action === 'internet-unblock') { await api('internet/unblock', { method: 'POST', body: { id } }); await refresh(); toast('ID unblocked. A new pairing request still needs approval.'); return; }
    if (action === 'session') { selected = await api(`sessions/${encodeURIComponent(id)}`); dirty = false; detailTab = 'conversation'; draw(); window.scrollTo(0, 0); return; }
    if (action === 'detail-tab') { detailTab = el.dataset.tab; draw(); return; }
    if (action === 'star') { const s = state.sessions.find(s => s.id === id); await api(`sessions/${encodeURIComponent(id)}`, { method: 'PATCH', body: { starred: !s.starred } }); await refresh(); return; }
    if (action === 'scan') { el.disabled = true; const result = await api('scan', { method: 'POST', body: el.dataset.tool ? { tool: el.dataset.tool } : undefined }); await refresh(); if (result.errors.length || result.limited) openModal('Scan completed with skipped files', `<p>${result.changed} sessions updated. ${result.skipped} files skipped.${result.limited ? ' Scan limit reached; see Integrations for details.' : ''}</p><pre>${esc(result.errors.join('\n'))}</pre>`); else toast(result.changed ? `${result.changed} sessions added or updated` : 'No new sessions found. Import an export file or check the integration folders.'); return; }
    if (action === 'demo' || action === 'remove-demo') { await api('demo', { method: action === 'demo' ? 'POST' : 'DELETE' }); selected = null; await refresh(); toast(action === 'demo' ? 'Fictional example sessions loaded' : 'Examples removed'); return; }
    if (action === 'sync') { if (!state.lan.enabled) throw new Error('Enable LAN sharing on the Devices screen first.'); el.disabled = true; const { results } = await api('sync', { method: 'POST' }); await refresh(); const failed = results.filter(r => !r.ok); toast(!results.length ? 'Pair a computer to begin synchronizing' : failed.length ? `${failed.length} device(s) could not sync. Check Devices for details.` : 'Paired devices synchronized', failed.length > 0); return; }
    if (action === 'invite') {
      const invitation = await api('invite', { method: 'POST' });
      const host = invitation.addresses[0] || '127.0.0.1';
      const content = `AB1|${host}|${invitation.port}|${invitation.id}|${invitation.code}`;
      openModal('Connect your next computer', `<p>Open AgentBridge on the other computer, enable LAN sharing, and paste this invitation in Devices → Join another computer.</p><div class="field"><label>One-time invitation · expires in 10 minutes</label><textarea id="invite-text" class="invite-code" readonly>${esc(content)}</textarea></div>${!invitation.addresses.length ? '<div class="notice warning">No private LAN IPv4 address found. This invitation currently uses loopback and works only on this computer. Connect to a LAN and generate a new invitation.</div>' : '<p>Anyone holding this invitation can pair while it is valid. Share it only with your other computer.</p>'}`, button('Copy invitation', 'copy-invite', 'copy', 'primary')); return;
    }
    if (action === 'copy-invite') { await copy(document.querySelector('#invite-text').value); return; }
    if (action === 'revoke') { openModal('Revoke device access?', '<p>This computer will reject future requests from the device. Previously received history on that computer is not remotely deleted.</p>', button('Cancel', 'close-modal', '', '') + button('Revoke access', 'confirm-revoke', 'close', 'danger', `data-id="${esc(id)}"`)); return; }
    if (action === 'confirm-revoke') { await api(`peers/${encodeURIComponent(id)}`, { method: 'DELETE' }); modal.close(); await refresh(); toast('Device access revoked'); return; }
    if (action === 'export') { const data = await api(`sessions/${encodeURIComponent(id)}/export`); download(`${data.session.title}.agentbridge.json`, JSON.stringify(data, null, 2)); toast('Session package exported'); return; }
    if (action === 'raw') { const data = await api(`sessions/${encodeURIComponent(id)}/raw`); download(data.filename, data.content, data.filename.endsWith('.jsonl') ? 'application/x-ndjson' : 'application/json'); return; }
    if (action === 'handoff') {
      openModal('Carry your context to another agent', '<p>Create a plain-text handoff with the conversation, recorded tool activity, project references, and your continuation note. It makes no AI calls.</p><div class="field"><label for="handoff-target">Continue with</label><select id="handoff-target"><option>Codex</option><option>Claude Code</option><option>OpenCode</option><option>VS Code AI extension</option><option>Another coding agent</option></select></div><p>Paste it into a new session in the destination tool. This does not restore native agent state.</p>', button('Download handoff', 'download-handoff', 'download', '', `data-id="${esc(id)}"`) + button('Copy handoff', 'copy-handoff', 'copy', 'primary', `data-id="${esc(id)}"`)); return;
    }
    if (action === 'copy-handoff' || action === 'download-handoff') { const data = await api(`sessions/${encodeURIComponent(id)}/handoff?target=${encodeURIComponent(document.querySelector('#handoff-target').value)}`); if (action === 'copy-handoff') await copy(data.content); else download('agentbridge-handoff.md', data.content, 'text/markdown'); return; }
    if (action === 'continue') {
      if (dirty) throw new Error('Save your project folder and continuation note first.');
      const checks = await api(`sessions/${encodeURIComponent(id)}/inspect`);
      openModal('Continue this session', `<p>Check your project before continuing. AgentBridge does not launch commands automatically.</p><div class="check-list"><div><span>Local folder</span><b>${esc(checks.directory || 'Not mapped')}</b></div><div><span>Folder exists</span><b>${checks.exists ? 'Yes' : 'No'}</b></div><div><span>Local branch</span><b>${esc(checks.branch || 'Unknown')}</b></div><div><span>Local commit</span><b>${esc(checks.commit?.slice(0, 12) || 'Unknown')}</b></div></div>${checks.warnings.map(w => `<div class="notice warning">${icon('info')}${esc(w)}</div>`).join('')}${checks.command ? `<p>Resume command for your local CLI session:</p><pre id="resume-command">${esc(checks.command)}</pre><p>Your coding tool must be installed and authenticated on this computer.</p>` : ''}`, button('Create context handoff', 'handoff', 'bolt', '', `data-id="${esc(id)}"`) + (checks.command ? button('Copy resume command', 'copy-resume', 'copy', 'primary') : '')); return;
    }
    if (action === 'copy-resume') { await copy(document.querySelector('#resume-command').textContent); return; }
  } catch (error) { toast(error.message, true); }
  finally { if (el.isConnected) el.disabled = false; }
});
document.addEventListener('keydown', event => {
  const card = event.target.closest('.session-card');
  if (card && event.target === card && ['Enter', ' '].includes(event.key)) { event.preventDefault(); card.click(); }
  if ((event.ctrlKey || event.metaKey) && event.key === 'k') { event.preventDefault(); if (dirty) { toast('Save your continuation context first.', true); return; } if (page !== 'sessions' || selected) { selected = null; page = 'sessions'; draw(); } document.querySelector('#search')?.focus(); }
});
document.addEventListener('input', event => {
  if (event.target.closest('#context-form')) {
    dirty = true;
    if (event.target.id === 'local-path') selected.localProjectPath = event.target.value;
    if (event.target.id === 'handoff-note') selected.note = event.target.value;
  }
  if (event.target.id === 'search') {
    query = event.target.value; clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const value = query;
      try { const result = await api(`search?q=${encodeURIComponent(value)}`); if (value !== query || selected || page !== 'sessions') return; searchIds = new Set(result.ids); const list = sortedSessions(); document.querySelector('#result-count').textContent = `${list.length} session${list.length === 1 ? '' : 's'}`; document.querySelector('#session-list').innerHTML = list.map(sessionCard).join('') || '<div class="empty"><h2>No matching sessions</h2><p>Try another search.</p></div>'; } catch (error) { toast(error.message, true); }
    }, 180);
  }
});
document.addEventListener('change', async event => {
  const el = event.target;
  try {
    if (el.id === 'file-input') { await importFiles(el.files); el.value = ''; return; }
    if (el.id === 'sort') { sort = el.value; draw(); return; }
    if (el.dataset.setting) { await api('settings', { method: 'PATCH', body: { [el.dataset.setting]: el.checked } }); await refresh(); toast('Settings saved'); return; }
    if (el.dataset.sessionShare) { await api(`sessions/${encodeURIComponent(el.dataset.sessionShare)}`, { method: 'PATCH', body: { shared: el.checked } }); if (selected?.id === el.dataset.sessionShare) selected.shared = el.checked; await refresh(); toast(el.checked ? 'Session enabled for sharing over LAN and Internet. Sync to transfer it.' : 'Session sharing disabled'); }
  } catch (error) { el.checked = !el.checked; toast(error.message, true); }
});
document.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target; const submit = form.querySelector('button[type="submit"]'); if (submit) submit.disabled = true;
  try {
    if (form.id === 'scan-path-form') {
      const connector = form.dataset.tool;
      await api('scan-paths', { method: 'PATCH', body: { tool: connector, paths: [...(state.settings.scanPaths[connector] || []), form.querySelector('#scan-path').value] } });
      modal.close(); await refresh(); toast('Storage location saved. Scan this tool to import its sessions.');
    }
    if (form.id === 'name-form') { await api('settings', { method: 'PATCH', body: { name: form.querySelector('#device-name').value } }); await refresh(); toast('Computer name saved'); }
    if (form.id === 'internet-settings-form') {
      const data = { enabled: form.querySelector('#internet-enabled').checked, relayUrl: form.querySelector('#relay-url').value.trim() };
      const access = form.querySelector('#relay-token').value;
      if (access) data.relayToken = access;
      const result = await api('internet/settings', { method: 'PATCH', body: data }); await refresh(); toast(result.error ? `Configuration saved. ${result.error}` : 'Internet settings saved', Boolean(result.error));
    }
    if (form.id === 'internet-connect-form') { await api('internet/connect', { method: 'POST', body: { id: form.querySelector('#remote-device-id').value } }); await refresh(); toast('Connection request sent. Approve it on the other computer.'); }
    if (form.id === 'context-form') { await api(`sessions/${encodeURIComponent(form.dataset.id)}`, { method: 'PATCH', body: { localProjectPath: form.querySelector('#local-path').value.trim(), note: form.querySelector('#handoff-note').value } }); selected = await api(`sessions/${encodeURIComponent(form.dataset.id)}`); dirty = false; await refresh(); toast('Continuation context saved'); }
    if (form.id === 'pair-form') { const parts = form.querySelector('#invitation').value.trim().split('|'); if (parts.length !== 5 || parts[0] !== 'AB1') throw new Error('Paste the complete AB1 invitation from your other computer.'); const result = await api('pair', { method: 'POST', body: { host: parts[1], port: Number(parts[2]), invitationId: parts[3], code: parts[4] } }); await refresh(); toast(`Paired with ${result.name}`); }
  } catch (error) { toast(error.message, true); } finally { if (submit?.isConnected) submit.disabled = false; }
});
document.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); app.classList.add('drop-overlay'); } });
document.addEventListener('dragleave', event => { if (!event.relatedTarget) app.classList.remove('drop-overlay'); });
document.addEventListener('drop', async event => { event.preventDefault(); app.classList.remove('drop-overlay'); if (event.dataTransfer.files.length) await importFiles(event.dataTransfer.files); });
modal.addEventListener('click', event => { if (event.target === modal) { const r = modal.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) modal.close(); } });

refresh().catch(error => { app.innerHTML = `<div class="boot"><div><h1>Open your local AgentBridge app.</h1><p class="muted">${esc(error.message)}</p><p class="muted">Run npm run serve and use the private startup URL, or launch the desktop app.</p></div></div>`; });
setInterval(async () => {
  if (!state || modal.open || dirty || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  try { if (selected) selected = await api(`sessions/${encodeURIComponent(selected.id)}`); await refresh(); } catch { /* Keep offline UI readable. */ }
}, 10000);

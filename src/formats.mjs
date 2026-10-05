// Readers for documented/open-source storage formats. No transcript is executed.
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const printable = value => typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2);
export const contentText = value => typeof value === 'string' ? value : Array.isArray(value) ? value.filter(object).map(p => typeof p.text === 'string' ? p.text : '').filter(Boolean).join('\n') : '';

export function localPath(value) {
  if (typeof value !== 'string') return '';
  if (!value.startsWith('file:')) return /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? '' : value;
  const url = new URL(value);
  const pathname = decodeURIComponent(url.pathname);
  if (url.hostname) return `\\\\${url.hostname}${pathname.replaceAll('/', '\\')}`;
  return /^\/[a-z]:\//i.test(pathname) ? pathname.slice(1).replaceAll('/', '\\') : pathname;
}

export function replayVSCode(records) {
  let state;
  for (const entry of records) {
    if (entry.kind === 0) {
      if (!object(entry.v)) throw new Error('Invalid VS Code initial record.');
      state = structuredClone(entry.v); continue;
    }
    if (!state || ![1, 2, 3].includes(entry.kind)) throw new Error('Unsupported VS Code operation log.');
    const keys = entry.k;
    if (!Array.isArray(keys) || keys.length > 64 || keys.some(k => typeof k !== 'string' && !Number.isSafeInteger(k) || ['__proto__', 'constructor', 'prototype'].includes(k) || typeof k === 'number' && (k < 0 || k > 100000))) throw new Error('Unsafe VS Code mutation path.');
    if (!keys.length) continue;
    let target = state;
    for (const key of keys.slice(0, -1)) {
      if (!object(target) && !Array.isArray(target) || !Object.hasOwn(target, key)) throw new Error('Invalid VS Code mutation target.');
      target = target[key];
    }
    if (!object(target) && !Array.isArray(target)) throw new Error('Invalid VS Code mutation target.');
    const key = keys.at(-1);
    if (Array.isArray(target) && /^\d+$/.test(String(key)) && Number(key) > 100000) throw new Error('VS Code array index limit exceeded.');
    if (entry.kind === 1) {
      if (Array.isArray(target) && key === 'length' && (!Number.isSafeInteger(entry.v) || entry.v < 0 || entry.v > 100000)) throw new Error('VS Code operation limit exceeded.');
      target[key] = entry.v;
    }
    else if (entry.kind === 3) delete target[key];
    else {
      const array = Object.hasOwn(target, key) ? target[key] : [];
      if (!Array.isArray(array) || entry.v !== undefined && !Array.isArray(entry.v)) throw new Error('Invalid VS Code array operation.');
      if (entry.i !== undefined) {
        if (!Number.isSafeInteger(entry.i) || entry.i < 0 || entry.i > 100000) throw new Error('Invalid VS Code array length.');
        array.length = entry.i;
      }
      if (array.length + (entry.v?.length || 0) > 100000) throw new Error('VS Code operation limit exceeded.');
      for (const item of entry.v || []) array.push(item);
      target[key] = array;
    }
  }
  return state;
}

function vscode(session, context) {
  if (session.requests.length > 10000) throw new Error('VS Code request limit exceeded.');
  const messages = [], events = [];
  for (const request of session.requests) {
    if (!object(request)) continue;
    const timestamp = request.timestamp ?? session.creationDate ?? context.timestamp;
    const prompt = typeof request.message === 'string' ? request.message : request.message?.text;
    if (typeof prompt === 'string' && prompt) messages.push({ role: 'user', text: prompt, timestamp });
    const responses = Array.isArray(request.response) ? request.response : [request.response];
    const parts = [];
    for (const response of responses) {
      if (typeof response === 'string') parts.push(response);
      else if (typeof response?.value === 'string') parts.push(response.value);
      else if (response?.kind === 'markdownContent' && typeof response.content?.value === 'string') parts.push(response.content.value);
      else if (response?.kind === 'toolInvocationSerialized') events.push({ name: response.toolId || response.toolCallId || 'Copilot tool', input: response.toolSpecificData ?? response.invocationMessage, output: response.resultDetails ?? response.pastTenseMessage ?? '', timestamp: request.responseTimestamp ?? timestamp });
    }
    if (parts.length) messages.push({ role: 'assistant', text: parts.join('\n'), timestamp: request.responseTimestamp ?? timestamp });
  }
  return { tool: 'vscode', nativeId: session.sessionId || context.nativeId, title: session.customTitle, projectPath: localPath(session.workingDirectory) || context.projectPath, createdAt: session.creationDate ?? context.timestamp, updatedAt: session.lastMessageDate ?? messages.at(-1)?.timestamp ?? context.timestamp, messages, events, sourceFormat: 'VS Code Copilot JSON/operation log' };
}

function replayGemini(records) {
  let metadata = {}; let messages = new Map();
  const patch = update => {
    const message = messages.get(update.id);
    if (!message) return;
    if (update.content !== undefined) message.content = update.content;
    for (const change of update.toolCalls || []) {
      const call = message.toolCalls?.find(c => c.id === change.id);
      if (call && Object.hasOwn(change, 'result')) call.result = change.result;
    }
  };
  for (const record of records) {
    if (typeof record.$rewindTo === 'string') {
      const ids = [...messages.keys()]; const index = ids.indexOf(record.$rewindTo);
      for (const id of index < 0 ? ids : ids.slice(index)) messages.delete(id);
    } else if (object(record.$patch)) {
      patch(record.$patch);
      for (const update of record.$patch.updates || []) patch(update);
      for (const id of record.$patch.removeIds || []) messages.delete(id);
      if (Array.isArray(record.$patch.orderIds)) {
        const ordered = new Set(record.$patch.orderIds);
        messages = new Map([...messages].filter(([id]) => !ordered.has(id)).concat(record.$patch.orderIds.filter(id => messages.has(id)).map(id => [id, messages.get(id)])));
      }
    } else if (object(record.$set) || record.sessionId && record.projectHash) {
      const update = record.$set || record;
      metadata = { ...metadata, ...update };
      if (Array.isArray(update.messages)) messages = new Map(update.messages.map(m => [m.id, m]));
    } else if (record.id && ['user', 'gemini', 'info', 'error', 'warning'].includes(record.type)) messages.set(record.id, structuredClone(record));
  }
  return { ...metadata, messages: [...messages.values()] };
}

function gemini(session, context) {
  if (session.messages.length > 10000) throw new Error('Gemini message limit exceeded.');
  const messages = [], events = [];
  for (const item of session.messages) {
    const timestamp = item.timestamp ?? session.lastUpdated ?? context.timestamp;
    const text = contentText(item.content);
    if (text) messages.push({ role: item.type === 'user' ? 'user' : item.type === 'gemini' ? 'assistant' : 'system', text, timestamp });
    for (const call of item.toolCalls || []) events.push({ name: call.name || 'tool', input: call.args, output: call.result, timestamp: call.timestamp ?? timestamp });
  }
  return { tool: 'gemini', nativeId: session.sessionId, title: session.summary, projectPath: session.directories?.[0] || context.projectPath, createdAt: session.startTime ?? context.timestamp, updatedAt: session.lastUpdated ?? messages.at(-1)?.timestamp ?? context.timestamp, messages, events, sourceFormat: 'Gemini CLI JSON/JSONL' };
}

function anthropic(records, context) {
  const messages = [], events = []; const calls = new Map();
  for (const item of records) {
    if (!object(item)) continue;
    const timestamp = item.timestamp ?? context.timestamp;
    const content = contentText(item.content);
    if (content) messages.push({ role: item.role, text: content, timestamp });
    for (const part of Array.isArray(item.content) ? item.content : []) {
      if (part.type === 'tool_use') {
        const event = { name: part.name, input: part.input, output: '', timestamp };
        events.push(event); calls.set(part.id, event);
      }
      if (part.type === 'tool_result') {
        const output = contentText(part.content) || printable(part.content);
        const event = calls.get(part.tool_use_id);
        if (event) event.output = output;
        else events.push({ name: 'tool result', input: '', output, timestamp });
      }
    }
  }
  return { tool: context.tool || 'cline', nativeId: context.nativeId, projectPath: context.projectPath, createdAt: context.timestamp, updatedAt: context.timestamp, messages, events, sourceFormat: 'Anthropic API task history' };
}

function opencode(session, context) {
  const info = session.info; const messages = [], events = [];
  for (const item of session.messages) {
    const meta = item.info || item;
    const timestamp = meta.time?.created ?? meta.timestamp ?? info.time?.created ?? context.timestamp;
    const parts = item.parts || meta.parts || (Array.isArray(meta.content) ? meta.content : []);
    const content = meta.text || contentText(parts) || contentText(meta.content);
    if (content) messages.push({ role: meta.role || (meta.type === 'user' ? 'user' : ['system', 'synthetic'].includes(meta.type) ? 'system' : 'assistant'), text: content, timestamp });
    for (const part of parts) if (part.type === 'tool') events.push({ name: part.tool || part.name || 'tool', input: part.state?.input, output: part.state?.output ?? (contentText(part.state?.content) || ''), timestamp: part.time?.created ?? timestamp });
    if (meta.type === 'shell') events.push({ name: 'shell', input: meta.command, output: meta.output, timestamp });
  }
  return { tool: 'opencode', nativeId: info.id, title: info.title, projectPath: info.directory, createdAt: info.time?.created, updatedAt: info.time?.updated, messages, events, sourceFormat: context.sourceFormat || 'OpenCode export' };
}

export function additionalFormat(parsed, records, context = {}) {
  if (parsed?.requests && Array.isArray(parsed.requests)) return vscode(parsed, context);
  if (records[0]?.kind === 0 && object(records[0].v) && Array.isArray(records[0].v.requests)) return vscode(replayVSCode(records), context);
  if (parsed?.sessionId && parsed.projectHash && Array.isArray(parsed.messages)) return gemini(parsed, context);
  if (records.some(r => r?.sessionId && r.projectHash)) return gemini(replayGemini(records), context);
  if (parsed?.info && Array.isArray(parsed.messages)) return opencode(parsed, context);
  if (Array.isArray(parsed) && parsed.some(r => ['user', 'assistant'].includes(r?.role)) && (['cline', 'roo'].includes(context.tool) || parsed.every(r => !r?.type && ['user', 'assistant', 'system'].includes(r?.role)))) return anthropic(parsed, context);
  return null;
}

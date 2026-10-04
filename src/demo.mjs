import { parseTranscript } from './connectors.mjs';

export function demoSessions(device) {
  const examples = [
    ['codex', 'Refactor the authentication middleware', 'atlas-api', 'feature/auth', 'Review the middleware and remove duplicate token validation. Keep the public API stable.', 'I extracted a single token validation function and updated the three callers. The next step is to test expired tokens and missing headers.'],
    ['claude', 'Track down the WebSocket reconnect loop', 'relay-web', 'fix/reconnect', 'The connection keeps reconnecting when the browser tab becomes inactive. Find the cause.', 'The heartbeat timer survives a closed socket. I added cleanup to the close handler and a capped backoff. Please verify reconnection after the laptop wakes up.'],
    ['opencode', 'Add a command palette', 'studio-ui', 'feature/palette', 'Implement a searchable command palette with keyboard navigation.', 'The palette now supports arrow keys, Enter, and Escape. Search is case insensitive. We still need to connect the project-switch command.'],
    ['vscode', 'Document the caching strategy', 'atlas-api', 'docs/cache', 'Write a short explanation of our cache invalidation rules.', 'I drafted the TTL and invalidation sections. Check that the described eviction policy matches the production configuration.']
  ];
  return examples.map(([tool, title, project, branch, user, assistant], i) => {
    const when = new Date(Date.now() - (i + 1) * 47 * 60000).toISOString();
    const raw = JSON.stringify({ tool, id: `example-${i}`, title, projectPath: `/example/projects/${project}`, branch, updatedAt: when, messages: [{ role: 'user', content: user, timestamp: when }, { role: 'assistant', content: assistant, timestamp: when }] }, null, 2);
    return { ...parseTranscript(raw, `${project}-example.json`, device), demo: true, starred: i === 0 };
  });
}

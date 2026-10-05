# AgentBridge

A local-first desktop app for finding, reading, and sharing AI coding sessions between your computers over LAN or the Internet. Supports Windows, macOS, and Linux through Electron, with a dependency-free local browser mode.

**Version 0.3.0 discovers IDE and CLI histories automatically** on Windows, macOS and Linux: Claude Code, Codex, OpenCode, Gemini CLI, VS Code/Copilot, Cline and Roo Code. Inspect detected paths, scan one tool or all tools, and add custom storage locations in **Integrations**. Encrypted LAN/Internet sharing by device ID remains available. Native remote-session restoration remains tool-specific.

## Start immediately: local browser mode

Install Node.js 22.13 or newer, extract this project, and open a terminal in its folder:

```sh
npm run serve
```

Open the private `http://127.0.0.1:4317/#...` URL printed in that terminal. No npm dependency installation is required for this mode. Keep the terminal running. The authentication token is removed from the address bar after the page loads; reuse the original startup URL if you open another browser session.

Windows users can also double-click `run-local.cmd`. On macOS/Linux, run `bash run-local.sh`.

## Start the desktop app

```sh
npm ci
npm start
```

Electron needs its platform binary. If your environment disables npm lifecycle scripts, run `node node_modules/electron/install.js` after installation. Electron must run as a normal desktop user, not root. No API key or AI subscription is needed to use AgentBridge itself.

## First run

1. Open **Integrations** to inspect automatically detected IDE/CLI storage paths. Choose **Scan this tool** or **Scan local sessions**, or use **Import session** for a JSON/JSONL export. Add a custom path if you changed a tool's storage directory. See [supported formats and Windows/macOS paths](docs/DISCOVERY.md).
2. Use **Explore example sessions** to preview the interface without importing personal history. Examples are labeled and excluded from sharing.
3. Open a session to view messages and recorded tool activity.
4. Set the local project folder and write a continuation note; press **Save context**.
5. Choose **Continue** to inspect the project and, where available, copy the native CLI resume command. The app does not execute the command.
6. Choose **Create handoff** to copy or download a Markdown context package for another agent.

Transcripts and tool output can contain credentials or private source code. Review the session before enabling sharing or exporting it. The app never reads credential files, but transcript text is preserved verbatim; automated secret redaction is not implemented.

## Share over the Internet using an ID

Open **Internet sharing** on both computers and configure the same HTTPS relay URL and access code. Copy the device ID from one computer, request a connection from the other, and approve it on the receiving computer. Select sessions to share, then synchronize. LAN and Internet sharing can be enabled independently.

A running relay is required; GitHub does not host the relay process. The deployable server, Docker Compose and HTTPS configuration are included. See **[the Internet deployment and usage guide](docs/INTERNET.md)**.

## Connect two or three computers on a LAN

Install the app on each computer and connect them to the same private IPv4 LAN.

1. Open **Devices** and enable **LAN sharing** on both computers.
2. On computer A, choose **Create invitation**. Copy the full `AB1|address|port|id|secret` invitation to computer B using a trusted channel. It is valid once, for ten minutes.
3. On B, paste it into **Join another computer** and choose **Pair computer**.
4. On A, open a real local session and enable **Share on LAN**.
5. Choose **Sync now**. B receives a readable history copy, including the original transcript, recorded project metadata, and continuation note.
6. On B, map the project folder to its existing local checkout and create a handoff to continue in your preferred coding tool.

For three computers, pair each pair directly (A–B, A–C, B–C). Received sessions are not relayed to other devices. Direct LAN mode does not use a central service; both devices must be online together. Internet mode uses the separately configured encrypted relay and retains undelivered updates for up to seven days. The last received copy remains readable offline.

Automatic synchronization runs every 30 seconds when enabled. Automatic local transcript refresh is optional and runs once per minute. Manual address pairing is implemented; automatic discovery is planned. Allow incoming TCP port **47832** on your private network if your OS firewall blocks it. The UI server only listens on localhost and cannot be opened from another computer.

If interface discovery is restricted or the computer has multiple LAN interfaces, edit the address portion of the copied invitation to the correct private IPv4 address before pasting it on the other computer. Pairing only accepts literal RFC1918 IPv4 addresses or loopback; public IPs, DNS names, link-local addresses, and IPv6 are not supported in this version.

## Integration capabilities

| Tool | Read history / automatic scan | Native continuation |
| --- | --- | --- |
| Claude Code | CLI JSONL, including subagent histories | Local main-session resume command when original transcript and project exist; subagents use handoff |
| Codex | CLI JSONL in sessions and archived_sessions | Local resume command when original transcript and project exist |
| OpenCode | SQLite v1/v2 stores, legacy JSON trees, JSON exports | Handoff / assembled JSON export; tool import/resume is not executed |
| Gemini CLI | JSON chats and append-only JSONL updates | Context handoff / original export |
| VS Code / Copilot | Workspace and empty-window chat JSON / mutation logs | Context handoff / original export |
| Cline | Extension task API conversation histories | Context handoff; new Cline CLI/SDK SQLite format is detected but not read |
| Roo Code | Extension task API conversation histories | Context handoff / original export |

Editor locations include VS Code, Insiders, VSCodium, Cursor and Windsurf, with named profiles and VS Code portable storage. This reads supported Copilot/Cline/Roo formats inside compatible editors; **native Cursor/Windsurf chats and JetBrains AI histories are not supported**. Remote SSH/WSL/container stores require an accessible custom path or export. [Discovery details and limitations](docs/DISCOVERY.md).

Internal formats may change. Unsupported records remain in the original transcript/export but may not appear in the viewer. Scans do not write to source files or tool databases, and imports stay private until explicitly shared. For OpenCode databases and multi-file stores, AgentBridge retains an assembled session JSON export, not the native database. Native command availability is a filesystem check, not a guarantee that an installed tool version will accept the session.

OpenCode CLI versions differ. Use the installed tool's `--help` to check its export/import commands. Documented variants include:

```sh
# Classic CLI
opencode export <session-id> > session.json
opencode import session.json

# v2 CLI
opencode session export <session-id> > session.json
opencode session import session.json
```

Generic transcript format:

```json
{
  "tool": "vscode",
  "id": "session-123",
  "title": "Implement search",
  "projectPath": "C:\\Projects\\my-app",
  "branch": "feature/search",
  "messages": [
    { "role": "user", "content": "Implement search", "timestamp": "2026-10-04T08:00:00Z" },
    { "role": "assistant", "content": "The first implementation is ready", "timestamp": "2026-10-04T08:01:00Z" }
  ]
}
```

## What transfers, and what stays local

- **Transfers:** selected original transcripts, normalized conversations, supported tool events, origin identity, recorded branch/commit, and source continuation notes.
- **Stays local:** tool login/API credentials, local project mappings, stars, and personal edits to received continuation notes.
- **Not transferred:** repository files, uncommitted diffs, native tool databases, agent processes, terminal state, and hidden model state.

Sessions have stable IDs scoped to their originating tool and device. Internet ownership is scoped to the cryptographic device ID; a session received over both transports can appear twice. A device is the only publisher of its own sessions. Continuing with another agent creates a new tool session; AgentBridge does not merge two independently evolving conversations. Unsharing removes an untouched remote cache on the next successful sync; copies with local notes, stars, or folder mappings are retained as local archives. Previously exported data cannot be recalled. Revoking a peer blocks future requests but does not remotely erase its saved history.

## Persistence and transport

Local storage is an atomic JSON file. There is no production-scale database yet. Paths:

- Windows: `%APPDATA%/AgentBridge` in browser mode.
- macOS: `~/Library/Application Support/AgentBridge`.
- Linux: `${XDG_DATA_HOME:-~/.local/share}/agentbridge` in browser mode.
- Electron mode uses Electron's `userData` folder; browser and desktop modes can use different stores.

`AGENTBRIDGE_DATA_DIR` overrides browser-mode storage. Files contain unencrypted transcripts and persistent peer keys, protected by OS file permissions. OS credential-vault integration and application-level encryption at rest are planned; use your OS disk encryption where required.

LAN requests use HTTP as a carrier for application-encrypted AES-256-GCM packets. Payloads and persistent pairing keys are encrypted in transit. A random 256-bit one-time pairing secret derives the enrollment encryption key. Each trusted device pair gets a separate random persistent key. Direction-specific associated data, bounded timestamps, response binding, and replay detection authenticate packets. IP addresses, timing, packet sizes, routes, and sender device IDs remain visible to the network. Device clocks must be within five minutes. This custom protocol has not had an independent security audit.

Local UI access requires a per-launch bearer token, checks Host/Origin headers, and uses a restrictive content security policy. The Electron renderer has Node integration disabled, context isolation enabled, and sandboxing enabled. It cannot navigate to remote sites or open new windows. Tool output is rendered as text.

Limits: **16 MB per imported transcript**, **24 MB per encrypted request**, **500 sessions per exchange**, and **500 sessions/files per source location scan**. Very large histories need incremental transfer and indexed storage, which are planned.

## Tests

```sh
npm test
```

Tests use synthetic fixtures and isolated temporary stores. They cover parsing, storage, authenticated local API access, handoffs, local resume eligibility, encrypted two-instance pairing/synchronization, privacy selection, replay rejection, and revocation, plus authenticated Internet enrollment, explicit approval, encrypted offline delivery, and relay restart. Discovery tests also cover Windows/macOS paths, editor profiles, safe mutation-log replay, Gemini updates/rewinds, Cline/Roo tool results, read-only OpenCode SQLite/WAL access, custom paths, archives and subagent identity. No personal agent history is read by the tests.

## Build installers

Run each build on its target OS after `npm ci`:

```sh
npm run build:win    # Windows NSIS installer
npm run build:mac    # macOS DMG
npm run build:linux  # Linux AppImage
```

**GitHub Actions builds installers after every push to `main`**, gated by tests, CodeQL injection/security scanning, Gitleaks secret scanning and a dependency audit. Successful runs publish unique development prereleases. From **Actions → Build and release → Run workflow**, choose a stable release, prerelease, or build-only run. Set the repository variable `AGENTBRIDGE_RELEASE_MODE=manual` to make publishing manual only.

See [the release and security workflow guide](docs/RELEASES.md) for instructions and [Releases](https://github.com/workspaccode/agentbridge/releases) for completed builds. Code signing, notarization, automatic updates, and store distribution are not configured; installers produced by this workflow are unsigned. Remote builds require GitHub Actions to be available for the account.

## Project layout

```text
desktop/main.cjs         Electron window and lifecycle
src/server.mjs           Authenticated localhost UI/API and local scans
src/connectors.mjs       Normalized sessions, import, Markdown handoff
src/discovery.mjs        Cross-platform IDE/CLI location discovery
src/formats.mjs          Copilot, Gemini, Cline/Roo and OpenCode format readers
src/readers.mjs          Bounded transcript / read-only SQLite scanning
src/lan.mjs              Direct LAN pairing and synchronization
src/identity.mjs         Cryptographic device IDs and signed requests
src/internet.mjs         Approved Internet pairing and encrypted sync
relay/                  Deployable persistent relay and HTTPS proxy setup
src/store.mjs            Atomic local persistence
public/                 Desktop interface
test/                   Synthetic fixtures and automated tests
docs/                   Architecture and development roadmap
```

Official integration references (discovery sources checked October 5, 2026 are linked in [DISCOVERY.md](docs/DISCOVERY.md)):

- https://code.claude.com/docs/en/sessions
- https://learn.chatgpt.com/docs/codex/cli
- https://opencode.ai/docs/cli/
- https://opencode.ai/v2/docs/cli/commands/
- https://www.electronjs.org/docs/latest/tutorial/security

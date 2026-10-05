# Implementation roadmap

## Delivered: 0.3.0

- Automatic Windows/macOS/Linux IDE and CLI storage discovery, editor profiles and portable VS Code locations.
- Copilot JSON/mutation logs, Gemini JSON/JSONL, Cline and Roo extension conversation readers.
- Read-only OpenCode SQLite v1/v2 and legacy multi-file export assembly.
- Codex archives and distinct, handoff-only Claude subagent histories.
- Per-source read results/errors/limits, per-tool scans and persisted custom locations.
- Format/editor provenance retained across encrypted session sharing.

## Next: additional history readers

- Native Cursor/Windsurf, JetBrains and the new Cline CLI/SDK storage schema.
- Version-specific adapter fixtures, explicit custom-storage hints and remote SSH/WSL/container integration.

## Delivered: 0.2.0

- Stable cryptographic device IDs with signed registration and authenticated relay requests.
- Internet connection requests with explicit approval, rejection/blocking and revocation.
- End-to-end encrypted relay snapshots, offline queues, acknowledgments and replay controls.
- Standalone relay server, Docker Compose deployment and HTTPS proxy configuration.
- Internet configuration and ID sharing screen.

## Delivered: 0.1.0

- Desktop shell with isolated renderer and a localhost control API.
- Browser mode requiring only Node.js 22.13+.
- Unified session list, tool filters, full transcript/tool search, stars, and project grouping.
- Claude Code and Codex CLI local transcript scanners; OpenCode/generic export import.
- Raw transcript retention, portable package export, and cross-tool Markdown handoff.
- Device-scoped stable IDs and origin-owned publishing.
- Explicit per-session sharing, one-use expiring invitations, encrypted LAN exchange, manual/periodic sync, and device revocation.
- Project folder mapping, Git branch/commit/working-tree inspection, and eligible local resume commands.
- Automated synthetic-fixture and two-instance integration tests.

## Next: reliable native transfer

1. Maintain version-specific parser fixtures sourced from opt-in exports from supported tool versions.
2. Prefer documented APIs/hooks over internal transcript parsing where available.
3. Implement tool capability negotiation: read, native export, native import, native resume.
4. Add an OpenCode import workflow with detected CLI version and argument-based process execution.
5. Investigate supported Codex/Claude state transfer, including path references, attachments, compaction, and associated native storage. Do not equate a transcript copy with full native state.
6. Implement project identity from Git remotes plus explicit user mappings; handle identical folder names from unrelated repositories.
7. Capture optional working-tree patches with a preview; never apply changes automatically.
8. Track provenance for a handoff that becomes a new native conversation.

## Next: synchronization and storage

- Indexed SQLite store, migrations, encrypted local secrets in the OS vault.
- Incremental transfer by content hash with paging/chunking, acknowledgments, retry queues and backpressure.
- LAN discovery with a manual fallback; stronger confirmation UX with device verification fingerprints.
- IPv6 support and configurable LAN listening interface/port.
- Per-device share permissions, retention rules, redacted copies, and export previews.
- Indexed scalable relay storage and unified origin deduplication across LAN and Internet transports.
- Independent protocol review, fuzzing, resource-exhaustion testing, and signed release pipeline.

## Next: desktop product release

- Tray/menu-bar lifecycle, notifications and keyboard shortcuts.
- Target-OS packaging tests on Windows, macOS and Linux.
- Code signing, macOS notarization, signed updates and documented recovery.
- Accessibility review, internationalization, and Arabic RTL layout.
- Adapter SDK for editor extensions and other agent tools.

No cloud dependency is required for the LAN product. Optional Internet sharing requires outbound HTTPS access and the configured relay access code; LAN-only use remains available.

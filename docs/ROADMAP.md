# Implementation roadmap

## Delivered: 0.1.0

- Desktop shell with isolated renderer and a localhost control API.
- Browser mode requiring only Node.js 22+.
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
- Optional always-on local relay for computers that are not online together.
- Independent protocol review, fuzzing, resource-exhaustion testing, and signed release pipeline.

## Next: desktop product release

- Tray/menu-bar lifecycle, notifications and keyboard shortcuts.
- Target-OS packaging tests on Windows, macOS and Linux.
- Code signing, macOS notarization, signed updates and documented recovery.
- Accessibility review, internationalization, and Arabic RTL layout.
- Adapter SDK for editor extensions and other agent tools.

No cloud dependency is required for the LAN product. Internet access and credentials are only needed by the agent tools themselves and for installing desktop dependencies.

# Validation — October 4, 2026

## Automated backend tests

`npm test`: **11 passed, 0 failed** on Node.js 24.19.0 / Linux.

- Claude JSONL message and tool-result parsing.
- Codex rollout parsing, tool results, and duplicate-message avoidance.
- OpenCode export parsing.
- Generic editor transcript and AgentBridge package import.
- Live incomplete-tail handling and malformed/oversized input rejection.
- Restart persistence and preservation of local notes/stars/sharing choices.
- AES-GCM authentication and private-address validation.
- Two independently stored app instances: enrollment, bidirectional selected-only sharing, source-note updates, preservation of personal notes, transcript updates, unsharing, and revocation.
- Replay rejection and forged-origin rejection.
- Local API authorization/origin checks, search, export, handoff, sample-sharing rejection and LAN enable/disable.
- Local scan against fixture-only folders and original-file native resume eligibility.

## Browser interaction checks

**10 flows passed**, with **0 browser page/console errors**, using headless Chromium 153.0.8010.0 and Playwright.

1. First-run empty state.
2. Explicit loading of labeled fictional examples.
3. Tool filtering and transcript text search.
4. Unsaved continuation notes survive detail-tab changes; saved notes and project inspection work.
5. Markdown handoff downloads contain the saved continuation note.
6. Import of an actual synthetic JSONL fixture through the file picker.
7. Pairing two independently stored UI instances and transferring only the selected real fixture session.
8. Saving the device name.
9. No page-level horizontal overflow at 1100px.
10. No page-level horizontal overflow at 430px; tool tabs scroll within their container.

Screenshots in `screenshots/` show synthetic example sessions or synthetic imported fixtures. Device names are test labels. Pairing tests use two localhost listeners on different ports; this does not replace physical-machine or firewall validation.

## Desktop packaging

`npm run build:linux -- --dir`: **succeeded**, producing an Electron 44.5.1 Linux x64 application directory. Source archive delivery excludes the large intermediate binary directory.

The desktop window has not been interactively tested in a graphical Linux session. Windows NSIS and macOS DMG target configuration is present; those builds and OS-specific behavior have not been tested. No signing or notarization was performed.

## Remaining release checks

- Real physical LAN transfer on Windows/macOS/Linux, including firewalls, sleep/wake and IP changes.
- Real exported sessions from multiple currently installed agent versions, including attachments, compaction and very large histories.
- Supported native remote continuation methods per tool.
- Indexed scalable storage and independent security review before production release.

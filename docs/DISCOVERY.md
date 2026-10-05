# IDE and CLI session discovery — AgentBridge 0.3.0

No domain, relay or AI API key is needed to read local histories. Open **Integrations** to see the paths checked on this computer. Existing readable locations show **Ready to scan**. Click **Scan this tool**, or **Scan local sessions** to read all supported tools. The app reports sessions read, skipped files, errors and limits per location. Detecting a directory alone does not mean its histories were read successfully.

New histories are private. You can view, search, export and hand them to another agent, or select them for existing encrypted LAN/Internet sharing. Reading a transcript does not restore an IDE's native agent state.

## Default paths

`~` means the current user's home directory, including `%USERPROFILE%` on Windows. The CLI tools use their own home/XDG paths on macOS too, rather than all storing histories under Application Support.

| Tool | Windows | macOS | Reader |
| --- | --- | --- | --- |
| Claude Code | `%USERPROFILE%\.claude\projects` | `~/.claude/projects` | Nested CLI JSONL; subagent histories get separate IDs and handoff only |
| Codex | `%USERPROFILE%\.codex\sessions` and `archived_sessions` | `~/.codex/sessions` and `archived_sessions` | Rollout JSONL |
| Gemini CLI | `%USERPROFILE%\.gemini\tmp\<project>\chats` | `~/.gemini/tmp/<project>/chats` | JSON and append-only JSONL, including metadata, patches and rewinds |
| OpenCode | `%USERPROFILE%\.local\share\opencode` | `~/.local/share/opencode` | `opencode*.db` SQLite v1/v2; legacy session/message/part JSON trees |
| VS Code / Copilot | `%APPDATA%\Code\User` | `~/Library/Application Support/Code/User` | `workspaceStorage/<workspace>/chatSessions`, and `globalStorage/emptyWindowChatSessions` / `transferredChatSessions`; JSON and operation-log JSONL |
| Cline extension | `<editor User>/globalStorage/saoudrizwan.claude-dev/tasks` | Same relative extension path | Each task's `api_conversation_history.json` |
| Roo Code extension | `<editor User>/globalStorage/rooveterinaryinc.roo-cline/tasks` | Same relative extension path | Each task's `api_conversation_history.json` |

Editor roots also include **Code - Insiders**, **VSCodium**, **Cursor** and **Windsurf**. Named profiles under `User/profiles/<profile>` are checked separately. Supported extension histories can be read inside these editors; proprietary native Cursor/Windsurf conversations are not read. Linux editor roots use `${XDG_CONFIG_HOME:-~/.config}/<editor>/User`.

Environment overrides: `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME`, `XDG_DATA_HOME`, `OPENCODE_DB`, `VSCODE_PORTABLE` and `VSCODE_APPDATA`. `GEMINI_CLI_HOME` is an alternate home directory, so the reader appends `.gemini/tmp`. VS Code portable mode uses `<VSCODE_PORTABLE>/user-data/User`. `OPENCODE_DB` can select a database file directly. Windows falls back to `<home>/AppData/Roaming` when APPDATA is unavailable.

## Custom locations

1. Find the relevant tool card in **Integrations** and choose **Add storage path**.
2. Enter an absolute path. `~`, `%APPDATA%`, `$VARIABLE` and `${VARIABLE}` expand using this process's available environment variables. Unknown variables and relative paths are rejected.
3. Save and scan that tool. Up to eight custom roots per tool are retained after restart; automatic roots stay enabled.

For Copilot, use an editor's **User** directory, `chatSessions`, or its containing workspace storage directory. For Cline/Roo, use **tasks** or an individual task directory. For Gemini, use **tmp** or **chats**. For OpenCode, use its data root or a `.db` file. For Claude/Codex, use the transcript directory. Custom editor User roots also discover Cline/Roo extension directories and profiles.

Avoid adding overlapping custom roots: scanning the same task from two differently scoped locations can create separate copies. Removing a custom path stops future scans of that path; imported histories remain available.

## Format and platform limitations

- Cline extension history is supported. New Cline CLI/SDK sessions under `.cline/data/sessions` (or `CLINE_SESSION_DATA_DIR` / `CLINE_DATA_DIR` / `CLINE_DIR`) are detected and labeled **Reader unavailable**. They use a separate storage schema.
- Native Cursor/Windsurf and JetBrains AI formats are not supported. Use a compatible export via **Import session** where available.
- Remote SSH, WSL, container and cloud histories are not automatically searched. Add a locally accessible mounted/UNC path or import an export. AgentBridge does not log in to remote hosts.
- Source transcripts and databases are read only. Credential files/tables are not imported, but transcript text can itself contain secrets. Sharing remains an explicit per-session choice.
- OpenCode database and legacy multi-file reads create an assembled JSON export of session metadata, messages and parts. The binary database, auth tables and native process state are not transferred. Active SQLite WAL records are read within a coherent read transaction. Node.js **22.13+** is required for SQLite in browser mode; desktop builds include their own Node runtime.
- Copilot JSONL takes precedence over a same-basename older JSON snapshot. An incomplete final JSONL record is tolerated during live writing; malformed complete records are reported. Unsupported data remains in the raw transcript/export, where retained, and is not executed.
- Cline/Roo histories may omit timestamps/project directories. File modification time is used when timestamps are unavailable. Gemini project hashes do not reveal paths; map the local project folder manually if no directory is recorded.
- Scans are bounded to 500 sessions/files per location, 16 MB per transcript/assembled export, 10,000 SQLite rows per message/part collection, and bounded directory traversal. Symlink roots/files are skipped; add the actual storage directory. Very large or unsupported histories are reported rather than silently accepted.
- IDE readers provide viewing/export/handoff. Native resume commands remain limited to eligible original local Claude/Codex sessions with an existing project directory; no command is executed automatically.

## Upstream format references

These are implementation references checked October 5, 2026; internal formats can change.

- [VS Code user data paths](https://github.com/microsoft/vscode/blob/main/src/vs/platform/environment/node/userDataPath.ts), [chat session store](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/model/chatSessionStore.ts), [operation log](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/model/objectMutationLog.ts).
- [Gemini recording types](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingTypes.ts), [recording/replay service](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingService.ts), [storage paths](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/config/storage.ts).
- [Cline extension disk storage](https://github.com/cline/cline/blob/main/apps/vscode/src/core/storage/disk.ts), [Roo Code storage](https://github.com/RooCodeInc/Roo-Code/blob/main/src/utils/storage.ts).
- [OpenCode global paths](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/global.ts), [database selection](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/database/database.ts), [session/message schema](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/sql.ts), [v1 schema](https://github.com/anomalyco/opencode/blob/v1.2.20/packages/opencode/src/session/session.sql.ts).

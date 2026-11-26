# Providers spike (2026-11-26)

Can AI Office run staff on ChatGPT (Codex CLI) or Gemini (Gemini CLI) instead of Claude Code?
Tested on Windows 11 with codex-cli 0.172.0 (logged in with a ChatGPT plan) and gemini-cli 0.71.1 (API key).

## Codex CLI: works

| Need | How | Tested |
|---|---|---|
| One run, no prompts | `codex exec --json --skip-git-repo-check -` (prompt on stdin; without stdin it waits) | yes |
| Resume a chat | `codex exec resume <thread_id> ... -` (id from the first `thread.started` event) | yes |
| Unknown thread | stderr `no rollout found for thread id` | yes |
| Instructions file | `-c project_doc_fallback_filenames=["CLAUDE.md"]` reads the office's CLAUDE.md (no AGENTS.md copy needed) | yes |
| Extra system prompt | `-c developer_instructions="..."` | yes |
| Model / effort | `-c model="..."`, `-c model_reasoning_effort="low"` | yes |
| Sandbox | `-c sandbox_mode="workspace-write"`, extra folders `-c sandbox_workspace_write.writable_roots=[...]` | flags accepted |
| Guard hook | `-c hooks.PreToolUse=[{matcher=".*",hooks=[{type="command",command="..."}]}]` plus `--dangerously-bypass-hook-trust` (hooks given on the command line are otherwise not trusted) | yes |
| Hook input | Same shape as Claude Code: `tool_name` `Bash` (`tool_input.command`) or `apply_patch` (`tool_input.command` = the patch text), `cwd`, `session_id` | yes |
| Hook deny | Claude Code's `hookSpecificOutput.permissionDecision: "deny"` works as is | yes |
| Login | ChatGPT plan (`codex login`) or API key; `codex login status` | yes |

Events (`--json`, one per line): `thread.started {thread_id}`, `turn.started`,
`item.started|item.completed {item: {type: agent_message|command_execution|file_change|error, ...}}`,
`turn.completed {usage: {input_tokens, cached_input_tokens, output_tokens}}`, `error {message}`, `turn.failed {error}`.
No cost and no plan-limit events. `input_tokens` is the whole turn (all requests), cached included.

Watch out:
- On Windows hook commands run in PowerShell: `"C:\...\node.exe" "guard.js"` is just a string there and the hook
  **silently does not run (fail-open)**. Use `& "node.exe" "guard.js"` on Windows.
- Codex has no Read/Glob/Grep tools: it reads with shell commands (PowerShell on Windows). So the guard must allow
  plain read-only commands (Get-Content, rg, ls, ...) inside the office and linked folders, for everyone.
- Project-local `.codex/` config is ignored unless the folder is trusted; we pass everything with `-c` instead.
- A fresh run costs ~20-45k input tokens (mostly cached).

## Gemini CLI: works, API key only

Tested with gemini-cli 0.71.1 and a Google AI Studio key in `GEMINI_API_KEY`.

**Sign-in with a personal Google account is closed**: "This client is no longer supported for Gemini Code Assist
for individuals ... migrate to the Antigravity suite". So no subscription route; API key (free tier or paid) only.

| Need | How | Tested |
|---|---|---|
| Own settings, user's untouched | `GEMINI_CLI_HOME=<office>/.office/gemini-home` (a fresh home: no user skills, extensions, MCP). The user's `~/.gemini/settings.json` had `oauth-personal`, which overrides a workspace `.gemini/settings.json` and `GEMINI_DEFAULT_AUTH_TYPE`. `GEMINI_CLI_SYSTEM_SETTINGS_PATH` is refused unless an admin owns the folder. | yes |
| API key sign-in | `security.auth.selectedType: "gemini-api-key"` in that home's settings | yes |
| One run | `gemini -p "" -o stream-json --skip-trust --approval-mode yolo` with the message on stdin | yes |
| Resume | `--resume <session_id>` (from `init`); unknown id: `Invalid session identifier` | yes |
| Instructions file | `context.fileName: ["CLAUDE.md"]` | yes |
| Extra system prompt | none: the office note goes at the top of a conversation's first message | yes |
| Folders | `--include-directories <office>` plus linked folders; read tools stay inside the workspace | yes |
| Guard hook | `hooks.BeforeTool` (matcher `.*`), `hooksConfig.enabled: true`; input `tool_name` (`run_shell_command` {command, dir_path}, `write_file`/`replace` {file_path}), `cwd`; deny with `{ "decision": "deny", "reason": "..." }` | yes |
| Guard mark | `tool_use` is printed *before* BeforeTool runs, so the mark comes from `hooks.BeforeAgent` (runs before the model starts). `SessionStart` does **not** run with `-p`. | yes |
| Models | `gemini --list-models`: auto, gemini-2.5-pro, gemini-3.5-flash, gemini-3.1-flash-lite | yes |

Events: `init {session_id, model}`, `message {role, content, delta}` (the answer in pieces), `tool_use {tool_name, parameters}`,
`tool_result {status, output}`, `result {status, stats: {input_tokens, output_tokens, cached, input}, error?}`.

Watch out: the free tier has a small daily quota per model (`You have exhausted your daily quota on this model`).
Shell is PowerShell 5 on Windows (same as Codex): `&&` fails, so the note tells them to use `git -C "<folder>"`.

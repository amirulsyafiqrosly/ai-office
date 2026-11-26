# Providers spike (2026-11-26)

Can AI Office run staff on ChatGPT (Codex CLI) or Gemini (Gemini CLI) instead of Claude Code?
Tested on Windows 11 with codex-cli 0.172.0 (logged in with a ChatGPT plan).

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

Later (from real use):
- Codex picks its own shell `workdir` (often the office folder), so the guard cannot tell the staff from the folder:
  the office passes AI_OFFICE_WHO.
- The user's own Codex plugins bring tools such as `mcp__node_repl__js` (runs any JavaScript, past the guard).
  Runs use `--ignore-user-config` (login kept) and turn off apps, plugins, browser/computer use, image generation,
  sub-agents, goals and web search. The only setting copied over is `[windows] sandbox` (e.g. "elevated"); without it
  the workspace is read-only on Windows.

## Gemini CLI: not used

Tried with gemini-cli 0.71.1 and an API key: it works (own GEMINI_CLI_HOME, BeforeTool hook as the guard),
but Google closed Gemini CLI sign-in for personal Google accounts, so there is no subscription route, and an
API key gives no plan limits to show. Decided 2026-11-26: Claude and ChatGPT only; the Gemini adapter was removed.

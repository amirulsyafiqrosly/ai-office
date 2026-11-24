# Milestone 1: feasibility tests

Date: 2026-11-24. Claude Code 2.1.331, Node 24, WSL Ubuntu. Model for tests: Haiku (cheap).
Test office: Hana (root CLAUDE.md with scope guard) + Siti (`.claude/agents/siti.md` and
`staff/siti/CLAUDE.md`). Every hook event logged raw by `spike/log-hook.js`. Scripts in `spike/`.

## Results

| # | Question | Result |
|---|---|---|
| 1 | Does SubagentStart carry the task description? | No. Only `agent_id` and `agent_type` (= staff name). Read the task from PreToolUse / PostToolUse on the `Agent` tool |
| 2 | `claude -p` stream-json + `--resume` from Node | Works in WSL and on Windows (portable Node 24.22.3, `claude.exe` 2.1.331). Resume keeps the same `session_id` and Hana remembers the earlier turn. All hook events fire on Windows too |
| 3 | Tools for dashboard chats without permission prompts | `--permission-mode default --tools "Agent,Read,Write,Edit,Glob,Grep" --allowedTools` (same list). No denials, Bash fully removed |
| 4 | Two sessions on the same office at once | Works. Both finished, separate approval files, shared hook log stayed valid (51 lines, 0 broken) |
| 5 | Staff session in `staff/<name>/` acts as staff, not Hana | Works. Scope guard in the root CLAUDE.md holds: it said it was Siti and did the work itself |

## How to build live status (from test 1)

```
PreToolUse  Agent  tool_input {description, prompt, subagent_type}     -> "Hana is handing X to siti"
PostToolUse Agent  tool_response {agentId, description, status: async_launched}
SubagentStart      {agent_id, agent_type}                              -> match agentId -> siti: Working, <description>
PreToolUse  *      {agent_id, agent_type, tool_name, tool_input}       -> per-staff activity lines
PreToolUse  SubagentHandback {message}                                 -> the staff's final report
SubagentStop       {agent_id, agent_type, agent_transcript_path}       -> siti: back to idle
Stop               {background_tasks: [{id, description, agent_type, status}]}
```

- Every hook inside a subagent carries `agent_id` and `agent_type`, so tool use can be shown per staff.
- `Stop.background_tasks` also lists running staff with their description: a useful cross-check.
- The same staff can run twice at once (two sessions delegating to Siti). Status must be per `agent_id`, not per staff.

## Things the build must handle

| Finding | What to do |
|---|---|
| Subagents run in the background. One `claude -p` run prints **two** `result` events: Hana's first reply ("Siti is on it"), then the final reply after the hand-back | The server treats the run as finished when the process exits, not at the first `result`. Show both replies in chat |
| `claude -p` waits 3 s for stdin when stdin is open | Spawn with stdin ignored / closed |
| Staff sessions started inside `staff/<name>/` do **not** run the office hooks (project `.claude/settings.json` is not inherited). They do still see `.claude/agents/` from the parent | Wizard writes a tiny `staff/<name>/.claude/settings.json` with the same hooks, logging to the office `.office/` folder |
| `--permission-mode default` still auto-runs harmless read-only Bash commands (e.g. `date`) | Use `--tools` to make only the listed tools exist in dashboard chats |
| Users' own settings (e.g. `defaultMode: auto`) apply to office sessions | Always pass `--permission-mode default` from the dashboard |
| The `Agent` tool is listed as `Task` in `init.tools`; hooks report `tool_name: "Agent"` | Accept both names |
| stream-json also has `system/task_started`, `task_progress`, `task_notification` events | Optional second source for live status in dashboard chats |
| MCP add-ons (e.g. Invois Online) are extra tools | Add `mcp__<server>` to `--tools` / `--allowedTools` when the add-on is on |

## Windows notes (test 2)

- `spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })` found `claude.exe` with no shell. If a user installed Claude Code through npm, it is `claude.cmd` and needs `shell: true` (or resolve it with `where claude` first).
- Hook commands use the absolute Node path (`process.execPath`) plus the absolute script path, both quoted. Works on Windows even when Node is not on PATH, and with nvm on Linux/Mac.
- Hook input on Windows has Windows paths (`cwd`, `transcript_path` with backslashes). Use `path` functions, never string splits on `/`.
- On Windows the subagent ran in the foreground (one `result` event); in WSL it ran in the background (two). Treating "process exit" as the end covers both.
- Run 1 took 16 s on Windows (process start included), resume 5.5 s.

## Cost

Each test run on Haiku cost about USD 0.01 (run 1: 0.009, 6 s).

## Still open

Nothing blocking. Mac is still untested (as planned).

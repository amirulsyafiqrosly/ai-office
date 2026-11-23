# AI Office

Free public tool: `npx github:epool86/ai-office` runs a setup wizard, creates an office folder
(a PA called Hana + 1 to 8 AI staff as Claude Code subagents), and starts a local dashboard at
http://localhost:4747 (Office view, Talk to Hana, Needs your OK, Staff, Projects, Inbox).
Users run it on their own Claude account through their own Claude Code.

## Status

- 2026-11-23: v1 design agreed (purple top bar, Messenger-style chat dock, approvals drawer, archive with reactivate or delete). No build until the owner says "build it".
- Design doc and mock-ups live in `design/` (gitignored, local only).

## Rules for this repo

- Plain Node, no shell-specific tricks: must run on Windows and Mac (Mac untested).
- Keep dependencies near zero. The office server listens on localhost only.
- Never store or send user credentials. Everything stays in the user's office folder.
- Hooks scripts stay tiny and readable: users must be able to trust them.
- It is a base, not a closed app: keep the file contracts (inbox/, approvals/, staff Tools section, events, local API) stable and documented in the generated OFFICE.md, so users can extend their office with their own Claude.

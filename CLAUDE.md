# AI Office

Free public tool: `npx github:epool86/ai-office` runs a setup wizard, creates an office folder
(a PA called Hana + 1 to 8 AI staff as Claude Code subagents), and starts a local dashboard at
http://localhost:4747 (Office view, Talk to Hana, Needs your OK, Staff, Projects, Inbox).
Users run it on their own Claude account through their own Claude Code.

## Status

- 2026-11-23: v1 design agreed (purple top bar, Messenger-style chat dock, approvals drawer, archive with reactivate or delete). No build until the owner says "build it".
- 2026-11-24: design tweaks agreed. Approvals button floats top right of the Office view only (not in the top bar). Hana = PA = manager (one role, oversees all work), shown with a black Manager badge. Office: glass Boss Room, Hana's desk outside it, Customer Service (Aina) and the queue outside on the pavement. First load: 140% zoom, only Hana's chat; view remembered per tab until a hard refresh.
- 2026-11-24: owner said "build it". Milestone 1 (tests) done: docs/milestone-1-findings.md. Milestone 2 (wizard + folder generator) done: bin/, lib/, office-files/, npm test.
- 2026-11-24: install is Claude-first (INSTALL.md, private Node in ~/.ai-office/node, --answers), file tools pre-allowed inside the office. Milestone 3 (server + dashboard: Staff, Projects, Inbox, Needs your OK, Settings, live refresh, Start AI Office launcher) done: lib/server.js, lib/office.js, dashboard/.
- 2026-11-24: Milestone 4 (live office) done: lib/status.js turns hook events into who is working; dashboard/office3d.js builds the 3D office from office.json (PA by the boss room, customer-service role at the outside booth, up to 8 desks), three.js and fonts bundled.
- Design doc and mock-ups live in `design/` (gitignored, local only).

## Rules for this repo

- Plain Node, no shell-specific tricks: must run on Windows and Mac (Mac untested).
- Keep dependencies near zero. The office server listens on localhost only.
- Never store or send user credentials. Everything stays in the user's office folder.
- Hooks scripts stay tiny and readable: users must be able to trust them.
- It is a base, not a closed app: keep the file contracts (inbox/, approvals/, staff Tools section, events, local API) stable and documented in the generated OFFICE.md, so users can extend their office with their own Claude.

// Spike: write a minimal test office (Hana + Siti) into the given folder.
const fs = require('fs'), path = require('path');
const dir = path.resolve(process.argv[2] || 'out/office');
const w = (f, t) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); };
const hook = ev => ({ hooks: [{ type: 'command', command: `"${process.execPath}" "${path.join(__dirname, 'log-hook.js')}" ${ev}` }] });
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SubagentStart', 'SubagentStop', 'Notification', 'Stop', 'SessionEnd'];
w('.claude/settings.json', JSON.stringify({ hooks: Object.fromEntries(EVENTS.map(e => [e, [hook(e)]])) }, null, 2));
w('CLAUDE.md', `# Office PA

Scope: these PA rules apply only when Claude was started in this office folder itself.
If you were started inside a staff folder (staff/<name>/), ignore this file and follow that staff's CLAUDE.md.

You are Hana, the PA. You never do the work yourself: hand every task to the right staff subagent, then report back in one short line.
Staff: siti (sales: quotes).
Always end your replies with the word "-- Hana".
`);
w('.claude/agents/siti.md', `---
name: siti
description: Sales. Writes quotes for customers. Use for any price or quote request.
tools: Read, Write, Edit
---
You are Siti, sales staff. Work only inside staff/siti/. Write quotes as short text files there.
Always end your replies with the word "-- Siti".
`);
w('staff/siti/CLAUDE.md', `# Siti (sales)

You are Siti, sales staff, working in this folder. You are NOT Hana and you are not a PA.
Do the work yourself. Never delegate.
Always end your replies with the word "-- Siti".
`);
console.log('office at', dir);

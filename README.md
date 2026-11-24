# AI Office

Your own AI office staff, run with Claude Code on your own Claude account.

A manager (Hana) takes your requests and hands them to your AI staff (support, sales, finance, tech).
A live dashboard in your browser shows an isometric office (who is working, on what, who is waiting for your OK),
plus your team, projects, inbox and approvals. Chat with Hana or any staff right in the dashboard.

Status: in development. Setup, dashboard, live office and chat work; final testing next. Not ready for general use yet.

## Install (let Claude do it)

You need [Claude Code](https://claude.com/claude-code), logged in with your Claude account. Open it and paste:

```
Install AI Office for me: https://raw.githubusercontent.com/epool86/ai-office/main/INSTALL.md
```

Claude finds or installs what is needed (Node.js), asks you a few questions (company name, your staff),
sets up your office folder and opens the dashboard. You only answer and say OK.
Next time, double-click **Start AI Office** in your office folder.

## Install (terminal)

With Node.js 18 or newer:

```
npx github:epool86/ai-office
```

Press Enter to keep each default. The dashboard opens when it is done. To talk to Hana, `cd` into the new folder and run `claude`.

## What you get

A folder with plain files you can read and edit: Hana's instructions, one folder per staff with their
job and rules, an inbox, approvals waiting for your OK, and project notes. `OFFICE.md` inside explains
everything, so your own Claude can extend the office (email, WhatsApp, your shop, any API).

Nothing is sent anywhere except through your own Claude Code. No logins are stored.

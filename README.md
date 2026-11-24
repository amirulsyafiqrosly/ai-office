# AI Office

Your own AI office staff, run with Claude Code on your own Claude account.

A PA (Hana) takes your requests and hands them to your AI staff (support, sales, finance, tech).
A live dashboard (coming soon) shows an isometric office: who is working, who is sleeping, what needs your OK.

Status: in development. The setup works; the dashboard is next. Not ready for general use yet.

## Install (let Claude do it)

You need [Claude Code](https://claude.com/claude-code), logged in with your Claude account. Open it and paste:

```
Install AI Office for me: https://raw.githubusercontent.com/epool86/ai-office/main/INSTALL.md
```

Claude finds or installs what is needed (Node.js), asks you a few questions (company name, your staff),
and sets up your office folder. You only answer and say OK.

## Install (terminal)

With Node.js 18 or newer:

```
npx github:epool86/ai-office
```

Press Enter to keep each default. Then `cd` into the new folder and run `claude` to talk to Hana.

## What you get

A folder with plain files you can read and edit: Hana's instructions, one folder per staff with their
job and rules, an inbox, approvals waiting for your OK, and project notes. `OFFICE.md` inside explains
everything, so your own Claude can extend the office (email, WhatsApp, your shop, any API).

Nothing is sent anywhere except through your own Claude Code. No logins are stored.

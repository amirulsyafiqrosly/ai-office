// The setup wizard: a few questions in the terminal, Enter keeps the [default].

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const D = require('./defaults');
const G = require('./generate');
const claude = require('./claude');

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (n) => (s) => (color ? `\x1b[${n}m${s}\x1b[0m` : s);
const purple = c('1;35'), green = c('32'), cyan = c('36'), dim = c('2'), red = c('31'), bold = c('1');
const ok = (s) => console.log(`${green('✓')} ${s}`);

// Line reader that also works when answers are piped in (tests, scripts).
function makeAsk(yes) {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const lines = []; let wait = null, closed = false;
  rl.on('line', (l) => { if (wait) { const w = wait; wait = null; w(l); } else lines.push(l); });
  rl.on('close', () => { closed = true; if (wait) { const w = wait; wait = null; w(''); } });
  const next = () => (lines.length ? Promise.resolve(lines.shift()) : closed ? Promise.resolve('') : new Promise((r) => { wait = r; }));
  const ask = async (q, def, check) => {
    for (;;) {
      process.stdout.write(`${cyan("?")} ${q} ${def === "" ? "" : dim(`[${def}]`) + " "}`);
      if (yes) { console.log(''); return String(def); }
      const a = (await next()).trim();
      if (!process.stdin.isTTY) console.log(a);
      const v = a || String(def);
      const err = check ? check(v) : null;
      if (!err) return v;
      console.log(`  ${red(err)}`);
    }
  };
  return { ask, close: () => rl.close() };
}

async function wizard(opts = {}) {
  console.log(`\n${purple('AI OFFICE')}\nSet up your own AI office staff. Press Enter to keep the ${dim('[default]')}.\n`);

  if (!opts.skipCheck) {
    const cc = claude.check();
    if (!cc.installed) {
      console.log(`${red('✗')} Claude Code is not installed.\n
  Install it, log in once, then run this again:
    npm install -g @anthropic-ai/claude-code
    claude
  Guide: https://docs.claude.com/en/docs/claude-code/setup\n`);
      return 1;
    }
    if (!cc.loggedIn) {
      console.log(`${red('✗')} Claude Code is installed but not logged in.\n
  Run ${bold('claude')} once and log in with your Claude account, then run this again.\n`);
      return 1;
    }
    ok(`Claude Code found, logged in ${dim(`(${cc.version})`)}`);
  }

  const { ask, close } = makeAsk(opts.yes);
  try {
    const company = await ask('Company name', D.COMPANY);
    const folderDef = opts.dir || `./${G.slug(company) === G.slug(D.COMPANY) ? D.FOLDER : G.slug(company)}`;
    const folder = await ask('Office folder', folderDef, (v) => (G.isOffice(path.resolve(v)) ? 'That folder already has an office. Pick another one.' : null));
    const dir = path.resolve(folder);
    const pa = await ask("Your PA's name", D.PA.name);
    const count = Number(await ask('How many staff? (1-8)', D.STAFF_COUNT, (v) => (/^[1-8]$/.test(v) ? null : 'Type a number from 1 to 8.')));

    const staff = [];
    for (let i = 0; i < count; i++) {
      const d = D.STAFF[i];
      console.log(`\n${bold(`Staff ${i + 1} of ${count}`)}`);
      const nonEmpty = (v) => (v.trim() ? null : 'Please type something.');
      const name = await ask('Name', d.name, nonEmpty);
      const role = await ask('Role', name === d.name ? d.role : '', nonEmpty);
      const job = await ask(`What does ${name} do?`, role === d.role ? d.job : '', nonEmpty);
      staff.push({ name, role, job });
    }

    console.log(`\n${bold('Optional add-on')}`);
    const inv = await ask(`Do you send quotations or invoices? Connect Invois Online so your sales and finance staff
    create real ones (free plan: 60 documents a month)`, 'y/N', (v) => (/^(y|yes|n|no|y\/n)$/i.test(v) ? null : 'Type y or n.'));
    const invois = /^y(es)?$/i.test(inv);
    close();

    if (fs.existsSync(dir) && fs.readdirSync(dir).length) console.log(dim(`\nThe folder is not empty. Existing files are kept, never overwritten.`));
    const cfg = G.buildConfig({ company, pa, staff, invois });
    const res = G.writeOffice(dir, cfg);
    console.log('');
    ok(`Office created in ${folder} ${dim(`(${pa} + ${staff.length} staff, ${res.written.length} files)`)}`);
    if (res.skipped.length) console.log(dim(`  Kept your existing: ${res.skipped.join(', ')}`));

    if (invois) {
      const r = opts.skipCheck ? { ok: false, err: 'skipped' } : claude.mcpAdd(dir, D.INVOIS.id, D.INVOIS.url);
      if (r.ok) ok(`Invois Online added to .mcp.json. To log in: run ${bold('claude')} in the folder, type ${bold('/mcp')}, pick invois-online`);
      else console.log(`${red('!')} Could not add Invois Online (${r.err || 'unknown error'}). Add it later:\n    claude mcp add --transport http --scope project ${D.INVOIS.id} ${D.INVOIS.url}`);
      console.log(dim(`  Free account: ${D.INVOIS.site}`));
    }

    const rel = path.relative(process.cwd(), dir) || '.';
    console.log(`\n${bold('Next:')} talk to ${pa} in a terminal:
    cd ${rel.includes(' ') ? `"${rel}"` : rel}   then   claude
  Start the dashboard from inside the folder:
    npx github:epool86/ai-office\n`);
    return 0;
  } finally {
    close();
  }
}

module.exports = { wizard };

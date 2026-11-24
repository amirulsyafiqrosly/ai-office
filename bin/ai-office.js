#!/usr/bin/env node
// AI Office: run the setup wizard, or start the office if this folder is one.

const path = require('path');
const pkg = require('../package.json');

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  console.error(`AI Office needs Node.js 18 or newer (you have ${process.versions.node}). Get it at https://nodejs.org`);
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const value = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

if (flag('--help') || flag('-h')) {
  console.log(`AI Office ${pkg.version}

  npx github:epool86/ai-office            Set up a new office (wizard), or start the office
                                          when run inside an office folder
Options:
  --dir <folder>    Office folder (default: ask)
  --yes             Accept every default, no questions
  --answers <file>  Take the answers from a JSON file (see INSTALL.md)
  --version         Show the version`);
  process.exit(0);
}
if (flag('--version')) { console.log(pkg.version); process.exit(0); }

const G = require('../lib/generate');
const here = path.resolve(value('--dir') || '.');

(async () => {
  if (G.isOffice(here)) {
    const fixed = G.repairSettings(here);
    if (fixed.length) console.log(`Updated office paths in: ${fixed.join(', ')}`);
    console.log('This folder is an AI office. The dashboard is not built yet (coming in the next milestone).');
    console.log('For now, run "claude" in this folder to talk to your PA.');
    return 0;
  }
  const { wizard } = require('../lib/wizard');
  return wizard({ yes: flag('--yes'), dir: value('--dir'), answers: value('--answers'), skipCheck: flag('--skip-check') });
})().then((code) => { process.exitCode = code || 0; }, (e) => { console.error(e.stack || e); process.exitCode = 1; });

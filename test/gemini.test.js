// Gemini CLI runs with a fake "gemini" that prints stream-json like the real one (gemini-cli 0.71,
// see docs/providers-spike.md), plus the guard's Gemini checks run as the real hook script.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-office-gemini-'));
const bin = path.join(tmp, 'bin');
fs.mkdirSync(bin);
// The fake: records args, env and stdin. GUARDED: leaves the mark like the BeforeAgent hook, then uses a tool.
const fake = `
const fs = require('fs'), path = require('path');
let msg = ''; process.stdin.on('data', (d) => { msg += d; }).on('end', () => {
  const a = process.argv.slice(2);
  fs.appendFileSync(${JSON.stringify(path.join(tmp, 'calls.jsonl'))}, JSON.stringify({ args: a, cwd: process.cwd(), msg, home: process.env.GEMINI_CLI_HOME, run: process.env.AI_OFFICE_RUN, prov: process.env.AI_OFFICE_PROVIDER }) + '\\n');
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  if (a.includes('--resume') && a[a.indexOf('--resume') + 1] === 'gone') { process.stderr.write('Error resuming session: Invalid session identifier "gone".'); process.exit(1); }
  out({ type: 'init', session_id: 'g-1', model: 'auto' });
  out({ type: 'message', role: 'user', content: msg });
  if (msg.includes('QUOTA')) { out({ type: 'result', status: 'error', error: { type: 'Error', message: '[API Error: You have exhausted your daily quota on this model.]' } }); process.exit(1); }
  if (msg.includes('GUARDED')) {
    if (!msg.includes('UNGUARDED')) {
      const office = path.dirname(process.env.GEMINI_CLI_HOME).replace(/[\\\\/]\\.office$/, '');
      fs.mkdirSync(path.join(office, '.office', 'runs'), { recursive: true });
      fs.writeFileSync(path.join(office, '.office', 'runs', process.env.AI_OFFICE_RUN + '.guard'), '');
    }
    out({ type: 'tool_use', tool_name: 'read_file', tool_id: 't1', parameters: { file_path: 'OFFICE.md' } });
    setTimeout(() => { out({ type: 'tool_result', tool_id: 't1', status: 'success', output: 'ok' }); out({ type: 'message', role: 'assistant', content: 'Read it.', delta: true }); out({ type: 'result', status: 'success', stats: { input_tokens: 900, output_tokens: 5, cached: 400, input: 500 } }); }, 1500);
    return;
  }
  out({ type: 'message', role: 'assistant', content: 'Baik ', delta: true });
  out({ type: 'message', role: 'assistant', content: 'boss, from Gemini.', delta: true });
  out({ type: 'result', status: 'success', stats: { total_tokens: 8926, input_tokens: 8345, output_tokens: 43, cached: 0, input: 8345 } });
});
`;
if (process.platform === 'win32') { // like an npm install: gemini.cmd next to node_modules/@google/gemini-cli/bundle/gemini.js
  fs.writeFileSync(path.join(bin, 'gemini.cmd'), '@echo off\r\n');
  const js = path.join(bin, 'node_modules', '@google', 'gemini-cli', 'bundle');
  fs.mkdirSync(js, { recursive: true }); fs.writeFileSync(path.join(js, 'gemini.js'), fake);
} else {
  fs.writeFileSync(path.join(bin, 'gemini'), `#!${process.execPath}\n${fake}`, { mode: 0o755 });
}
process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;

const G = require('../lib/generate');
const D = require('../lib/defaults');
const { Chats } = require('../lib/chat');
const { Usage } = require('../lib/usage');
const gemini = require('../lib/providers/gemini');
const dir = path.join(tmp, 'office');
G.writeOffice(dir, G.buildConfig({ company: 'Kedai Ali', pa: 'Hana', staff: D.STAFF.slice(0, 2).map(({ name, role, job }) => ({ name, role, job })) }));
const cfgFile = path.join(dir, 'office.json');
{ const c = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); c.pa.provider = 'gemini'; c.pa.model = 'gemini-3.5-flash'; fs.writeFileSync(cfgFile, JSON.stringify(c, null, 2)); }
{ const r = gemini.resolve(); if (![r.cmd, ...r.pre].join(' ').includes(path.basename(tmp))) throw new Error('fake gemini not found first on PATH'); } // never reach a real AI

const usage = new Usage(dir);
const msgs = [];
const chats = new Chats(dir, {
  onMessage: (id, m) => msgs.push(m), onState: () => {}, onLive: () => {},
  onUsage: (j, who, kind, id, prov) => usage.see(j, who, kind, id, prov),
  loadCfg: () => JSON.parse(fs.readFileSync(cfgFile, 'utf8')),
});
const idle = (id) => new Promise((resolve) => { const t = setInterval(() => { if (!chats.runs.has(id)) { clearInterval(t); resolve(); } }, 50); });
const calls = () => fs.readFileSync(path.join(tmp, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const last = () => chats.history('pa').messages.slice(-1)[0];
let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log(`ok ${n} ${name}`); };

(async () => {
  await test('manager on Gemini: own Gemini home, office rules with the first message, pieces joined into one reply', async () => {
    chats.send('pa', 'Hello from the boss');
    await idle('pa');
    assert.deepStrictEqual(chats.history('pa').messages.map((x) => [x.from, x.text]), [['boss', 'Hello from the boss'], ['pa', 'Baik boss, from Gemini.']]);
    const c = calls()[0];
    assert.strictEqual(c.prov, 'gemini');
    assert.strictEqual(path.resolve(c.home), path.resolve(dir, '.office', 'gemini-home'));
    assert.match(c.msg, /^\[Office rules for this conversation\]\n[\s\S]*create one task file[\s\S]*\[Message\]\nHello from the boss$/);
    assert.deepStrictEqual(c.args.slice(0, 7), ['-p', '', '-o', 'stream-json', '--skip-trust', '--approval-mode', 'yolo']);
    assert.strictEqual(c.args[c.args.indexOf('-m') + 1], 'gemini-3.5-flash');
    assert.strictEqual(path.resolve(c.args[c.args.indexOf('--include-directories') + 1]), path.resolve(dir));
    const s = JSON.parse(fs.readFileSync(path.join(dir, '.office', 'gemini-home', '.gemini', 'settings.json'), 'utf8'));
    assert.strictEqual(s.security.auth.selectedType, 'gemini-api-key');
    assert.deepStrictEqual(s.context.fileName, ['CLAUDE.md']);
    assert.ok(s.hooks.BeforeTool[0].hooks[0].command.includes('guard.js') && s.hooks.BeforeAgent);
    assert.ok(s.tools.exclude.includes('web_fetch'));
    const u = usage.summary().today; assert.strictEqual(u.runs, 1); assert.strictEqual(u.cost, 0);
  });

  await test('next message resumes without repeating the rules; a lost session starts fresh once', async () => {
    chats.send('pa', 'Thanks');
    await idle('pa');
    let c = calls().pop();
    assert.strictEqual(c.args[c.args.indexOf('--resume') + 1], 'g-1');
    assert.strictEqual(c.msg, 'Thanks');
    chats.setSession('pa', 'gone');
    chats.send('pa', 'Again');
    await idle('pa');
    const l = calls().slice(-2);
    assert.ok(l[0].args.includes('gone') && !l[1].args.includes('--resume'));
    assert.match(l[1].msg, /^\[Office rules/);
  });

  await test('guard mark present: the tool step goes on', async () => {
    chats.send('pa', 'GUARDED read');
    await idle('pa');
    assert.strictEqual(last().text, 'Read it.');
  });

  await test('no guard mark: the run is stopped for safety', async () => {
    chats.send('pa', 'UNGUARDED read');
    await idle('pa');
    assert.match(last().text, /Stopped for safety/);
  });

  await test('daily quota: plain words, not an API key problem', async () => {
    chats.send('pa', 'QUOTA');
    await idle('pa');
    assert.match(last().text, /Gemini API limit/);
  });

  await test('guard hook script (as Gemini runs it): marks the run, checks shell and writes, answers in Gemini\'s shape', () => {
    const c = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    c.staff[1].commands = ['git']; fs.writeFileSync(cfgFile, JSON.stringify(c, null, 2));
    const staffDir = path.join(dir, 'staff', c.staff[1].id);
    const hook = (input, run = 'r1') => {
      const r = spawnSync(process.execPath, [path.join(dir, '.office', 'guard.js')], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, AI_OFFICE_PROVIDER: 'gemini', AI_OFFICE_RUN: run, AI_OFFICE_CHAT: '1' } });
      return r.stdout ? JSON.parse(r.stdout) : null;
    };
    assert.strictEqual(hook({ hook_event_name: 'BeforeAgent', cwd: dir }, 'mark1'), null);
    assert.ok(fs.existsSync(path.join(dir, '.office', 'runs', 'mark1.guard')));
    const sh = (command, cwd = staffDir) => hook({ hook_event_name: 'BeforeTool', tool_name: 'run_shell_command', tool_input: { command }, cwd });
    assert.deepStrictEqual(Object.keys(sh('git status')), ['decision', 'reason']);
    assert.strictEqual(sh('git status').decision, 'allow');
    assert.strictEqual(sh('git push').decision, 'deny');
    assert.strictEqual(sh('git status', dir).decision, 'deny', 'the manager runs no commands');
    assert.strictEqual(hook({ tool_name: 'run_shell_command', tool_input: { command: 'git status', dir_path: path.join(tmp, 'elsewhere') }, cwd: staffDir }).decision, 'deny');
    const wr = (file_path, tool = 'write_file') => hook({ hook_event_name: 'BeforeTool', tool_name: tool, tool_input: { file_path, content: 'x' }, cwd: staffDir }).decision;
    assert.strictEqual(wr('notes.md'), 'allow');
    assert.strictEqual(wr('../../office.json'), 'deny');
    assert.strictEqual(wr('../../.office/grants.json', 'replace'), 'deny');
    assert.strictEqual(wr(path.join(tmp, 'elsewhere.txt')), 'deny');
    assert.strictEqual(hook({ tool_name: 'read_file', tool_input: { file_path: 'OFFICE.md' }, cwd: dir }), null, 'reads: Gemini keeps them in the workspace itself');
  });

  await test('parser: real event shapes', () => {
    const st = {};
    assert.deepStrictEqual(gemini.parse({ type: 'init', session_id: 'x' }, st).map((e) => e.t), ['session', 'thinking']);
    assert.deepStrictEqual(gemini.parse({ type: 'message', role: 'user', content: 'hi' }, st), []);
    gemini.parse({ type: 'message', role: 'assistant', content: 'One ', delta: true }, st);
    const t = gemini.parse({ type: 'tool_use', tool_name: 'run_shell_command', parameters: { command: 'git status' } }, st);
    assert.deepStrictEqual(t.map((e) => e.t), ['text', 'tool']);
    assert.deepStrictEqual([t[1].name, t[1].input.command, t[1].guarded], ['Bash', 'git status', true]);
    assert.deepStrictEqual(gemini.parse({ type: 'tool_use', tool_name: 'update_topic', parameters: {} }, st).map((e) => e.t), ['thinking']);
    assert.ok(gemini.missingSession('Error resuming session: Invalid session identifier "x".'));
    assert.strictEqual(gemini.runFrom({ type: 'result', stats: { input_tokens: 900, output_tokens: 5, cached: 400, input: 500 } }).input, 500);
  });

  console.log(`\n${n} gemini tests passed`);
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });

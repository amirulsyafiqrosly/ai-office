// ChatGPT (Codex CLI) runs with a fake "codex" that prints --json events like the real one
// (shapes taken from codex-cli 0.172, see docs/providers-spike.md), plus the guard's Codex checks.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-office-codex-'));
const bin = path.join(tmp, 'bin');
fs.mkdirSync(bin);
// The fake: records args, cwd and the message (stdin). GUARDED: acts like the guard ran (leaves the mark),
// then runs a command. UNGUARDED: runs a command with no mark, then would keep going.
const fake = `
const fs = require('fs'), path = require('path');
let msg = ''; process.stdin.on('data', (d) => { msg += d; }).on('end', () => {
  const a = process.argv.slice(2);
  fs.appendFileSync(${JSON.stringify(path.join(tmp, 'calls.jsonl'))}, JSON.stringify({ args: a, cwd: process.cwd(), msg, run: process.env.AI_OFFICE_RUN, prov: process.env.AI_OFFICE_PROVIDER }) + '\\n');
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  if (a.includes('resume') && a[a.indexOf('resume') + 1] === 'gone') { process.stderr.write('Error: thread/resume failed: no rollout found for thread id gone'); process.exit(1); }
  out({ type: 'thread.started', thread_id: 'th-1' });
  out({ type: 'item.completed', item: { id: 'item_0', type: 'error', message: 'Under-development features enabled' } });
  out({ type: 'turn.started' });
  if (msg.includes('LOGIN')) { out({ type: 'turn.failed', error: { message: '401 Unauthorized: please run codex login' } }); process.exit(1); }
  if (msg.includes('GUARDED') || msg.includes('UNGUARDED')) {
    if (msg.includes('GUARDED') && !msg.includes('UNGUARDED')) {
      const office = process.cwd().includes(path.sep + 'staff' + path.sep) ? path.resolve(process.cwd(), '..', '..') : process.cwd();
      fs.mkdirSync(path.join(office, '.office', 'runs'), { recursive: true });
      fs.writeFileSync(path.join(office, '.office', 'runs', process.env.AI_OFFICE_RUN + '.guard'), '');
    }
    out({ type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: "powershell.exe -Command 'Get-Content OFFICE.md'", status: 'in_progress' } });
    setTimeout(() => { out({ type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'Read it.' } }); out({ type: 'turn.completed', usage: { input_tokens: 5000, cached_input_tokens: 4000, output_tokens: 20 } }); }, 1500);
    return;
  }
  out({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'Baik boss, from ChatGPT.' } });
  out({ type: 'turn.completed', usage: { input_tokens: 23256, cached_input_tokens: 13952, output_tokens: 8, reasoning_output_tokens: 0 } });
});
`;
if (process.platform === 'win32') { // like an npm install: codex.cmd next to node_modules/@openai/codex/bin/codex.js
  fs.writeFileSync(path.join(bin, 'codex.cmd'), '@echo off\r\n');
  const js = path.join(bin, 'node_modules', '@openai', 'codex', 'bin');
  fs.mkdirSync(js, { recursive: true }); fs.writeFileSync(path.join(js, 'codex.js'), fake);
} else {
  fs.writeFileSync(path.join(bin, 'codex'), `#!${process.execPath}\n${fake}`, { mode: 0o755 });
}
process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;

const G = require('../lib/generate');
const D = require('../lib/defaults');
const { Chats } = require('../lib/chat');
const { Usage } = require('../lib/usage');
const codex = require('../lib/providers/codex');
const guard = require('../office-files/guard');
const dir = path.join(tmp, 'office');
G.writeOffice(dir, G.buildConfig({ company: 'Kedai Ali', pa: 'Hana', staff: D.STAFF.slice(0, 2).map(({ name, role, job }) => ({ name, role, job })) }));
{ // the boss picked ChatGPT for the manager and the second staff (Staff page)
  const f = path.join(dir, 'office.json'), c = JSON.parse(fs.readFileSync(f, 'utf8'));
  c.pa.provider = 'codex'; c.staff[1].provider = 'codex';
  fs.writeFileSync(f, JSON.stringify(c, null, 2));
}
// never reach a real AI from the tests
{ const r = require('../lib/providers/codex').resolve(); if (![r.cmd, ...r.pre].join(' ').includes(path.basename(tmp))) throw new Error('fake codex not found first on PATH'); }

const usage = new Usage(dir);
const chats = new Chats(dir, {
  onMessage: () => {}, onState: () => {}, onLive: () => {},
  onUsage: (j, who, kind, id, prov) => usage.see(j, who, kind, id, prov),
  loadCfg: () => JSON.parse(fs.readFileSync(path.join(dir, 'office.json'), 'utf8')),
});
const idle = (id) => new Promise((resolve) => { const t = setInterval(() => { if (!chats.runs.has(id)) { clearInterval(t); resolve(); } }, 50); });
const calls = () => fs.readFileSync(path.join(tmp, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const cval = (args, key) => { for (let i = 0; i < args.length - 1; i++) if (args[i] === '-c' && args[i + 1].startsWith(`${key}=`)) return args[i + 1].slice(key.length + 1); return null; };
let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log(`ok ${n} ${name}`); };

(async () => {
  await test('PA on ChatGPT: message on stdin, office note, CLAUDE.md, guard hook, reply saved', async () => {
    chats.send('pa', 'Hello from the boss');
    await idle('pa');
    const m = chats.history('pa').messages;
    assert.deepStrictEqual(m.map((x) => [x.from, x.text]), [['boss', 'Hello from the boss'], ['pa', 'Baik boss, from ChatGPT.']]);
    const c = calls()[0];
    assert.strictEqual(c.msg, 'Hello from the boss');
    assert.strictEqual(c.prov, 'codex'); assert.match(c.run, /^[a-z0-9]+$/);
    assert.strictEqual(path.resolve(c.cwd), path.resolve(dir));
    assert.deepStrictEqual(c.args.slice(0, 2), ['exec', '--json']);
    assert.strictEqual(c.args[c.args.length - 1], '-');
    assert.ok(!c.args.includes('Hello from the boss'), 'the message never goes on the command line');
    assert.match(JSON.parse(cval(c.args, 'developer_instructions')), /create one task file/);
    assert.strictEqual(cval(c.args, 'project_doc_fallback_filenames'), '["CLAUDE.md"]');
    assert.strictEqual(cval(c.args, 'sandbox_mode'), '"workspace-write"');
    const hook = cval(c.args, 'hooks.PreToolUse');
    assert.ok(hook.includes(JSON.stringify(path.join(dir, '.office', 'guard.js')).slice(1, -1).replace(/\\\\/g, '\\\\\\\\')) || hook.includes('guard.js'));
    if (process.platform === 'win32') assert.match(hook, /command="& \\"/, 'PowerShell needs & to run the hook');
    assert.strictEqual(cval(c.args, 'model_reasoning_effort'), '"medium"');
    assert.strictEqual(cval(c.args, 'sandbox_workspace_write.network_access'), null, 'the PA runs no commands: no network');
    const u = usage.summary().today;
    assert.strictEqual(u.runs, 1); assert.strictEqual(u.cost, 0); assert.strictEqual(u.input, 23256 - 13952);
  });

  await test('next message resumes the thread; a lost thread starts fresh once', async () => {
    chats.send('pa', 'Thanks');
    await idle('pa');
    let c = calls().pop();
    assert.deepStrictEqual(c.args.slice(0, 3), ['exec', 'resume', 'th-1']);
    chats.setSession('pa', 'gone');
    chats.setMeta('pa', { ctx: 1, mcp: 'codex:{}' }); // as if made by this provider, so no fresh start first
    chats.send('pa', 'Again');
    await idle('pa');
    const last = calls().slice(-2);
    assert.strictEqual(last[0].args[2], 'gone');
    assert.ok(!last[1].args.includes('resume'));
    assert.strictEqual(chats.sessions().pa, 'th-1');
  });

  await test('switching AI starts a fresh conversation with a recap', async () => {
    chats.setMeta('pa', { ctx: 1, mcp: '--strict-mcp-config{}' }); // made by Claude
    chats.send('pa', 'Now on ChatGPT');
    await idle('pa');
    const c = calls().pop();
    assert.ok(!c.args.includes('resume'));
    assert.match(c.msg, /\[Recap of the recent chat/);
    assert.ok(chats.history('pa').messages.some((x) => x.kind === 'new'));
  });

  await test('a tool step with the guard mark goes on', async () => {
    chats.send('pa', 'GUARDED read');
    await idle('pa');
    const m = chats.history('pa').messages;
    assert.strictEqual(m[m.length - 1].text, 'Read it.');
    assert.ok(!fs.existsSync(path.join(dir, '.office', 'runs', `${calls().pop().run}.guard`)), 'the mark is cleared after the run');
  });

  await test('a tool step without the guard mark stops the run for safety', async () => {
    chats.send('pa', 'UNGUARDED read');
    await idle('pa');
    const m = chats.history('pa').messages;
    assert.ok(!m.some((x) => x.text === 'Read it.' && x.at > m[m.length - 3].at));
    assert.match(m[m.length - 1].text, /Stopped for safety/);
    assert.strictEqual(m[m.length - 1].kind, 'error');
  });

  await test('not logged in: plain words', async () => {
    chats.send('pa', 'LOGIN');
    await idle('pa');
    const m = chats.history('pa').messages;
    assert.match(m[m.length - 1].text, /codex login/);
  });

  await test('Claude staff next to a ChatGPT manager still run on Claude Code', () => {
    const P = require('../lib/providers');
    const c = JSON.parse(fs.readFileSync(path.join(dir, 'office.json'), 'utf8'));
    assert.strictEqual(P.providerId(c, 'pa'), 'codex');
    assert.strictEqual(P.providerId(c, c.staff[0].id), 'claude');
    assert.strictEqual(P.providerId(c, c.staff[1].id), 'codex');
  });

  await test('ChatGPT plan limits come from Codex\'s session log; ChatGPT runs have no cost', () => {
    const home = path.join(tmp, 'codex-home'), day = path.join(home, 'sessions', '2026', '11', '26');
    fs.mkdirSync(day, { recursive: true });
    const thread = '01a21616-ec78-7022-8e26-ff1ebf48968b';
    const rl = (p, s) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: { limit_id: 'codex', primary: { used_percent: p, window_minutes: 300, resets_at: 1795683809 }, secondary: { used_percent: s, window_minutes: 10080, resets_at: 1796252589 } } } });
    fs.writeFileSync(path.join(day, `rollout-2026-11-26T12-22-11-${thread}.jsonl`), `${rl(5, 10)}\n{"type":"other"}\n${rl(9, 16)}\n`);
    assert.deepStrictEqual(codex.limitsFor(thread, home), {
      five_hour: { used: 9, resets: '2026-11-26T09:03:29.000Z', status: '' },
      seven_day: { used: 16, resets: '2026-12-02T23:03:09.000Z', status: '' } });
    assert.strictEqual(codex.limitsFor('00000000-0000-0000-0000-000000000000', home), null);
    assert.strictEqual(codex.limitsFor('../../etc', home), null);
    const before = process.env.CODEX_HOME; process.env.CODEX_HOME = home;
    try {
      const u = new Usage(dir);
      u.see({ type: 'thread.started', thread_id: thread }, 'siti', 'task', 't9', 'codex');
      u.see({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 5 } }, 'siti', 'task', 't9', 'codex');
      const s = u.summary();
      assert.strictEqual(s.limitsBy.codex.five_hour.used, 9);
      assert.strictEqual(s.today.people.siti.priced, 0, 'ChatGPT runs: tokens only');
      assert.ok(s.today.people.pa.priced === 0 && s.today.people.pa.tokens > 0);
    } finally { if (before === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = before; }
  });

  await test('parser: real event shapes', () => {
    const ev = (j) => codex.parse(j).map((e) => e.t);
    assert.deepStrictEqual(ev({ type: 'thread.started', thread_id: 'x' }), ['session', 'thinking']);
    assert.deepStrictEqual(ev({ type: 'item.completed', item: { type: 'error', message: '--dangerously-bypass-hook-trust is enabled' } }), []);
    const cmd = codex.parse({ type: 'item.started', item: { type: 'command_execution', command: "\"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe\" -Command 'echo it''s'" } })[0];
    assert.deepStrictEqual([cmd.name, cmd.input.command, cmd.guarded], ['Bash', "echo it's", true]);
    const fc = codex.parse({ type: 'item.started', item: { type: 'file_change', changes: [{ path: 'C:\\o\\note.txt', kind: 'add' }] } })[0];
    assert.deepStrictEqual([fc.name, fc.input.file_path], ['Write', 'C:\\o\\note.txt']);
    assert.deepStrictEqual(codex.parse({ type: 'turn.failed', error: { message: 'bad model' } }), [{ t: 'error', text: 'bad model' }]);
    assert.ok(codex.missingSession('Error: thread/resume: thread/resume failed: no rollout found for thread id 0000 (code -32600)'));
  });

  await test('guard (Codex): plain read commands inside the office, for everyone', () => {
    const office = { ...JSON.parse(fs.readFileSync(path.join(dir, 'office.json'), 'utf8')), dir, linked: [] };
    const d = (command, cwd = dir) => guard.decide({ tool_name: 'Bash', tool_input: { command }, cwd }, office, { chat: true, provider: 'codex' }).decision;
    assert.strictEqual(d('Get-Content OFFICE.md'), 'allow');
    assert.strictEqual(d('rg -n "Hana" staff'), 'allow');
    assert.strictEqual(d('Get-ChildItem -Force'), 'allow');
    assert.strictEqual(d(`Get-Content "${path.join(os.homedir(), '.ssh', 'id_rsa')}"`), 'deny');
    assert.strictEqual(d('Get-Content ..\\..\\secret.txt'), 'deny');
    assert.strictEqual(d('rg --pre calc x'), 'deny');
    assert.strictEqual(d('Get-Content OFFICE.md | Out-File x'), 'deny');
    assert.strictEqual(d('Remove-Item OFFICE.md'), 'deny');
    assert.strictEqual(d('git status'), 'deny', 'the PA still runs no other commands');
    // without the Codex flag (Claude Code) reading by shell stays off for the PA
    assert.strictEqual(guard.decide({ tool_name: 'Bash', tool_input: { command: 'Get-Content OFFICE.md' }, cwd: dir }, office, { chat: true }).decision, 'deny');
  });

  await test('guard (Codex): file edits only inside, never the office\'s own files', () => {
    const office = { dir, linked: [path.join(tmp, 'site')] };
    const p = (patch, cwd = dir) => guard.decidePatch({ tool_name: 'apply_patch', tool_input: { command: patch }, cwd }, office).decision;
    const add = (f) => `*** Begin Patch\n*** Add File: ${f}\n+hi\n*** End Patch`;
    assert.strictEqual(p(add('projects/a/notes.md')), 'allow');
    assert.strictEqual(p(add(path.join(tmp, 'site', 'index.html'))), 'allow');
    assert.strictEqual(p(add('office.json')), 'deny');
    assert.strictEqual(p(add('.office/grants.json')), 'deny');
    assert.strictEqual(p(add('notes.md'), path.join(dir, 'staff', 'siti')), 'allow');
    assert.strictEqual(p(add('.claude/settings.json'), path.join(dir, 'staff', 'siti')), 'deny');
    assert.strictEqual(p(add(path.join(tmp, 'elsewhere.txt'))), 'deny');
    assert.strictEqual(p(`*** Begin Patch\n*** Update File: notes.md\n*** Move to: ../../x.md\n*** End Patch`), 'deny');
    assert.strictEqual(p('not a patch'), 'deny');
  });

  console.log(`\n${n} codex tests passed`);
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });

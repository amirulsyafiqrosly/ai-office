// Task runner tests with a fake "claude": tasks run as the staff, one at a time per staff,
// in parallel across staff; results go back into the task file; unknown staff and Stop handled.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-office-tasks-'));
const bin = path.join(tmp, 'bin');
fs.mkdirSync(bin);
const fake = `
const fs = require('fs');
const a = process.argv.slice(2);
const msg = a[a.indexOf('-p') + 1];
fs.appendFileSync(${JSON.stringify(path.join(tmp, 'calls.jsonl'))}, JSON.stringify({ args: a, cwd: process.cwd(), at: Date.now() }) + '\\n');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const wait = msg.includes('LONG') ? 2500 : 400;
setTimeout(() => {
  out({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Done: ' + msg.split('\\n')[2] }] } });
  out({ type: 'result', subtype: 'success', is_error: false });
}, wait);
`;
if (process.platform === 'win32') {
  fs.writeFileSync(path.join(bin, 'claude.cmd'), '@echo off\r\n');
  const cli = path.join(bin, 'node_modules', '@anthropic-ai', 'claude-code');
  fs.mkdirSync(cli, { recursive: true }); fs.writeFileSync(path.join(cli, 'cli.js'), fake);
} else {
  fs.writeFileSync(path.join(bin, 'claude'), `#!${process.execPath}\n${fake}`, { mode: 0o755 });
}
process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;

const G = require('../lib/generate');
const D = require('../lib/defaults');
const { Tasks } = require('../lib/tasks');
const { access, chatEnv, resolveClaude } = require('../lib/chat');
const dir = path.join(tmp, 'office');
G.writeOffice(dir, G.buildConfig({ company: 'Kedai Ali', pa: 'Hana', staff: D.STAFF.slice(0, 3).map(({ name, role, job }) => ({ name, role, job })) }));

const started = [], ended = [];
const tasks = new Tasks(dir, {
  access: (id) => access(dir, id), claude: resolveClaude, env: chatEnv,
  loadCfg: () => JSON.parse(fs.readFileSync(path.join(dir, 'office.json'), 'utf8')),
  onStart: (t) => started.push(t.id), onEnd: (t, r) => ended.push([t.id, t.status, r]),
});
const put = (id, staff, text) => fs.writeFileSync(path.join(dir, 'tasks', `${id}.md`), `---\nstaff: ${staff}\nproject:\nstatus: new\n---\n${text}\n`);
const until = (fn, ms = 15000) => new Promise((res, rej) => { const t0 = Date.now(); const t = setInterval(() => { if (fn()) { clearInterval(t); res(); } else if (Date.now() - t0 > ms) { clearInterval(t); rej(new Error('timeout')); } }, 50); });
const calls = () => fs.readFileSync(path.join(tmp, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log(`ok ${n} ${name}`); };

(async () => {
  await test('a task runs as that staff, in their folder, and the report goes back into the file', async () => {
    put('t1', 'siti', 'Quote 50 t-shirts for Kedai Ali');
    tasks.scan();
    await until(() => ended.length === 1);
    const t = tasks.read('t1');
    assert.strictEqual(t.status, 'done'); assert.ok(t.started && t.finished);
    assert.strictEqual(t.result, 'Done: Quote 50 t-shirts for Kedai Ali');
    assert.strictEqual(t.task, 'Quote 50 t-shirts for Kedai Ali');
    const c = calls()[0];
    assert.strictEqual(path.resolve(c.cwd), path.resolve(dir, 'staff', 'siti'));
    assert.ok(!c.args[c.args.indexOf('--tools') + 1].includes('Agent'), 'staff cannot hand work on');
    assert.ok(!c.args.includes('--resume'), 'each task starts fresh');
  });

  await test('one at a time per staff, different staff in parallel', async () => {
    put('t2', 'nurul', 'LONG invoice one');
    put('t3', 'nurul', 'invoice two');
    put('t4', 'aina', 'LONG reply to Ali');
    tasks.scan(); tasks.scan(); // scanning twice must not start anything twice
    await until(() => ended.length === 4);
    const c = calls().slice(1);
    assert.strictEqual(c.length, 3);
    const at = (word) => c.find((x) => x.args[x.args.indexOf('-p') + 1].includes(word)).at;
    assert.ok(Math.abs(at('invoice one') - at('reply to Ali')) < 1500, 'nurul and aina started together');
    assert.ok(at('invoice two') - at('invoice one') >= 2000, 'nurul did her second task after the first');
  });

  await test('a task for someone who is not on the team fails with a plain reason', async () => {
    put('t5', 'ghost', 'Do something');
    tasks.scan();
    await until(() => ended.length === 5);
    assert.strictEqual(tasks.read('t5').status, 'failed');
    assert.match(tasks.read('t5').result, /no active staff/);
  });

  await test('Stop: running and waiting tasks', async () => {
    put('t6', 'siti', 'LONG long quote');
    put('t7', 'siti', 'second quote');
    tasks.scan();
    await until(() => tasks.active().some((a) => a.id === 't6'));
    assert.deepStrictEqual(tasks.stop('t7'), { ok: true });
    assert.strictEqual(tasks.read('t7').status, 'stopped');
    tasks.stop('t6');
    await until(() => tasks.read('t6').status === 'stopped');
    assert.deepStrictEqual(tasks.active(), []);
  });

  await test('after a restart, a task left "working" is marked stopped', async () => {
    put('t8', 'aina', 'half done'); fs.writeFileSync(path.join(dir, 'tasks', 't8.md'), fs.readFileSync(path.join(dir, 'tasks', 't8.md'), 'utf8').replace('status: new', 'status: working'));
    tasks.recover();
    assert.strictEqual(tasks.read('t8').status, 'stopped');
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${n} task tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });

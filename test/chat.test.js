// Chat runner tests with a fake "claude" that prints stream-json like the real one.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-office-chat-'));
const bin = path.join(tmp, 'bin');
fs.mkdirSync(bin);
// The fake: records its arguments and cwd, then answers. A message containing LIMIT fails like a usage limit.
const fake = `
const fs = require('fs');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(path.join(tmp, 'calls.jsonl'))}, JSON.stringify({ args: a, cwd: process.cwd() }) + '\\n');
const msg = a[a.indexOf('-p') + 1];
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ type: 'system', subtype: 'init', session_id: 'sess-1' });
if (msg.includes('LIMIT')) { out({ type: 'result', subtype: 'error', is_error: true, result: 'Claude AI usage limit reached|1795500000' }); process.exit(1); }
if (msg.includes('SLOW')) { setTimeout(() => { out({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'slow done' }] } }); }, 1500); return; }
out({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Baik boss. I will ask **Siti**.' }, { type: 'tool_use', name: 'Agent' }] } });
out({ type: 'system', subtype: 'task_started', task_id: 't1', description: 'Quote for Kedai Ali', subagent_type: 'siti' });
out({ type: 'assistant', parent_tool_use_id: 'toolu_x', message: { content: [{ type: 'text', text: 'staff inner text, not shown' }] } });
out({ type: 'system', subtype: 'task_notification', task_id: 't1', status: 'completed' });
out({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Quote is ready: RM1,250.' }] } });
out({ type: 'result', subtype: 'success', is_error: false, result: 'Quote is ready: RM1,250.' });
`;
if (process.platform === 'win32') { // like an npm install: claude.cmd next to node_modules/@anthropic-ai/claude-code/cli.js
  fs.writeFileSync(path.join(bin, 'claude.cmd'), '@echo off\r\n');
  const cli = path.join(bin, 'node_modules', '@anthropic-ai', 'claude-code');
  fs.mkdirSync(cli, { recursive: true }); fs.writeFileSync(path.join(cli, 'cli.js'), fake);
} else {
  fs.writeFileSync(path.join(bin, 'claude'), `#!${process.execPath}\n${fake}`, { mode: 0o755 });
}
process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;

const G = require('../lib/generate');
const D = require('../lib/defaults');
const { Chats } = require('../lib/chat');
const dir = path.join(tmp, 'office');
G.writeOffice(dir, G.buildConfig({ company: 'Kedai Ali', pa: 'Hana', staff: D.STAFF.slice(0, 2).map(({ name, role, job }) => ({ name, role, job })) }));

const events = [];
const states = [];
const chats = new Chats(dir, {
  onMessage: (id, m) => events.push([id, m]),
  onState: (id, r) => states.push([id, r]),
  loadCfg: () => JSON.parse(fs.readFileSync(path.join(dir, 'office.json'), 'utf8')),
});
const idle = (id) => new Promise((resolve) => { const t = setInterval(() => { if (!chats.runs.has(id)) { clearInterval(t); resolve(); } }, 50); });
const calls = () => fs.readFileSync(path.join(tmp, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log(`ok ${n} ${name}`); };

(async () => {
  await test('PA chat: reply, staff activity, inner staff text hidden', async () => {
    chats.send('pa', 'Quote 50 t-shirts for Kedai Ali');
    await idle('pa');
    const m = chats.history('pa').messages;
    assert.deepStrictEqual(m.map((x) => x.from), ['boss', 'pa', 'system', 'system', 'pa']);
    assert.strictEqual(m[2].text, 'Siti started: Quote for Kedai Ali');
    assert.strictEqual(m[3].text, 'Siti finished: Quote for Kedai Ali'); assert.ok(m[3].done);
    assert.ok(!m.some((x) => /inner text/.test(x.text)));
    assert.deepStrictEqual(states, [['pa', true], ['pa', false]]);
    const c = calls()[0];
    assert.strictEqual(path.resolve(c.cwd), path.resolve(dir));
    assert.ok(c.args.includes('--tools') && c.args[c.args.indexOf('--tools') + 1] === 'Read,Write,Edit,Glob,Grep', 'no Agent tool: staff work runs as tasks');
    assert.strictEqual(c.args[c.args.indexOf('--permission-mode') + 1], 'default');
    const allowed = c.args[c.args.indexOf('--allowedTools') + 1].split(',');
    assert.ok(!allowed.includes('Read') && !allowed.includes('Write') && !allowed.includes('Edit'), 'file tools never allowed everywhere');
    assert.deepStrictEqual(allowed, require('../lib/templates').officeRules(dir));
    assert.match(c.args[c.args.indexOf('--append-system-prompt') + 1], /create one task file/);
    assert.match(c.args[c.args.indexOf('--append-system-prompt') + 1], /only inside the office folder/);
    assert.ok(!c.args.includes('--resume'));
  });

  await test('next message resumes the same session', async () => {
    chats.send('pa', 'Thanks');
    await idle('pa');
    const c = calls().pop();
    assert.strictEqual(c.args[c.args.indexOf('--resume') + 1], 'sess-1');
  });

  await test('a message sent while replying waits, then runs next', async () => {
    chats.send('siti', 'SLOW please');
    assert.deepStrictEqual(chats.send('siti', 'and another thing'), { ok: true, queued: true });
    await idle('siti');
    const last2 = calls().slice(-2).map((x) => x.args[x.args.indexOf('-p') + 1]);
    assert.deepStrictEqual(last2, ['SLOW please', 'and another thing']);
    assert.ok(states.filter(([id]) => id === 'siti').length === 2, 'busy once, idle once: no flicker between the two');
  });

  await test('staff chat runs in the staff folder and leaves a summary for the PA', async () => {
    const c = calls().pop();
    assert.strictEqual(path.resolve(c.cwd), path.resolve(dir, 'staff', 'siti'));
    const s = fs.readFileSync(path.join(dir, '.office', 'staff-chats.md'), 'utf8');
    assert.match(s, /- \d{4}-\d{2}-\d{2} \d{2}:\d{2}, Siti: boss said "SLOW please"\. Siti replied "slow done"/);
  });

  await test('usage limit shows a plain message', async () => {
    chats.send('aina', 'LIMIT test');
    await idle('aina');
    const last = chats.history('aina').messages.pop();
    assert.strictEqual(last.kind, 'error'); assert.match(last.text, /usage limit is reached/);
  });

  await test('a linked folder is the only extra place a chat can reach', async () => {
    const ext = path.join(tmp, 'linked site'); fs.mkdirSync(ext);
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'office.json'), 'utf8'));
    cfg.linked = [{ path: ext, label: 'Website' }]; fs.writeFileSync(path.join(dir, 'office.json'), JSON.stringify(cfg));
    chats.send('siti', 'hi');
    await idle('siti');
    const c = calls().pop();
    const allowed = c.args[c.args.indexOf('--allowedTools') + 1].split(',');
    const T = require('../lib/templates');
    assert.deepStrictEqual(allowed, [...T.officeRules(dir), ...T.officeRules(ext)]);
    assert.strictEqual(c.args[c.args.indexOf('--add-dir') + 1], ext);
    assert.ok(c.args[c.args.indexOf('--append-system-prompt') + 1].includes(ext));
  });

  await test('chat env drops the parent Claude session, keeps the user settings', async () => {
    const { chatEnv } = require('../lib/chat');
    Object.assign(process.env, { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'x', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CONFIG_DIR: '/cfg', CLAUDE_CODE_GIT_BASH_PATH: 'C:/git/bash.exe' });
    const e = chatEnv('/office');
    assert.ok(!('CLAUDECODE' in e) && !('CLAUDE_CODE_SESSION_ID' in e) && !('CLAUDE_CODE_CHILD_SESSION' in e));
    assert.strictEqual(e.CLAUDE_CONFIG_DIR, '/cfg'); assert.strictEqual(e.CLAUDE_CODE_GIT_BASH_PATH, 'C:/git/bash.exe');
    assert.strictEqual(e.PWD, '/office'); assert.strictEqual(e.AI_OFFICE_CHAT, '1');
    for (const k of ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_GIT_BASH_PATH']) delete process.env[k];
  });

  await test('new conversation forgets the session but keeps the history', async () => {
    const before = chats.history('pa').messages.length;
    chats.reset('pa');
    assert.ok(!chats.sessions().pa);
    const h = chats.history('pa').messages;
    assert.strictEqual(h.length, before + 1); assert.strictEqual(h.pop().kind, 'new');
    chats.send('pa', 'hello again');
    await idle('pa');
    assert.ok(!calls().pop().args.includes('--resume'), 'fresh start');
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${n} chat tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });

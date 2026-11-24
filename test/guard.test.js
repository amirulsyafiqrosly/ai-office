// Command guard: who may run what, where. This is a safety boundary, so test it hard.
const assert = require('assert');
const { decide, PRESETS } = require('../office-files/guard');

const office = {
  dir: '/home/ali/office',
  linked: ['/home/ali/projects/8fix'],
  staff: [
    { id: 'shah', name: 'Shah', commands: ['git', 'laravel'], customCommands: ['php vendor/bin/pint'] },
    { id: 'siti', name: 'Siti' },
  ],
};
const run = (command, o = {}) => decide({ tool_name: 'Bash', tool_input: { command }, agent_type: o.agent ?? 'shah', cwd: o.cwd || office.dir }, office, { chat: o.chat ?? true, win: false });
const allow = (c, o) => assert.strictEqual(run(c, o).decision, 'allow', `should allow: ${c} (${run(c, o).reason})`);
const deny = (c, o) => assert.strictEqual(run(c, o).decision, 'deny', `should deny: ${c}`);
let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok ${n} ${name}`); };

test('allowed commands in a linked folder', () => {
  allow('git status');
  allow('cd /home/ali/projects/8fix && git add app/User.php && git commit -m "feat(auth): login fix"');
  allow("cd '/home/ali/projects/8fix' && php artisan make:model Order");
  allow('cd /home/ali/projects/8fix/app && php artisan route:list');
  allow('cd /home/ali/projects/8fix && php vendor/bin/pint');
});

test('real-life forms Claude writes: multi-line messages, git -C, 2>&1', () => {
  allow('cd "/home/ali/projects/8fix" && git add a.txt && git commit -m "via office\n\nCo-Authored-By: Claude <noreply@anthropic.com>"');
  allow("git commit -m 'fix: a; b | c > d'");
  allow('git commit -m "a && rm -rf / is only text here"'); // inside quotes: just a message
  allow('git -C "/home/ali/projects/8fix" add a.txt');
  allow('git -C /home/ali/projects/8fix status 2>&1');
  deny('git -C /home/ali/other status');
  deny('git -C /home/ali/projects/8fix push');
  deny('git commit -m "$(rm -rf /)"');
  deny('git commit -m "`rm x`"');
  deny('git commit -m "unclosed');
  deny('git status 2>&1 > out.txt');
});

test('folders outside the office and links are refused', () => {
  deny('cd /home/ali/other && git status');
  deny('cd /home/ali/projects/8fix-old && git status');
  deny('cd /home/ali/projects/8fix/../secret && git status');
  deny('cd ~ && git status');
});

test('always-blocked commands, even when the preset is ticked', () => {
  for (const c of ['git push origin main', 'cd /home/ali/projects/8fix && git push', 'git reset --hard HEAD~1', 'git clean -fd',
    'php artisan migrate:fresh --seed', 'php artisan db:wipe', 'php artisan tinker', 'rm -rf app', 'curl https://evil.example']) deny(c);
  assert.match(run('git push').reason, /never run from the dashboard/);
});

test('tricks to sneak a command in are refused', () => {
  for (const c of ['git status; rm -rf /', 'git status | sh', 'git log `rm x`', 'git log $(rm x)', 'git status > /etc/passwd',
    'git status & rm x', 'git status || rm x', 'git status\nrm x', 'cd /home/ali/projects/8fix && cd /etc && git status']) deny(c);
});

test('only ticked presets; other staff and the PA run nothing', () => {
  deny('npm install');
  deny('composer install');
  deny('git status', { agent: 'siti' });
  assert.match(run('git status', { agent: 'siti' }).reason, /no commands turned on/);
  deny('git status', { agent: '' });
  assert.match(run('git status', { agent: '' }).reason, /does not run commands/);
});

test('a direct chat in a staff folder counts as that staff', () => {
  allow('git status', { agent: '', cwd: '/home/ali/office/staff/shah' });
  deny('git status', { agent: '', cwd: '/home/ali/office/staff/siti' });
});

test('terminal: no opinion on what is not allowed, so Claude Code asks the boss', () => {
  assert.strictEqual(run('npm install', { chat: false }).decision, null);
  assert.strictEqual(run('git push', { chat: false }).decision, null);
  assert.strictEqual(run('git status', { chat: false }).decision, 'allow');
});

test('Windows paths (Git Bash /c/..., backslashes, quotes, WSL share)', () => {
  const w = { dir: 'C:\\Users\\Ali\\office', linked: ['C:\\Users\\Ali\\shop site', '\\\\wsl.localhost\\Ubuntu\\home\\ali\\8fix'], staff: office.staff };
  const r = (command) => decide({ tool_name: 'Bash', tool_input: { command }, agent_type: 'shah', cwd: w.dir }, w, { chat: true, win: true }).decision;
  assert.strictEqual(r('cd "/c/Users/Ali/shop site" && git status'), 'allow');
  assert.strictEqual(r('cd "C:\\Users\\Ali\\shop site" && git status'), 'allow');
  assert.strictEqual(r('cd //wsl.localhost/Ubuntu/home/ali/8fix && git status'), 'allow');
  assert.strictEqual(r('cd /c/Users/Ali/Documents && git status'), 'deny');
});

test('presets are what the Staff page offers', () => {
  assert.deepStrictEqual(Object.keys(PRESETS), ['git', 'laravel', 'node', 'composer']);
});

console.log(`\n${n} guard tests passed`);

// Dashboard chats. Each message runs the user's own Claude Code once:
//   claude -p "<message>" --resume <session> --output-format stream-json --verbose
// in the office folder (the PA) or in staff/<id>/ (a direct staff chat).
// Replies and staff activity are saved to .office/chats/<id>.jsonl and pushed to the page.
// After a direct staff chat, one summary line goes to .office/staff-chats.md for the PA.

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { officeRules } = require('./templates');
const { linkedFolders } = require('./generate');

// Only these tools exist in dashboard chats, so Claude never waits on a permission
// prompt nobody can see (see docs/milestone-1-findings.md). Reading and writing are
// allowed only inside the office folder and the folders the boss linked: anything else
// on the computer is refused (no prompt in a dashboard chat, so it just fails).
const TOOLS = ['Agent', 'Read', 'Write', 'Edit', 'Glob', 'Grep'];

function access(dir, who = 'pa') {
  const linked = linkedFolders(dir);
  let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path.join(dir, 'office.json'), 'utf8')); } catch { /* none */ }
  const { PRESETS } = require('../office-files/guard');
  const everyone = (cfg.staff || []).filter((s) => (s.commands || []).length + (s.customCommands || []).length > 0);
  const runners = everyone.filter((s) => who === 'pa' || s.id === who);
  const what = (s) => [...(s.commands || []).map((k) => (PRESETS[k] || {}).label || k), ...(s.customCommands || [])].join(', ');
  const cmdNote = runners.length
    ? `Commands: only ${runners.map((s) => `${s.name} (${what(s)})`).join('; ')} may run commands; hand command work to them. A guard checks every command: it must be on their list, run in the office or a linked folder (start with cd "<folder>" &&), with no ; | $ > < tricks. Never run: git push, reset --hard, migrate:fresh, rm. The boss runs those himself.`
    : everyone.length
      ? `Commands: you cannot run commands. Only ${everyone.map((s) => s.name).join(', ')} can (ask the boss to give the task to them, or to tick commands for you on the Staff page).`
      : 'Commands: nobody in this office can run commands (git, artisan, npm, composer, delete). The boss can turn them on per staff on the Staff page of the dashboard; there is no other way, so do not suggest hiring or adding a staff for it.';
  const paths = [...new Set(linked.map((l) => path.resolve(l.path)))];
  const allowed = ['Agent', ...[dir, ...paths].flatMap((d) => officeRules(d))];
  const note = linked.length
    ? `Folders outside the office the boss linked (you may read and write only these, plus the office folder):\n${linked.map((l) => `- ${l.path}${l.project ? ` (project ${l.project}: that project's files live here)` : l.label ? ` (${l.label})` : ''}`).join('\n')}\nNever touch any other folder outside the office.`
    : 'You may read and write only inside the office folder. Other folders on this computer are off limits unless the boss links them in the dashboard (Settings > Linked folders).';
  return { allowed, paths, note: `${note}\n${cmdNote}`, shell: runners.length > 0 };
}

let claudeCmd = null; // resolved once: { cmd, pre: [] }
function resolveClaude() {
  if (claudeCmd) return claudeCmd;
  claudeCmd = { cmd: 'claude', pre: [] };
  if (process.platform === 'win32') {
    // claude.exe runs directly. An npm install gives claude.cmd: run its cli.js with node
    // instead of going through cmd.exe, so the message text is never parsed by a shell.
    const r = spawnSync('where', ['claude'], { encoding: 'utf8', windowsHide: true });
    const found = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const first = found.find((f) => /\.(exe|cmd)$/i.test(f)); // the one PATH would pick
    if (first && /\.exe$/i.test(first)) claudeCmd = { cmd: first, pre: [] };
    else if (first) {
      const cli = path.join(path.dirname(first), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      if (fs.existsSync(cli)) claudeCmd = { cmd: process.execPath, pre: [cli] };
    }
  }
  return claudeCmd;
}

// If Claude Code itself started the dashboard (INSTALL.md does that), its session variables are
// inherited, and the chat's claude would act as a child of that other session. Drop those;
// keep the user's settings (config folder, login, model, Windows Git Bash path).
const SESSION_VARS = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|OLDPWD|CLAUDE_CODE_(CHILD_SESSION|SESSION_ID|SESSION_ATTENDED|CHILD_NOTES_DIR|MESSAGING_SOCKET|MESSAGING_TOKEN|ENTRYPOINT|EXECPATH|SSE_PORT))$/;
function chatEnv(cwd) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!SESSION_VARS.test(k)) env[k] = v;
  return { ...env, PWD: cwd, AI_OFFICE_CHAT: '1' }; // PWD: Claude Code resolves relative paths from it
}

class Chats {
  constructor(dir, { onMessage, onState, loadCfg }) {
    this.dir = dir;
    this.root = path.join(dir, '.office', 'chats');
    this.onMessage = onMessage; this.onState = onState; this.loadCfg = loadCfg;
    this.runs = new Map(); // id -> child process
    fs.mkdirSync(this.root, { recursive: true });
  }

  sessionsFile() { return path.join(this.root, 'sessions.json'); }
  sessions() { try { return JSON.parse(fs.readFileSync(this.sessionsFile(), 'utf8')); } catch { return {}; } }
  setSession(id, sid) { const s = this.sessions(); if (sid) s[id] = sid; else delete s[id]; fs.writeFileSync(this.sessionsFile(), JSON.stringify(s, null, 2)); }

  log(id) { return path.join(this.root, `${id}.jsonl`); }
  add(id, m) {
    const msg = { at: new Date().toISOString(), ...m };
    fs.appendFileSync(this.log(id), JSON.stringify(msg) + '\n');
    this.onMessage(id, msg);
    return msg;
  }
  history(id, limit = 200) {
    let lines = [];
    try { lines = fs.readFileSync(this.log(id), 'utf8').trim().split('\n'); } catch { /* no chat yet */ }
    const out = [];
    for (const l of lines.slice(-limit)) { try { out.push(JSON.parse(l)); } catch { /* skip */ } }
    return { messages: out, running: this.runs.has(id) };
  }
  running() { return [...this.runs.keys()]; }

  // who: 'pa' or a staff id (already checked by the caller)
  send(who, text) {
    if (this.runs.has(who)) { const e = new Error('Still working on your last message. Wait for the reply, or press Stop.'); e.status = 409; throw e; }
    const msg = String(text || '').trim().slice(0, 8000);
    if (!msg) { const e = new Error('Empty message'); e.status = 400; throw e; }
    this.add(who, { from: 'boss', text: msg });
    this.run(who, msg, true);
    return { ok: true };
  }

  run(who, msg, mayRetry) {
    const cfg = this.loadCfg();
    const cwd = who === 'pa' ? this.dir : path.join(this.dir, 'staff', who);
    const staffName = (id) => ((cfg.staff || []).find((s) => s.id === id) || {}).name || id;
    const acc = access(this.dir, who);
    const allowed = [...acc.allowed];
    for (const [name, a] of Object.entries(cfg.addons || {})) if (a && a.enabled && a.mcp) allowed.push(`mcp__${a.mcp || name}`);
    const sid = this.sessions()[who];
    const args = ['-p', msg, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default',
      '--tools', [...TOOLS, ...(acc.shell ? ['Bash'] : [])].join(','), '--allowedTools', allowed.join(','), ...acc.paths.flatMap((d) => ['--add-dir', d]),
      '--append-system-prompt', acc.note, ...(sid ? ['--resume', sid] : [])];
    const { cmd, pre } = resolveClaude();
    let child;
    try {
      child = spawn(cmd, [...pre, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: chatEnv(cwd) });
    } catch (e) {
      this.add(who, { from: 'system', kind: 'error', text: `Could not start Claude Code: ${e.message}` });
      return;
    }
    this.runs.set(who, child);
    this.onState(who, true);

    const tasks = new Map(); // task id -> { name, desc }
    let buf = '', err = '', said = '', lastErr = '';
    const handle = (j) => {
      if (j.type === 'system' && j.subtype === 'init' && j.session_id) this.setSession(who, j.session_id);
      else if (j.type === 'assistant' && !j.parent_tool_use_id) {
        const t = (j.message.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
        if (t) { said += `${t}\n`; this.add(who, { from: who, text: t }); }
      } else if (j.type === 'system' && j.subtype === 'task_started') {
        const name = staffName(j.subagent_type); tasks.set(j.task_id, { name, desc: j.description || '' });
        this.add(who, { from: 'system', kind: 'activity', staff: j.subagent_type, text: `${name} started: ${j.description || 'a task'}` });
      } else if (j.type === 'system' && j.subtype === 'task_notification') {
        const t = tasks.get(j.task_id) || { name: 'A staff', desc: '' };
        const ok = j.status === 'completed';
        this.add(who, { from: 'system', kind: 'activity', staff: '', done: ok, text: `${t.name} ${ok ? 'finished' : 'stopped'}: ${t.desc || 'a task'}` });
      } else if (j.type === 'result' && j.is_error) {
        lastErr = String(j.result || j.subtype || 'Claude stopped with an error');
      }
    };
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line.startsWith('{')) { try { handle(JSON.parse(line)); } catch { /* not ours */ } }
      }
    });
    child.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    child.on('error', (e) => { lastErr = e.code === 'ENOENT' ? 'Claude Code was not found. Is it installed on this computer?' : e.message; });
    child.on('close', (code) => {
      this.runs.delete(who);
      const errText = `${lastErr}\n${err}`;
      if (sid && mayRetry && /no conversation found|session.*not found/i.test(errText)) { // old session gone: start fresh once
        this.setSession(who, null);
        return this.run(who, msg, false);
      }
      if (child.stopped) this.add(who, { from: 'system', kind: 'activity', text: 'Stopped.' });
      else if (lastErr || (code !== 0 && !said)) this.add(who, { from: 'system', kind: 'error', text: plainError(lastErr || err) });
      this.onState(who, false);
      if (who !== 'pa' && said) this.summarise(who, staffName(who), msg, said);
    });
  }

  // Forget the Claude session: the next message starts a fresh conversation.
  // The old messages stay in the history file; a divider marks the new start.
  reset(who) {
    if (this.runs.has(who)) { const e = new Error('Wait for the reply (or press Stop) before starting a new conversation.'); e.status = 409; throw e; }
    this.setSession(who, null);
    this.add(who, { from: 'system', kind: 'new', text: 'New conversation' });
    return { ok: true };
  }

  stop(who) {
    const c = this.runs.get(who);
    if (!c) return { ok: true };
    c.stopped = true;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/t', '/f'], { windowsHide: true });
    else c.kill('SIGTERM');
    return { ok: true };
  }

  stopAll() { for (const id of this.runs.keys()) this.stop(id); }

  // One line per direct staff chat, so the PA never gives conflicting orders.
  summarise(who, name, asked, said) {
    const one = (s, n) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 3)}...` : t; };
    const d = new Date();
    const when = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const line = `- ${when}, ${name}: boss said "${one(asked, 200)}". ${name} replied "${one(said, 240)}"\n`;
    fs.appendFileSync(path.join(this.dir, '.office', 'staff-chats.md'), line);
  }
}

function plainError(s) {
  const t = String(s || '').trim();
  if (/usage limit|rate limit|limit reached/i.test(t)) return `Your Claude usage limit is reached for now. ${t.split('\n')[0]}`;
  if (/not logged in|login|authenticate|invalid api key|oauth/i.test(t)) return 'Claude Code is not logged in. Run "claude" once in a terminal and log in, then try again.';
  return `Claude stopped with an error: ${t.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 400) || 'unknown error'}`;
}

module.exports = { Chats, TOOLS, access, chatEnv };

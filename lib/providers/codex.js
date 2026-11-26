// Codex CLI (ChatGPT plan or OpenAI API key): one run per message.
//   codex exec [resume <thread>] --json --skip-git-repo-check -c ... -      (the message comes on stdin)
// Everything is passed with -c, so the user's own ~/.codex/config.toml is never changed.
// Codex reads files with shell commands, so every command (and every file edit) goes through the
// office guard as a PreToolUse hook; see docs/providers-spike.md.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const id = 'codex';
const label = 'ChatGPT (Codex)';
const CTX_LIMIT = 250000; // Codex reports the whole turn's input (every request), so this is higher than Claude's

let cmdCache = null;
function resolve() {
  if (cmdCache) return cmdCache;
  cmdCache = { cmd: 'codex', pre: [] };
  if (process.platform === 'win32') {
    // npm gives codex.cmd: run its codex.js with node, so nothing goes through cmd.exe
    const r = spawnSync('where', ['codex'], { encoding: 'utf8', windowsHide: true });
    const found = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const first = found.find((f) => /\.(exe|cmd)$/i.test(f));
    if (first && /\.exe$/i.test(first)) cmdCache = { cmd: first, pre: [] };
    else if (first) {
      const js = path.join(path.dirname(first), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (fs.existsSync(js)) cmdCache = { cmd: process.execPath, pre: [js] };
    }
  }
  return cmdCache;
}

// The models this user's Codex offers (they depend on the ChatGPT plan): `codex debug models`, read at most
// every 10 minutes, for the Staff page. [[slug, label]], best first; [] when Codex is missing or says nothing.
let modelCache = null;
function models() {
  if (modelCache && Date.now() - modelCache.at < 600000) return modelCache.list;
  let list = [];
  try {
    const { cmd, pre } = resolve();
    const r = spawnSync(cmd, [...pre, 'debug', 'models'], { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 50 * 1024 * 1024 });
    const t = String(r.stdout || ''), j = JSON.parse(t.slice(t.indexOf('{')));
    list = (j.models || []).filter((m) => m.visibility === 'list' && /^[\w.:-]{1,60}$/.test(m.slug || ''))
      .sort((a, b) => (a.priority || 99) - (b.priority || 99))
      .map((m) => { const d = String(m.description || '').replace(/\.$/, ''); return [m.slug, d ? `${m.display_name || m.slug}: ${d.length > 45 ? `${d.slice(0, 42)}...` : d}` : m.display_name || m.slug]; });
  } catch { /* no Codex, or another output: default only */ }
  modelCache = { at: Date.now(), list };
  return list;
}

const toml = (s) => JSON.stringify(String(s)); // a JSON string is a valid TOML basic string
// The guard as Codex runs it. On Windows hooks run in PowerShell, where a quoted path alone is only a
// string (the hook would silently not run), so call it with &.
function guardCommand(dir, node = process.execPath) {
  const g = path.join(dir, '.office', 'guard.js');
  return process.platform === 'win32' ? `& "${node}" "${g}"` : `"${node}" "${g}"`;
}

// o: { sid, acc, cfg, who, dir, run }
function args(o) {
  const { model, effort } = require('../templates').runOpts(o.cfg, o.who);
  const c = (kv) => ['-c', kv];
  // --ignore-user-config: none of the user's own Codex plugins and MCP servers (some run any code, like the
  // node_repl tool, past the guard); the ChatGPT login is kept. Built-in extras off too, like the Claude staff.
  return ['exec', ...(o.sid ? ['resume', o.sid] : []), '--json', '--skip-git-repo-check', '--ignore-user-config', '--dangerously-bypass-hook-trust',
    ...c('sandbox_mode="workspace-write"'), ...c('web_search="disabled"'),
    ...(windowsSandbox() ? c(`windows.sandbox=${toml(windowsSandbox())}`) : []),
    ...OFF.flatMap((f) => c(`features.${f}=false`)),
    ...c(`sandbox_workspace_write.writable_roots=${JSON.stringify([o.dir, ...o.acc.paths])}`), // the office itself: staff work across it (the guard keeps its own files safe)
    ...(o.acc.shell ? c('sandbox_workspace_write.network_access=true') : []), // npm, composer, git pull need the network
    ...c('project_doc_fallback_filenames=["CLAUDE.md"]'),
    ...c(`developer_instructions=${toml(`${o.acc.note}\n${READ_NOTE}`)}`),
    ...c(`hooks.PreToolUse=[{matcher=".*",hooks=[{type="command",command=${toml(guardCommand(o.dir))}}]}]`),
    ...c('suppress_unstable_features_warning=true'),
    ...(model && model !== 'default' ? c(`model=${toml(model)}`) : []),
    ...(effort && effort !== 'default' ? c(`model_reasoning_effort=${toml(effort)}`) : []),
    '-'];
}
// The one setting kept from the user's own Codex config: the Windows sandbox they set up ([windows] sandbox =
// "elevated" or "unelevated"). Without it, a run with --ignore-user-config gets a read-only workspace on Windows.
function windowsSandbox(home = process.env.CODEX_HOME || path.join(require('os').homedir(), '.codex')) {
  if (process.platform !== 'win32') return null;
  let text = ''; try { text = fs.readFileSync(path.join(home, 'config.toml'), 'utf8'); } catch { return null; }
  const sec = /^\[windows\][^\S\n]*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text);
  const m = sec && /^\s*sandbox\s*=\s*"([a-z-]{1,30})"\s*$/m.exec(sec[1]);
  return m ? m[1] : null;
}

// Codex features a dashboard run never uses: connectors and plugins, browser and computer use, image
// generation, sub-agents and goals. (A name a later Codex drops is just ignored.)
const OFF = ['apps', 'plugins', 'computer_use', 'browser_use', 'browser_use_external', 'in_app_browser', 'image_generation', 'multi_agent', 'multi_agent_v2', 'goals'];
// On Windows the shell is PowerShell 5: no &&, so a command for another folder uses git -C or a full path.
const SHELL_NOTE = process.platform === 'win32' ? ' Commands run in Windows PowerShell, where && does not work: for another folder use git -C "<folder>" status, or full paths.' : '';
const READ_NOTE = 'Reading files: use one plain read command at a time (Get-Content, Get-ChildItem, rg, ls, cat), no pipes or ; and only inside the office or a linked folder. Edit files with apply_patch.' + SHELL_NOTE;

// "powershell.exe -Command 'echo hi'" or "bash -lc 'echo hi'" -> "echo hi"
function bare(cmd) {
  const m = /(?:-Command|-lc|-c)\s+'([\s\S]*)'\s*$/.exec(String(cmd || ''));
  return m ? m[1].replace(/''/g, "'") : String(cmd || '');
}

// One --json line -> the same plain events as providers/claude.js
function parse(j) {
  const out = [];
  const it = j.item || {};
  if (j.type === 'thread.started' && j.thread_id) out.push({ t: 'session', id: j.thread_id }, { t: 'thinking' });
  else if (j.type === 'turn.started') out.push({ t: 'thinking' });
  else if (j.type === 'item.started' && it.type === 'command_execution') out.push({ t: 'tool', name: 'Bash', input: { command: bare(it.command) }, guarded: true });
  else if (j.type === 'item.started' && it.type === 'file_change') {
    const ch = (it.changes || [])[0] || {};
    out.push({ t: 'tool', name: ch.kind === 'add' ? 'Write' : 'Edit', input: { file_path: ch.path || '' }, guarded: true });
  } else if (j.type === 'item.started' && it.type === 'mcp_tool_call') out.push({ t: 'tool', name: `mcp__${it.server || 'mcp'}__${it.tool || 'tool'}`, input: it.arguments || {}, guarded: true });
  else if (it.type === 'reasoning' && j.type === 'item.started') out.push({ t: 'thinking' });
  else if (j.type === 'item.completed' && it.type === 'agent_message' && String(it.text || '').trim()) out.push({ t: 'reset' }, { t: 'text', text: String(it.text).trim() });
  else if (j.type === 'turn.completed' && j.usage) out.push({ t: 'ctx', n: j.usage.input_tokens || 0 });
  else if (j.type === 'turn.failed') out.push({ t: 'error', text: String((j.error && j.error.message) || 'Codex stopped with an error') });
  return out;
}

// Tokens of one run, for the usage bar (Codex gives no cost and no plan limits).
function runFrom(j) {
  if (!j || j.type !== 'turn.completed' || !j.usage) return null;
  const u = j.usage, cached = u.cached_input_tokens || 0;
  return { model: 'codex', input: Math.max(0, (u.input_tokens || 0) - cached), output: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0), cacheWrite: 0, cacheRead: cached, cost: 0 };
}

// ChatGPT plan limits (5-hour and weekly) for the usage bar. Codex prints none with --json, but its own session
// log (~/.codex/sessions/<y>/<m>/<d>/rollout-...-<thread>.jsonl) has them on its token_count lines. Read only;
// returns { five_hour: { used, resets, status }, seven_day: {...} } or null (no log, or Codex changed its format).
function limitsFor(thread, home = process.env.CODEX_HOME || path.join(require('os').homedir(), '.codex')) {
  if (!/^[\w-]{8,80}$/.test(String(thread || ''))) return null;
  const root = path.join(home, 'sessions');
  const sub = (d) => { try { return fs.readdirSync(d).filter((x) => /^\d+$/.test(x)).sort().reverse(); } catch { return []; } };
  let file = null, days = 0;
  search: for (const y of sub(root)) for (const m of sub(path.join(root, y))) for (const d of sub(path.join(root, y, m))) {
    if (++days > 60) break search; // a resumed chat keeps the file of the day it started
    const dir = path.join(root, y, m, d);
    const f = (() => { try { return fs.readdirSync(dir).find((x) => x.endsWith(`-${thread}.jsonl`)); } catch { return null; } })();
    if (f) { file = path.join(dir, f); break search; }
  }
  if (!file) return null;
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split('\n'); } catch { return null; }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits"')) continue;
    let rl; try { rl = JSON.parse(lines[i]).payload.rate_limits; } catch { continue; }
    if (!rl) continue;
    const out = {};
    for (const w of [rl.primary, rl.secondary]) {
      if (!w || typeof w.used_percent !== 'number') continue;
      const name = w.window_minutes === 300 ? 'five_hour' : w.window_minutes === 10080 ? 'seven_day' : `${w.window_minutes}m`;
      out[name] = { used: Math.round(w.used_percent), resets: w.resets_at ? new Date(w.resets_at * 1000).toISOString() : null, status: rl.rate_limit_reached_type ? 'limited' : '' };
    }
    return Object.keys(out).length ? out : null;
  }
  return null;
}

const missingSession =(text) => /no rollout found|thread.*not found/i.test(text);
const notFound = 'Codex CLI was not found. Install it with: npm i -g @openai/codex, then run "codex login".';

function plainError(s) {
  const t = String(s || '').trim();
  if (/usage limit|rate limit|limit reached|quota/i.test(t)) return `Your ChatGPT/OpenAI usage limit is reached for now. ${t.split('\n')[0]}`;
  if (/not logged in|login|unauthori[sz]ed|401|api key/i.test(t)) return 'Codex is not logged in. Run "codex login" once in a terminal (ChatGPT plan or API key), then try again.';
  return `Codex stopped with an error: ${t.split('\n').filter((l) => l && !/^warning:|Reading additional input/i.test(l)).slice(-2).join(' ').slice(0, 400) || 'unknown error'}`;
}

module.exports = { SHELL_NOTE, models, limitsFor, windowsSandbox, id, label, CTX_LIMIT, resolve, args, parse, runFrom, missingSession, plainError, notFound, stdin: true, guardCommand, bare };

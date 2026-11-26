// Gemini CLI with a Gemini API key (Google AI Studio). Google closed sign-in with a personal Google account
// for Gemini CLI, so this provider is API key only: the user sets GEMINI_API_KEY on their computer.
//   gemini -p "" -o stream-json --skip-trust --approval-mode yolo [--resume <id>]      (the message on stdin)
// Runs use their own Gemini home in the office (.office/gemini-home, GEMINI_CLI_HOME), so the user's own
// ~/.gemini settings are never read or changed. Its settings.json (written by the office) picks API key
// sign-in, reads CLAUDE.md as the instructions file, and runs the office guard before every tool
// (BeforeTool) and before each turn (BeforeAgent: the mark that proves the guard runs).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { guardCommand } = require('./codex');

const id = 'gemini';
const label = 'Gemini (API key)';
const CTX_LIMIT = 250000; // Gemini reports the whole turn's input, like Codex

let cmdCache = null;
function resolve() {
  if (cmdCache) return cmdCache;
  cmdCache = { cmd: 'gemini', pre: [] };
  if (process.platform === 'win32') {
    const r = spawnSync('where', ['gemini'], { encoding: 'utf8', windowsHide: true });
    const found = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const first = found.find((f) => /\.(exe|cmd)$/i.test(f));
    if (first && /\.exe$/i.test(first)) cmdCache = { cmd: first, pre: [] };
    else if (first) {
      const js = path.join(path.dirname(first), 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js');
      if (fs.existsSync(js)) cmdCache = { cmd: process.execPath, pre: [js] };
    }
  }
  return cmdCache;
}

const home = (dir) => path.join(dir, '.office', 'gemini-home');
// The office's own Gemini settings (rewritten when they differ, e.g. after Node or the folder moved).
function settings(dir) {
  const hook = [{ matcher: '.*', hooks: [{ type: 'command', name: 'office-guard', command: guardCommand(dir) }] }];
  return {
    security: { auth: { selectedType: 'gemini-api-key' } },
    context: { fileName: ['CLAUDE.md'] },
    tools: { exclude: ['web_fetch', 'google_web_search', 'save_memory'] }, // like the Claude staff: no web, no memory outside the office
    hooksConfig: { enabled: true },
    hooks: { BeforeAgent: hook, BeforeTool: hook }, // BeforeAgent: the mark before the model starts (SessionStart does not run with -p)
  };
}
function prepare(dir) {
  const f = path.join(home(dir), '.gemini', 'settings.json');
  const want = JSON.stringify(settings(dir), null, 2) + '\n';
  let cur = null; try { cur = fs.readFileSync(f, 'utf8'); } catch { /* first run */ }
  if (cur !== want) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, want); }
}

// o: { sid, acc, cfg, who, dir }
function args(o) {
  prepare(o.dir);
  const { model } = require('../templates').runOpts(o.cfg, o.who);
  const dirs = [...new Set([o.dir, ...o.acc.paths])];
  return ['-p', '', '-o', 'stream-json', '--skip-trust', '--approval-mode', 'yolo',
    ...dirs.flatMap((d) => ['--include-directories', d]),
    ...(model && model !== 'default' ? ['-m', model] : []), ...(o.sid ? ['--resume', o.sid] : [])];
}
const env = (o) => ({ GEMINI_CLI_HOME: home(o.dir) });
// Gemini has no "extra system prompt" flag: the office note goes at the top of a conversation's first message.
const input = (o) => (o.sid ? o.prompt : `[Office rules for this conversation]\n${o.acc.note}${require('./codex').SHELL_NOTE}\n\n[Message]\n${o.prompt}`);

const NAMES = { run_shell_command: 'Bash', write_file: 'Write', replace: 'Edit', read_file: 'Read', read_many_files: 'Read', list_directory: 'Glob', glob: 'Glob', grep_search: 'Grep', search_file_content: 'Grep' };
// st: per-run state (the answer arrives in pieces; it is one message once a tool starts or the run ends)
function parse(j, st = {}) {
  const out = [];
  const flush = () => { const t = String(st.text || '').trim(); st.text = ''; if (t) out.push({ t: 'text', text: t }); };
  if (j.type === 'init' && j.session_id) out.push({ t: 'session', id: j.session_id }, { t: 'thinking' });
  else if (j.type === 'message' && j.role === 'assistant' && j.content) {
    if (!st.text) out.push({ t: 'reset' });
    st.text = (st.text || '') + j.content; out.push({ t: 'delta', text: j.content });
  } else if (j.type === 'tool_use') {
    flush();
    const p = j.parameters || {}, name = NAMES[j.tool_name];
    if (j.tool_name === 'update_topic') out.push({ t: 'thinking' });
    else out.push({ t: 'tool', name: name || j.tool_name, input: name === 'Bash' ? { command: p.command } : name === 'Grep' || name === 'Glob' ? { pattern: p.pattern || p.dir_path || '' } : { file_path: p.file_path || p.dir_path || (p.paths || [])[0] || '' }, guarded: true });
  } else if (j.type === 'result') {
    flush();
    const s = j.stats || {};
    if (typeof s.input_tokens === 'number') out.push({ t: 'ctx', n: s.input_tokens });
    if (j.status && j.status !== 'success') out.push({ t: 'error', text: String((j.error && j.error.message) || j.status) });
  } else if (j.type === 'error') out.push({ t: 'error', text: String(j.message || 'Gemini stopped with an error') });
  return out;
}

function runFrom(j) {
  if (!j || j.type !== 'result' || !j.stats) return null;
  const s = j.stats, cached = s.cached || 0;
  return { model: 'gemini', input: typeof s.input === 'number' ? s.input : Math.max(0, (s.input_tokens || 0) - cached), output: s.output_tokens || 0, cacheWrite: 0, cacheRead: cached, cost: 0 };
}

const missingSession = (text) => /invalid session identifier|error resuming session/i.test(text);
const notFound = 'Gemini CLI was not found. Install it with: npm i -g @google/gemini-cli, and set GEMINI_API_KEY (a key from aistudio.google.com).';

function plainError(s) {
  const t = String(s || '').trim();
  if (/quota|rate limit|resource.?exhausted|429/i.test(t)) return 'Your Gemini API limit is reached for now (the free tier has a daily limit per model). Try again later, or pick another Gemini model for this person on the Staff page.';
  if (/GEMINI_API_KEY|api key not valid|API_KEY_INVALID|must specify an auth method/i.test(t)) return 'Gemini needs an API key: get one at aistudio.google.com/apikey and set GEMINI_API_KEY on this computer, then restart the office.';
  return `Gemini stopped with an error: ${t.split('\n').filter((l) => l && !/^(Skill conflict|Warning:|Ripgrep|\s+at )/.test(l)).slice(-2).join(' ').slice(0, 400) || 'unknown error'}`;
}

module.exports = { id, label, CTX_LIMIT, resolve, args, env, input, parse, runFrom, missingSession, plainError, notFound, stdin: true, settings, home };

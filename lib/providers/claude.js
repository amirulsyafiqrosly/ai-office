// Claude Code: one run per message.
//   claude -p "<message>" --resume <session> --output-format stream-json --verbose
// Tools, folders and the office note come from chat.access(); the guard runs as a PreToolUse hook
// set in the office's .claude/settings.json.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const id = 'claude';
const label = 'Claude';
const CTX_LIMIT = 100000; // tokens per request; above this a chat starts fresh with a recap

let cmdCache = null; // resolved once: { cmd, pre: [] }
function resolve() {
  if (cmdCache) return cmdCache;
  cmdCache = { cmd: 'claude', pre: [] };
  if (process.platform === 'win32') {
    // claude.exe runs directly. An npm install gives claude.cmd: run its cli.js with node
    // instead of going through cmd.exe, so the message text is never parsed by a shell.
    const r = spawnSync('where', ['claude'], { encoding: 'utf8', windowsHide: true });
    const found = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const first = found.find((f) => /\.(exe|cmd)$/i.test(f)); // the one PATH would pick
    if (first && /\.exe$/i.test(first)) cmdCache = { cmd: first, pre: [] };
    else if (first) {
      const cli = path.join(path.dirname(first), 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      if (fs.existsSync(cli)) cmdCache = { cmd: process.execPath, pre: [cli] };
    }
  }
  return cmdCache;
}

// The arguments for one run. o: { prompt, sid, tools, acc, cfg, who, mcp, partial }
function args(o) {
  return ['-p', o.prompt, '--output-format', 'stream-json', '--verbose', ...(o.partial ? ['--include-partial-messages'] : []), '--permission-mode', 'default',
    '--tools', o.tools.join(','), '--allowedTools', o.allowed.join(','), '--disallowedTools', (o.acc.denied || []).join(','),
    ...o.acc.paths.flatMap((d) => ['--add-dir', d]), '--append-system-prompt', o.acc.note,
    ...require('../templates').runFlags(o.cfg, o.who), ...o.mcp.args, ...(o.sid ? ['--resume', o.sid] : [])];
}

// One stream-json line -> plain events the chat and task runners understand:
//   session {id}, reset, thinking, delta {text}, tool {name, input}, text {text}, ctx {n},
//   sub_start {staff, id, desc}, sub_end {id, ok}, error {text}
function parse(j) {
  const out = [];
  if (j.type === 'system' && j.subtype === 'init' && j.session_id) out.push({ t: 'session', id: j.session_id });
  else if (j.type === 'stream_event' && !j.parent_tool_use_id) {
    const e = j.event || {};
    if (e.type === 'message_start') out.push({ t: 'reset' });
    else if (e.type === 'content_block_start' && e.content_block && e.content_block.type === 'thinking') out.push({ t: 'thinking' });
    else if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') out.push({ t: 'delta', text: e.delta.text });
  } else if (j.type === 'system' && j.subtype === 'thinking_tokens') out.push({ t: 'thinking', soft: true });
  else if (j.type === 'assistant' && !j.parent_tool_use_id) {
    const u = j.message.usage; if (u) out.push({ t: 'ctx', n: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) });
    for (const c of j.message.content || []) if (c.type === 'tool_use') out.push({ t: 'tool', name: c.name, input: c.input });
    const text = (j.message.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    if (text) out.push({ t: 'text', text });
  } else if (j.type === 'system' && j.subtype === 'task_started') out.push({ t: 'sub_start', staff: j.subagent_type, id: j.task_id, desc: j.description || '' });
  else if (j.type === 'system' && j.subtype === 'task_notification') out.push({ t: 'sub_end', id: j.task_id, ok: j.status === 'completed' });
  else if (j.type === 'result' && j.is_error) out.push({ t: 'error', text: String(j.result || j.subtype || 'Claude stopped with an error') });
  return out;
}

const missingSession = (text) => /no conversation found|session.*not found/i.test(text);
const notFound = 'Claude Code was not found. Is it installed on this computer?';

function plainError(s) {
  const t = String(s || '').trim();
  if (/usage limit|rate limit|limit reached/i.test(t)) return `Your Claude usage limit is reached for now. ${t.split('\n')[0]}`;
  if (/not logged in|login|authenticate|invalid api key|oauth/i.test(t)) return 'Claude Code is not logged in. Run "claude" once in a terminal and log in, then try again.';
  return `Claude stopped with an error: ${t.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 400) || 'unknown error'}`;
}

module.exports = { id, label, CTX_LIMIT, resolve, args, parse, missingSession, plainError, notFound, stdin: false };

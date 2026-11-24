// Talks to the user's own Claude Code CLI. We never read or store any login:
// only "is it installed" and "is it logged in" (true / false).

const { spawnSync } = require('child_process');

// On Windows Claude Code may be claude.exe (native installer) or claude.cmd (npm),
// so run through the shell there. Arguments here are fixed, never user text.
function run(args, cwd) {
  const win = process.platform === 'win32';
  const opts = { cwd, encoding: 'utf8', timeout: 60000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] };
  // Windows: one command string through the shell (args are fixed words and URLs, no quoting needed)
  const r = win ? spawnSync(['claude', ...args].join(' '), { ...opts, shell: true }) : spawnSync('claude', args, opts);
  return { ok: r.status === 0 && !r.error, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function check() {
  const v = run(['--version']);
  if (!v.ok) return { installed: false, loggedIn: false };
  const s = run(['auth', 'status']);
  let loggedIn = false;
  try { loggedIn = JSON.parse(s.out).loggedIn === true; } catch { /* old CLI or not logged in */ }
  return { installed: true, version: v.out.split(/\s/)[0], loggedIn };
}

// Adds an MCP server to the office's .mcp.json (project scope).
function mcpAdd(cwd, name, url) {
  return run(['mcp', 'add', '--transport', 'http', '--scope', 'project', name, url], cwd);
}

module.exports = { check, mcpAdd };

// Which AI runs each person: Claude Code (default), Codex CLI for ChatGPT, or Gemini CLI (API key).
// office.json: "provider" on the PA and on each staff ("claude" when missing).
// Each provider module gives: resolve() -> {cmd, pre}, args(o), parse(json line) -> plain events,
// missingSession(text), plainError(text), notFound, stdin (the message goes on stdin), CTX_LIMIT.

const fs = require('fs');
const path = require('path');

const ALL = {
  claude: require('./claude'),
  codex: require('./codex'),
  gemini: require('./gemini'),
};
const LIST = [['claude', 'Claude (Claude Code)'], ['codex', 'ChatGPT (Codex CLI)'], ['gemini', 'Gemini (Gemini CLI, API key)']];

const person = (cfg, who) => (who === 'pa' ? (cfg && cfg.pa) || {} : ((cfg && cfg.staff) || []).find((s) => s.id === who) || {});
const providerId = (cfg, who) => (ALL[person(cfg, who).provider] ? person(cfg, who).provider : 'claude');
const providerFor = (cfg, who) => ALL[providerId(cfg, who)];

// Marker the guard leaves for a run (see office-files/guard.js): proof that the hook really runs.
const markFile = (dir, run) => path.join(dir, '.office', 'runs', `${run}.guard`);
const newRun = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
function clearMark(dir, run) { try { fs.unlinkSync(markFile(dir, run)); } catch { /* none */ } }

// Is this provider's CLI on the computer? (looked up at most once a minute)
const seen = {};
function installed(id) {
  const c = seen[id]; if (c && Date.now() - c.at < 60000) return c.ok;
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [id], { encoding: 'utf8', windowsHide: true });
  seen[id] = { at: Date.now(), ok: r.status === 0 && !!String(r.stdout || '').trim() };
  return seen[id].ok;
}

module.exports = { ALL, LIST, providerId, providerFor, markFile, newRun, clearMark, installed };

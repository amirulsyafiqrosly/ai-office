// Builds the office config from the wizard answers and writes the office folder.
// Never overwrites a file that already exists.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const D = require('./defaults');
const T = require('./templates');

const RESERVED = new Set(['claude', 'explore', 'general-purpose', 'plan', 'statusline-setup', 'web-fetch', 'hana', 'pa']);

function slug(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'staff';
}

// answers: { company, pa, staff: [{ name, role, job }], invois }
function buildConfig(answers) {
  const used = new Set([slug(answers.pa || D.PA.name)]);
  const staff = answers.staff.map((a, i) => {
    let id = slug(a.name);
    if (RESERVED.has(id)) id += '-staff';
    let n = 2; const base = id;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    const def = D.STAFF.find((d) => d.name === a.name && d.role === a.role);
    return {
      id, name: a.name, role: a.role, job: a.job,
      colour: (D.STAFF[i] || D.STAFF[i % D.STAFF.length]).colour,
      rules: def ? def.rules : D.GENERIC_RULES,
    };
  });
  const addons = {};
  if (answers.invois) {
    addons[D.INVOIS.id] = {
      enabled: true, mcp: D.INVOIS.id, url: D.INVOIS.url,
      staff: staff.filter((s) => D.INVOIS.roles.some((r) => r.match.test(s.role))).map((s) => s.id),
      tipShown: false,
    };
  }
  return {
    company: answers.company,
    pa: { name: answers.pa || D.PA.name, colour: D.PA.colour },
    staff, addons,
    port: D.PORT,
    key: crypto.randomBytes(16).toString('hex'),
    created: new Date().toISOString(),
  };
}

// Is this folder already an office?
const isOffice = (dir) => fs.existsSync(path.join(dir, 'office.json'));

function writeOffice(dir, cfg, opts = {}) {
  const nodePath = opts.nodePath || process.execPath;
  const hookPath = path.join(dir, '.office', 'hook.js');
  const written = [], skipped = [];
  const put = (rel, text) => {
    const f = path.join(dir, rel);
    if (fs.existsSync(f)) { skipped.push(rel); return; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
    written.push(rel);
  };
  const settings = T.settingsJson(nodePath, hookPath);

  put('office.json', T.officeJson(cfg));
  put('CLAUDE.md', T.paClaude(cfg));
  put('OFFICE.md', T.officeMd(cfg));
  put('.gitignore', T.gitignore());
  put('.claude/settings.json', settings);
  put('.office/hook.js', fs.readFileSync(path.join(__dirname, '..', 'office-files', 'hook.js'), 'utf8'));
  put('.office/staff-chats.md', T.staffChatsMd(cfg));
  for (const s of cfg.staff) {
    put(`staff/${s.id}/CLAUDE.md`, T.staffClaude(cfg, s));
    put(`staff/${s.id}/.claude/settings.json`, settings);
    put(`.claude/agents/${s.id}.md`, T.agentMd(cfg, s));
  }
  for (const sk of T.skills()) put(`.claude/skills/${sk.name}/SKILL.md`, sk.text);
  for (const d of ['inbox', 'approvals', 'projects']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  return { written, skipped };
}

// Hooks hold absolute paths (Node and the office folder). If Node moved or the
// folder was moved, rewrite them. Called each time the office starts.
function repairHooks(dir, nodePath = process.execPath) {
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'office.json'), 'utf8'));
  const want = T.settingsJson(nodePath, path.join(dir, '.office', 'hook.js'));
  const files = ['.claude/settings.json', ...cfg.staff.map((s) => `staff/${s.id}/.claude/settings.json`)];
  const fixed = [];
  for (const rel of files) {
    const f = path.join(dir, rel);
    let cur = null;
    try { cur = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* missing or broken */ }
    const next = JSON.parse(want);
    // keep everything the user added (other settings, their own hooks); only ours are replaced
    const ours = (e) => (e.hooks || []).some((h) => /[\\/]\.office[\\/]hook\.js"?$/.test(h.command || ''));
    const hooks = { ...((cur && cur.hooks) || {}) };
    for (const ev of Object.keys(next.hooks)) hooks[ev] = [...(hooks[ev] || []).filter((e) => !ours(e)), ...next.hooks[ev]];
    const merged = { ...(cur || {}), hooks };
    if (cur && JSON.stringify(merged) === JSON.stringify(cur)) continue; // already right
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(merged, null, 2) + '\n');
    fixed.push(rel);
  }
  return fixed;
}

module.exports = { slug, buildConfig, writeOffice, isOffice, repairHooks };

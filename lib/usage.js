// Plan limits and token use, from what every dashboard run reports. Claude Code gives limits and cost;
// ChatGPT (Codex) runs give tokens, and their plan limits come from Codex's own session log (providers/codex.js).
//
//   rate_limit_event  -> the account's 5-hour and weekly limits (% used, when they reset)
//   result            -> this run's tokens and its cost at API prices. For a resumed conversation Claude Code
//                        reports the conversation's running total, so the cost of the run is the difference
//                        from the last total seen for that session (.office/usage-sessions.json).
//
// Saved in the office folder: .office/usage-limits.json (latest limits) and
// .office/usage.jsonl (one line per run). Nothing leaves the computer.

const fs = require('fs');
const path = require('path');

const DAY = 24 * 60 * 60 * 1000;

// Plain numbers from a rate_limit_event: { five_hour: { used, resets, status }, seven_day: {...} }
function limitsFrom(info) {
  if (!info || typeof info !== 'object') return null;
  const out = {};
  const put = (name, w) => {
    if (!w || typeof w.utilization !== 'number') return;
    out[name] = { used: Math.round(w.utilization * 100), resets: w.resetsAt ? new Date(w.resetsAt * 1000).toISOString() : null, status: w.status || '' };
  };
  for (const [name, w] of Object.entries(info.unifiedWindows || {})) put(name, w);
  if (!Object.keys(out).length && info.rateLimitType) put(info.rateLimitType, info);
  return Object.keys(out).length ? out : null;
}

// One run's tokens and cost from a result message.
function runFrom(j) {
  const u = j && j.usage; if (!u) return null;
  const model = Object.keys(j.modelUsage || {})[0] || '';
  return {
    model, input: u.input_tokens || 0, output: u.output_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0,
    cost: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : 0,
  };
}

class Usage {
  constructor(dir, onChange) {
    this.dir = dir;
    this.limitsFile = path.join(dir, '.office', 'usage-limits.json');
    this.logFile = path.join(dir, '.office', 'usage.jsonl');
    this.sessFile = path.join(dir, '.office', 'usage-sessions.json');
    this.onChange = onChange || (() => {});
    this.threads = new Map(); // "who|kind|id" -> Codex thread of the run in progress
  }
  // Plan limits per AI: Claude in usage-limits.json (as before), ChatGPT in usage-limits-codex.json.
  limitsFileOf(provider) { return provider === 'claude' ? this.limitsFile : path.join(this.dir, '.office', `usage-limits-${provider}.json`); }

  // Look at one stream-json line from a run by `who` (pa or a staff id); kind: chat or task.
  // provider: which AI made the line (lib/providers). Others than Claude give tokens only: no cost, no plan limits.
  see(j, who, kind, id, provider = 'claude') {
    if (!j || typeof j !== 'object') return;
    if (provider !== 'claude') {
      const p = require('./providers').ALL[provider];
      const key = `${who}|${kind}|${id || ''}`;
      if (j.type === 'thread.started' && j.thread_id) { this.threads.set(key, j.thread_id); return; } // Codex: for its plan limits below
      const r = p && p.runFrom && p.runFrom(j); if (!r) return;
      try { fs.appendFileSync(this.logFile, JSON.stringify({ at: new Date().toISOString(), who, kind, id: id || '', provider, ...r }) + '\n'); } catch { return; }
      const l = p.limitsFor && p.limitsFor(this.threads.get(key));
      if (l) { try { fs.writeFileSync(this.limitsFileOf(provider), JSON.stringify({ at: new Date().toISOString(), ...l }, null, 2)); } catch { /* shown next time */ } }
      return this.onChange();
    }
    if (j.type === 'rate_limit_event') {
      const l = limitsFrom(j.rate_limit_info); if (!l) return;
      try { fs.writeFileSync(this.limitsFile, JSON.stringify({ at: new Date().toISOString(), ...l }, null, 2)); } catch { return; }
      this.onChange();
    } else if (j.type === 'result') {
      const r = runFrom(j); if (!r) return;
      if (j.session_id) { // a running total per conversation: keep only this run's part
        let s = {}; try { s = JSON.parse(fs.readFileSync(this.sessFile, 'utf8')); } catch { /* first */ }
        const total = r.cost, before = s[j.session_id] || 0;
        r.cost = total >= before ? total - before : total; // smaller: a new count started
        s[j.session_id] = total;
        try { fs.writeFileSync(this.sessFile, JSON.stringify(s)); } catch { /* not saved: next run may count double */ }
      }
      try { fs.appendFileSync(this.logFile, JSON.stringify({ at: new Date().toISOString(), who, kind, id: id || '', ...r }) + '\n'); } catch { return; }
      this.onChange();
    }
  }

  limits(provider = 'claude') { try { return JSON.parse(fs.readFileSync(this.limitsFileOf(provider), 'utf8')); } catch { return null; } }

  runs(since) {
    let lines = [];
    try { lines = fs.readFileSync(this.logFile, 'utf8').trim().split('\n'); } catch { return []; }
    const out = [];
    for (const l of lines) { try { const r = JSON.parse(l); if (Date.parse(r.at) >= since) out.push(r); } catch { /* skip */ } }
    return out;
  }

  // Limits plus totals for today and the last 7 days, per person.
  summary(now = Date.now()) {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const week = this.runs(now - 7 * DAY);
    const sum = (rows) => {
      const t = { runs: 0, tokens: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, people: {} };
      for (const r of rows) {
        const n = r.input + r.output + r.cacheWrite + r.cacheRead;
        t.runs++; t.tokens += n; t.input += r.input; t.output += r.output; t.cacheWrite += r.cacheWrite; t.cacheRead += r.cacheRead; t.cost += r.cost;
        const p = t.people[r.who] || (t.people[r.who] = { runs: 0, tokens: 0, cost: 0, priced: 0 });
        p.runs++; p.tokens += n; p.cost += r.cost;
        if (!r.provider || r.provider === 'claude') { p.priced++; t.priced = (t.priced || 0) + 1; } // ChatGPT runs: tokens only, no cost
      }
      return t;
    };
    return { limits: this.limits(), limitsBy: { codex: this.limits('codex') }, today: sum(week.filter((r) => Date.parse(r.at) >= start.getTime())), week: sum(week) };
  }
}

module.exports = { Usage, limitsFrom, runFrom };

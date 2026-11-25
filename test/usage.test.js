// Usage tests: plan limits from a rate_limit_event, tokens per run from a result, totals per person.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Usage, limitsFrom } = require('../lib/usage');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-office-usage-'));
fs.mkdirSync(path.join(dir, '.office'));
let changed = 0;
const u = new Usage(dir, () => changed++);

// 1. limits: both windows, percent and reset time
u.see({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 0.91, resetsAt: 1795589400,
  unifiedWindows: { five_hour: { utilization: 0.91, resetsAt: 1795589400, status: 'allowed_warning' }, seven_day: { utilization: 0.22, resetsAt: 1795809600, status: 'allowed' } } } }, 'pa', 'chat');
const l = u.limits();
assert.strictEqual(l.five_hour.used, 91); assert.strictEqual(l.seven_day.used, 22);
assert.strictEqual(l.five_hour.resets, new Date(1795589400 * 1000).toISOString());
assert.strictEqual(l.five_hour.status, 'allowed_warning');
// an older event shape with only one window still works
assert.strictEqual(limitsFrom({ rateLimitType: 'five_hour', utilization: 0.5, resetsAt: 1 }).five_hour.used, 50);
assert.strictEqual(limitsFrom({}), null);

// 2. runs: tokens and cost, per person, today and week
const result = (tok, cost) => ({ type: 'result', usage: { input_tokens: tok, output_tokens: tok, cache_creation_input_tokens: tok, cache_read_input_tokens: tok }, total_cost_usd: cost, modelUsage: { 'claude-x': {} } });
u.see(result(100, 0.5), 'pa', 'chat');
u.see(result(50, 0.25), 'siti', 'task', 't1');
u.see(result(50, 0.25), 'siti', 'task', 't2');
u.see({ type: 'assistant', message: { content: [] } }, 'pa', 'chat'); // ignored
const s = u.summary();
assert.strictEqual(s.today.runs, 3); assert.strictEqual(s.today.tokens, 800);
assert.strictEqual(s.today.people.siti.tokens, 400); assert.strictEqual(s.today.people.siti.runs, 2);
assert.ok(Math.abs(s.week.cost - 1) < 1e-9);
assert.strictEqual(s.limits.five_hour.used, 91);
assert.strictEqual(changed, 4);
// runs older than 7 days drop out
fs.appendFileSync(path.join(dir, '.office', 'usage.jsonl'), JSON.stringify({ at: new Date(Date.now() - 9 * 864e5).toISOString(), who: 'pa', input: 9, output: 0, cacheWrite: 0, cacheRead: 0, cost: 9 }) + '\n');
assert.strictEqual(u.summary().week.runs, 3);

fs.rmSync(dir, { recursive: true, force: true });
console.log('ok usage: limits, runs, totals\n\n1 usage test passed');

// Spike hook: append the raw hook input (stdin JSON) to .office/hook-log.jsonl
const fs = require('fs'), path = require('path');
let s = ''; process.stdin.on('data', d => s += d).on('end', () => {
  const dir = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.office');
  fs.mkdirSync(dir, { recursive: true });
  let j; try { j = JSON.parse(s); } catch { j = { raw: s }; }
  fs.appendFileSync(path.join(dir, 'hook-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), argv: process.argv.slice(2), ...j }) + '\n');
});

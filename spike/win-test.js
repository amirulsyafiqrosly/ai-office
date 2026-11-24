// Spike test 2 on Windows: Node spawns claude, reads stream-json, then resumes the session.
const { spawn, execSync } = require('child_process'), path = require('path'), fs = require('fs');
const office = path.resolve(process.argv[2]);
const TOOLS = 'Agent,Read,Write,Edit,Glob,Grep';
const where = (() => { try { return execSync('where claude', { encoding: 'utf8' }).trim().split(/\r?\n/); } catch { return []; } })();
console.log('where claude:', where);
function run(prompt, resume) {
  return new Promise(res => {
    const args = ['-p', prompt, '--model', 'haiku', '--permission-mode', 'default', '--tools', TOOLS, '--allowedTools', TOOLS,
      '--output-format', 'stream-json', '--verbose', ...(resume ? ['--resume', resume] : [])];
    const t0 = Date.now(), ch = spawn('claude', args, { cwd: office, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let buf = '', sid = null, results = [], kinds = {};
    ch.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l) continue;
      try { const j = JSON.parse(l); const k = j.type + (j.subtype ? '/' + j.subtype : ''); kinds[k] = (kinds[k] || 0) + 1; if (j.session_id) sid = j.session_id; if (j.type === 'result') results.push(j.result); } catch { console.log('non-json:', l.slice(0, 120)); } } });
    let err = ''; ch.stderr.on('data', d => err += d);
    ch.on('error', e => { console.log('spawn error:', e.message); res(null); });
    ch.on('close', code => { console.log({ code, ms: Date.now() - t0, sid, kinds, stderr: err.slice(0, 200) }); results.forEach((r, n) => console.log(`result ${n + 1}:`, (r || '').slice(0, 220).replace(/\n/g, ' '))); res(sid); });
  });
}
(async () => {
  const sid = await run('Ask Siti to write a 1-line quote for 3 bags at RM40 into staff/siti/bags.txt. Reply in one line.');
  if (sid) await run('What was the total of that quote? One line.', sid);
  const log = path.join(office, '.office', 'hook-log.jsonl');
  const L = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [];
  const ev = {}; L.forEach(j => ev[j.hook_event_name] = (ev[j.hook_event_name] || 0) + 1);
  console.log('hook events:', ev, '\nSubagentStart:', JSON.stringify(L.find(j => j.hook_event_name === 'SubagentStart') || null));
  console.log('bags.txt:', fs.existsSync(path.join(office, 'staff/siti/bags.txt')) ? fs.readFileSync(path.join(office, 'staff/siti/bags.txt'), 'utf8').trim() : 'MISSING');
})();

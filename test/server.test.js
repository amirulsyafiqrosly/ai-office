// Office server + API tests against a temporary office. Run: npm test
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const G = require('../lib/generate');
const D = require('../lib/defaults');
const { createServer } = require('../lib/server');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-office-srv-'));
const dir = path.join(tmp, 'office');
const cfg = G.buildConfig({ company: 'Kedai Ali', pa: 'Hana', staff: D.STAFF.slice(0, 3).map(({ name, role, job }) => ({ name, role, job })) });
G.writeOffice(dir, cfg);
const read = (...p) => fs.readFileSync(path.join(dir, ...p), 'utf8');

let port;
function req(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: url, headers: { host: `localhost:${port}`, 'x-office-key': cfg.key, ...headers } }, (res) => {
      let s = ''; res.on('data', (d) => { s += d; });
      res.on('end', () => { let j = s; try { j = JSON.parse(s); } catch { /* html */ } resolve({ status: res.statusCode, body: j }); });
    });
    r.on('error', reject);
    if (body) r.end(JSON.stringify(body)); else r.end();
  });
}

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log(`ok ${n} ${name}`); };

(async () => {
  const srv = createServer(dir);
  port = await srv.listen(0);
  try {
    await test('page has the key; API needs it; wrong host and origin are refused', async () => {
      const page = await req('GET', '/', null, { 'x-office-key': '' });
      assert.strictEqual(page.status, 200); assert.ok(page.body.includes(cfg.key));
      assert.strictEqual((await req('GET', '/api/office', null, { 'x-office-key': 'nope' })).status, 401);
      assert.strictEqual((await req('GET', '/api/office', null, { host: 'evil.example:80' })).status, 421);
      assert.strictEqual((await req('POST', '/api/inbox', { from: 'x', text: 'y' }, { origin: 'https://evil.example' })).status, 403);
      const o = await req('GET', '/api/office');
      assert.strictEqual(o.status, 200); assert.strictEqual(o.body.company, 'Kedai Ali'); assert.ok(!('key' in o.body));
      assert.strictEqual((await req('GET', '/../office.json')).status, 404);
      assert.strictEqual((await req('GET', '/api/staff/..%2F..%2Fx')).status, 400);
    });

    await test('edit staff: CLAUDE.md sections, agent description and team table follow', async () => {
      const r = await req('PUT', '/api/staff/siti', { name: 'Siti Aisyah', role: 'Sales Lead', job: 'Quotes and follow ups.', rules: ['Reply fast', '', 'No discounts'], colour: '#3A86FF' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      const t = read('staff/siti/CLAUDE.md');
      assert.match(t, /^# Siti Aisyah, Sales Lead$/m); assert.match(t, /You are \*\*Siti Aisyah\*\*, the Sales Lead staff/);
      assert.match(t, /## Rules\n\n- Reply fast\n- No discounts\n/); assert.match(t, /## Tools/);
      assert.match(read('.claude/agents/siti.md'), /^description: Siti Aisyah, Sales Lead\. Quotes and follow ups\./m);
      assert.match(read('CLAUDE.md'), /\| siti \| Siti Aisyah \| Sales Lead \| Quotes and follow ups\. \|/);
      assert.strictEqual(JSON.parse(read('office.json')).staff.find((s) => s.id === 'siti').colour, '#3A86FF');
    });

    await test('add, archive, reactivate, delete staff', async () => {
      const a = await req('POST', '/api/staff', { name: 'Farah', role: 'Marketing', job: 'Posts and promos' });
      assert.strictEqual(a.status, 200, JSON.stringify(a.body));
      assert.ok(fs.existsSync(path.join(dir, '.claude/agents/farah.md')));
      assert.ok(fs.existsSync(path.join(dir, 'staff/farah/.claude/settings.json')));
      assert.match(read('CLAUDE.md'), /\| farah \| Farah \| Marketing \|/);
      assert.strictEqual((await req('POST', '/api/staff/farah/archive')).status, 200);
      assert.ok(fs.existsSync(path.join(dir, '.archive/staff/farah/CLAUDE.md')));
      assert.doesNotMatch(read('CLAUDE.md'), /\| farah \|/);
      assert.strictEqual((await req('POST', '/api/staff/farah/delete', { confirm: 'yes' })).status, 400);
      assert.strictEqual((await req('POST', '/api/staff/farah/reactivate')).status, 200);
      assert.ok(fs.existsSync(path.join(dir, 'staff/farah/CLAUDE.md')));
      await req('POST', '/api/staff/farah/archive');
      assert.strictEqual((await req('POST', '/api/staff/farah/delete', { confirm: 'DELETE' })).status, 200);
      assert.ok(!fs.existsSync(path.join(dir, '.archive/staff/farah')));
    });

    await test('projects: create, update header, add note', async () => {
      const p = await req('POST', '/api/projects', { title: 'Kedai Ali website', customer: 'Kedai Ali', deadline: '2026-12-01', what: 'Shop site' });
      assert.strictEqual(p.body.id, 'kedai-ali-website');
      const u = await req('PUT', '/api/projects/kedai-ali-website', { status: 'waiting' });
      assert.strictEqual(u.body.status, 'waiting'); assert.strictEqual(u.body.deadline, '2026-12-01');
      const nn = await req('POST', '/api/projects/kedai-ali-website/notes', { note: 'Budget RM3,000' });
      assert.strictEqual(nn.body.notes.length, 1); assert.match(nn.body.notes[0], /^Budget RM3,000 \(boss, \d{4}-\d{2}-\d{2}\)$/);
      // a project Claude wrote by hand, without a header, still lists
      fs.mkdirSync(path.join(dir, 'projects/syarikat-jaya')); fs.writeFileSync(path.join(dir, 'projects/syarikat-jaya/CLAUDE.md'), '# Syarikat Jaya shirts\n\nNotes go here.\n');
      const all = await req('GET', '/api/projects');
      assert.deepStrictEqual(all.body.map((x) => x.title).sort(), ['Kedai Ali website', 'Syarikat Jaya shirts']);
    });

    await test('inbox: add, tickets for hand-written items, assign', async () => {
      const a = await req('POST', '/api/inbox', { from: 'Puan Rosnah', source: 'whatsapp', type: 'order', text: '30 kotak nasi lemak' });
      assert.strictEqual(a.body.ticket, '101'); assert.strictEqual(a.body.status, 'new');
      fs.writeFileSync(path.join(dir, 'inbox/20261124-090000-ali.md'), '---\nfrom: Ali\nsource: email\ntype: enquiry  # comment\nstatus: new\nreceived: 2026-11-24T09:00:00+08:00\nassigned:\n---\nPrice?\n');
      const list = await req('GET', '/api/inbox');
      const ali = list.body.find((x) => x.from === 'Ali');
      assert.strictEqual(ali.ticket, '102'); assert.strictEqual(ali.type, 'enquiry');
      assert.match(read('inbox/20261124-090000-ali.md'), /^ticket: 102$/m);
      const u = await req('PUT', `/api/inbox/${ali.id}`, { assigned: 'aina', status: 'working' });
      assert.strictEqual(u.body.assigned, 'aina');
      assert.strictEqual((await req('PUT', `/api/inbox/${ali.id}`, { assigned: 'nobody' })).status, 400);
    });

    await test('approvals: ask, decide once, event logged', async () => {
      const a = await req('POST', '/api/approvals', { from: 'siti', action: 'Give 10% discount to Kedai Ali', details: 'RM125 off', project: 'kedai-ali-website' });
      assert.strictEqual(a.body.status, 'pending');
      const d = await req('POST', `/api/approvals/${a.body.id}/decide`, { decision: 'approved', note: 'OK this once' });
      assert.strictEqual(d.body.status, 'approved'); assert.ok(d.body.decided);
      assert.match(read(`approvals/${a.body.id}.md`), /Boss: OK this once/);
      assert.strictEqual((await req('POST', `/api/approvals/${a.body.id}/decide`, { decision: 'rejected' })).status, 409);
      const ev = read('.office/events.jsonl').trim().split('\n').map(JSON.parse).pop();
      assert.strictEqual(ev.ev, 'Approval'); assert.match(ev.msg, /approved/);
    });

    await test('clean up: needs CLEAR, clears only what was picked, never the staff setup', async () => {
      fs.writeFileSync(path.join(dir, 'staff/siti/quote.md'), 'x');
      fs.appendFileSync(path.join(dir, '.office/events.jsonl'), '{"ev":"Stop"}\n');
      assert.strictEqual((await req('POST', '/api/cleanup', { items: ['inbox'], confirm: 'yes' })).status, 400);
      const r = await req('POST', '/api/cleanup', { items: ['activity', 'inbox', 'staffFiles', 'nonsense'], confirm: 'CLEAR' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(fs.readdirSync(path.join(dir, 'inbox')).length, 0);
      assert.strictEqual(read('.office/events.jsonl'), '');
      assert.ok(!fs.existsSync(path.join(dir, 'staff/siti/quote.md')));
      assert.ok(fs.existsSync(path.join(dir, 'staff/siti/CLAUDE.md')) && fs.existsSync(path.join(dir, 'staff/siti/.claude/settings.json')));
      assert.ok(fs.readdirSync(path.join(dir, 'approvals')).length > 0, 'approvals not picked, so kept');
      assert.ok(fs.existsSync(path.join(dir, 'office.json')) && fs.existsSync(path.join(dir, '.claude/agents/siti.md')));
    });

    await test('linked folders: checked, saved, put in the terminal settings, removed again', async () => {
      const ext = path.join(tmp, 'shop website'); fs.mkdirSync(ext);
      assert.match((await req('POST', '/api/linked', { path: 'relative/dir' })).body.error, /full folder path/);
      assert.match((await req('POST', '/api/linked', { path: path.join(tmp, 'nope') })).body.error, /does not exist/);
      assert.match((await req('POST', '/api/linked', { path: os.homedir() })).body.error, /too wide/);
      assert.match((await req('POST', '/api/linked', { path: tmp })).body.error, /contains the office/);
      const r = await req('POST', '/api/linked', { path: ext, label: 'Website' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.deepStrictEqual(r.body.map((l) => [l.label, l.ok]), [['Website', true]]);
      const T = require('../lib/templates');
      const allow = () => JSON.parse(read('staff/siti/.claude/settings.json')).permissions.allow;
      assert.ok(T.officeRules(ext).every((x) => allow().includes(x)), 'staff terminal settings allow the linked folder');
      // a project's own linked folder
      const pr = await req('PUT', '/api/projects/kedai-ali-website', { linked: ext });
      assert.strictEqual(pr.body.linked, ext);
      await req('PUT', '/api/projects/kedai-ali-website', { linked: '' });
      const after = await req('POST', '/api/linked/remove', { path: ext });
      assert.deepStrictEqual(after.body, []);
      assert.ok(!T.officeRules(ext).some((x) => allow().includes(x)), 'unlinked folder rules are gone');
      assert.ok(T.officeRules(dir).every((x) => allow().includes(x)), 'office rules stay');
    });

    await test('live stream says what changed', async () => {
      await new Promise((r) => setTimeout(r, 400)); // let earlier changes settle
      const got = await new Promise((resolve, reject) => {
        let t1, t2;
        const done = (fn, v) => { clearTimeout(t1); clearTimeout(t2); r.destroy(); fn(v); };
        const r = http.get({ host: '127.0.0.1', port, path: `/api/stream?key=${cfg.key}`, headers: { host: `localhost:${port}` } }, (res) => {
          let s = '';
          res.on('data', (d) => { s += d; const m = /event: changed\ndata: (.*)\n/.exec(s); if (m && JSON.parse(m[1]).includes('approvals')) done(resolve, JSON.parse(m[1])); });
          t1 = setTimeout(() => fs.writeFileSync(path.join(dir, 'approvals/x.md'), '---\nfrom: nurul\naction: Send invoice\nstatus: pending\n---\n'), 200);
        });
        r.on('error', () => {});
        t2 = setTimeout(() => done(reject, new Error('no change event')), 5000);
      });
      assert.ok(got.includes('approvals'));
    });
  } finally {
    await srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\n${n} server tests passed`);
})().catch((e) => { console.error(e); process.exit(1); });

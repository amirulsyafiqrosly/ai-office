// The office server: serves the dashboard and a small local API over the office files.
// Listens on 127.0.0.1 only. Every API call needs the office key (from office.json).

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const O = require('./office');

const DASH = path.join(__dirname, '..', 'dashboard');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };

function createServer(dir) {
  const cfg = O.loadCfg(dir);
  const key = String(cfg.key || '');
  let port = 0; // set once listening
  const clients = new Set();

  const sameKey = (k) => typeof k === 'string' && k.length === key.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(key));
  const hostOk = (req) => [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`].includes(String(req.headers.host || '').toLowerCase());
  const originOk = (req) => !req.headers.origin || [`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(req.headers.origin);

  const send = (res, status, body, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (d) => { s += d; if (s.length > 1e6) { reject(new O.OfficeError('Too big', 413)); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new O.OfficeError('Body must be JSON')); } });
  });

  // ---- API routes: [method, pattern, handler(params, body)]
  const R = [
    ['GET', /^\/api\/office$/, () => O.info(dir)],
    ['GET', /^\/api\/staff$/, () => O.listStaff(dir)],
    ['POST', /^\/api\/staff$/, (m, b) => O.addStaff(dir, b)],
    ['GET', /^\/api\/staff\/([^/]+)$/, (m) => O.getStaff(dir, m[1])],
    ['PUT', /^\/api\/staff\/([^/]+)$/, (m, b) => O.updateStaff(dir, m[1], b)],
    ['POST', /^\/api\/staff\/([^/]+)\/archive$/, (m) => O.archiveStaff(dir, m[1])],
    ['POST', /^\/api\/staff\/([^/]+)\/reactivate$/, (m) => O.reactivateStaff(dir, m[1])],
    ['POST', /^\/api\/staff\/([^/]+)\/delete$/, (m, b) => O.deleteStaff(dir, m[1], b.confirm)],
    ['GET', /^\/api\/projects$/, () => O.listProjects(dir)],
    ['POST', /^\/api\/projects$/, (m, b) => O.createProject(dir, b)],
    ['GET', /^\/api\/projects\/([^/]+)$/, (m) => O.getProject(dir, m[1])],
    ['PUT', /^\/api\/projects\/([^/]+)$/, (m, b) => O.updateProject(dir, m[1], b)],
    ['POST', /^\/api\/projects\/([^/]+)\/notes$/, (m, b) => O.addProjectNote(dir, m[1], b.note)],
    ['GET', /^\/api\/inbox$/, () => O.listInbox(dir)],
    ['POST', /^\/api\/inbox$/, (m, b) => O.addInbox(dir, b)],
    ['PUT', /^\/api\/inbox\/([^/]+)$/, (m, b) => O.updateInbox(dir, m[1], b)],
    ['GET', /^\/api\/approvals$/, () => O.listApprovals(dir)],
    ['POST', /^\/api\/approvals$/, (m, b) => O.addApproval(dir, b)],
    ['GET', /^\/api\/approvals\/([^/]+)$/, (m) => O.getApproval(dir, m[1])],
    ['POST', /^\/api\/approvals\/([^/]+)\/decide$/, (m, b) => O.decideApproval(dir, m[1], b.decision, b.note)],
    ['POST', /^\/api\/events$/, (m, b) => O.addEvent(dir, b)],
  ];

  const server = http.createServer(async (req, res) => {
    try {
      if (!hostOk(req)) return send(res, 421, { error: 'Wrong host' });
      const url = new URL(req.url, `http://${req.headers.host}`);
      const route = url.pathname;

      if (route === '/api/ping') return send(res, 200, { app: 'ai-office' });
      if (route.startsWith('/api/')) {
        if (!originOk(req)) return send(res, 403, { error: 'Wrong origin' });
        if (!sameKey(req.headers['x-office-key'] || (route === '/api/stream' ? url.searchParams.get('key') : ''))) {
          return send(res, 401, { error: 'Office key missing or wrong. It is the "key" in office.json.' });
        }
        if (route === '/api/stream' && req.method === 'GET') return stream(req, res);
        for (const [method, re, fn] of R) {
          const m = re.exec(route);
          if (m && req.method === method) {
            const body = ['POST', 'PUT'].includes(method) ? await readBody(req) : {};
            return send(res, 200, await fn(m.map((x) => (x ? decodeURIComponent(x) : x)), body));
          }
        }
        return send(res, 404, { error: 'No such API call' });
      }
      return serveStatic(route, res);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      return send(res, status, { error: status === 500 ? 'Something went wrong on the office server' : e.message });
    }
  });

  function serveStatic(route, res) {
    const rel = route === '/' ? 'index.html' : decodeURIComponent(route).replace(/^\/+/, '');
    const f = path.resolve(DASH, rel);
    if (!f.startsWith(DASH + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return send(res, 404, 'Not found', 'text/plain');
    let body = fs.readFileSync(f);
    if (rel === 'index.html') body = body.toString('utf8').replace('%%OFFICE_KEY%%', key); // same-origin page only
    return send(res, 200, body, TYPES[path.extname(f)] || 'application/octet-stream');
  }

  // ---- live refresh: tell open pages which part of the office changed
  function stream(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
  }
  const pending = new Set(); let timer = null;
  function changed(area) {
    pending.add(area);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const msg = `event: changed\ndata: ${JSON.stringify([...pending])}\n\n`;
      pending.clear();
      for (const c of clients) c.write(msg);
    }, 150);
  }
  const areaOf = (rel) => {
    const [top, sub] = rel.split(/[\\/]/);
    if (rel.endsWith('.tmp')) return null;
    if (top === 'office.json') return 'office';
    if (['inbox', 'approvals', 'projects', 'staff'].includes(top)) return top;
    if (top === '.office' && sub === 'events.jsonl') return 'events';
    if (top === 'CLAUDE.md' || top === '.archive') return 'staff';
    return null;
  };
  let watcher = null, poll = null;
  function watch() {
    try {
      watcher = fs.watch(dir, { recursive: true }, (ev, name) => { const a = name && areaOf(String(name)); if (a) changed(a); });
    } catch { // older Node on Linux: no recursive watch, so check file times every 1.5 s
      const seen = new Map();
      const scan = () => {
        for (const top of ['office.json', 'inbox', 'approvals', 'projects', 'staff', '.office/events.jsonl']) {
          let sig = '';
          const walk = (f, depth) => { try { const st = fs.statSync(f); sig += st.mtimeMs; if (st.isDirectory() && depth < 3) for (const n of fs.readdirSync(f)) walk(path.join(f, n), depth + 1); } catch { /* gone */ } };
          walk(path.join(dir, top), 0);
          if (seen.has(top) && seen.get(top) !== sig) changed(areaOf(top));
          seen.set(top, sig);
        }
      };
      scan(); poll = setInterval(scan, 1500);
    }
  }
  const beat = setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000);

  return {
    server,
    listen(p) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(p, '127.0.0.1', () => { port = server.address().port; watch(); resolve(port); });
      });
    },
    close() {
      clearInterval(beat); clearInterval(poll); if (watcher) watcher.close();
      for (const c of clients) c.end();
      return new Promise((r) => server.close(r));
    },
  };
}

// Start on the office port, or the next free one. If this office is already running there, reuse it.
async function start(dir, { port } = {}) {
  const cfg = O.loadCfg(dir);
  const first = port || cfg.port || 4747;
  for (let p = first; p < first + 20; p++) {
    if (await isThisOffice(p, cfg.key, dir)) return { port: p, already: true };
    const s = createServer(dir);
    try { const got = await s.listen(p); return { port: got, already: false, close: s.close }; } catch (e) { if (e.code !== 'EADDRINUSE') throw e; }
  }
  throw new Error(`No free port between ${first} and ${first + 19}`);
}

function isThisOffice(port, key, dir) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/office', headers: { 'x-office-key': key, host: `localhost:${port}` }, timeout: 800 }, (res) => {
      let s = ''; res.on('data', (d) => { s += d; });
      res.on('end', () => { try { resolve(res.statusCode === 200 && path.resolve(JSON.parse(s).folder) === path.resolve(dir)); } catch { resolve(false); } });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

module.exports = { createServer, start };

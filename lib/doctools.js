// Office document tools: PowerPoint, Excel, Word, PDF and PNG for the staff (see office-files/doc-tools).
// On every start the helper and its README are copied into <office>/.office/doc-tools; the libraries are
// installed there once, in the background, with the npm that comes with this Node. Nothing to set up.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PKGS = ['pptxgenjs@3', 'exceljs@4', 'docx@9', '@resvg/resvg-js@2'];
const SRC = path.join(__dirname, '..', 'office-files', 'doc-tools');
const root = (dir) => path.join(dir, '.office', 'doc-tools');
const names = PKGS.map((p) => p.replace(/@[^@/]*$/, ''));

const jobs = new Map(); // office dir -> { state, error }

function status(dir) {
  const r = root(dir);
  const ready = names.every((n) => fs.existsSync(path.join(r, 'node_modules', n, 'package.json')));
  const job = jobs.get(path.resolve(dir));
  return { ready, state: ready ? 'ready' : job ? job.state : 'missing', error: job && !ready ? job.error || '' : '', folder: r };
}

// The helper, its README (with the real path filled in) and a package.json that points at the helper.
function writeFiles(dir) {
  const r = root(dir);
  fs.mkdirSync(r, { recursive: true });
  fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify({ name: 'ai-office-doc-tools', private: true, main: 'index.cjs' }, null, 2) + '\n');
  fs.copyFileSync(path.join(SRC, 'index.cjs'), path.join(r, 'index.cjs'));
  fs.writeFileSync(path.join(r, 'README.md'), fs.readFileSync(path.join(SRC, 'README.md'), 'utf8').split('TOOLS_DIR').join(r));
}

// npm comes with Node: <node dir>/node_modules/npm (Windows) or <prefix>/lib/node_modules/npm (Mac, Linux).
function npmCli() {
  const bin = path.dirname(process.execPath);
  return [path.join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]
    .find((f) => fs.existsSync(f)) || null;
}

// Copy the files; install the libraries if they are not there yet. onChange(status) when the state changes.
function ensure(dir, onChange = () => {}) {
  try { writeFiles(dir); } catch { return status(dir); } // no .office folder: not an office
  const st = status(dir);
  if (st.ready || st.state === 'installing') return st;
  const key = path.resolve(dir), cli = npmCli();
  if (!cli) { jobs.set(key, { state: 'failed', error: 'npm was not found next to Node.' }); onChange(status(dir)); return status(dir); }
  jobs.set(key, { state: 'installing' }); onChange(status(dir));
  let err = '';
  const c = spawn(process.execPath, [cli, 'install', '--no-audit', '--no-fund', '--loglevel=error', ...PKGS], { cwd: root(dir), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  c.stderr.on('data', (d) => { err = (err + d).slice(-1500); });
  c.on('error', (e) => { err = e.message; });
  c.on('close', (code) => {
    jobs.set(key, code === 0 && status(dir).ready ? { state: 'ready' } : { state: 'failed', error: (err.trim().split('\n').pop() || `npm stopped (${code})`).slice(0, 300) });
    onChange(status(dir));
  });
  return status(dir);
}

module.exports = { ensure, status, writeFiles, PKGS };

// Opening a file from a chat: only inside the office or a linked folder, only if it exists,
// documents open, programs are only shown in their folder.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const G = require('../lib/generate');
const D = require('../lib/defaults');
const O = require('../lib/office');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-office-open-'));
const dir = path.join(tmp, 'office');
G.writeOffice(dir, G.buildConfig({ company: 'Kedai Ali', pa: 'Hana', staff: D.STAFF.slice(0, 2).map(({ name, role, job }) => ({ name, role, job })) }));
fs.mkdirSync(path.join(dir, 'projects', 'deck'), { recursive: true });
fs.writeFileSync(path.join(dir, 'projects', 'deck', 'slides.html'), '<h1>hi</h1>');
fs.writeFileSync(path.join(dir, 'projects', 'deck', 'run.bat'), 'echo hi');
const outside = path.join(tmp, 'outside.html'); fs.writeFileSync(outside, 'x');
const linked = path.join(tmp, 'shop'); fs.mkdirSync(linked); fs.writeFileSync(path.join(linked, 'price.pdf'), 'x');

const code = (f) => { try { f(); return 0; } catch (e) { return e.status || 400; } };
assert.strictEqual(O.resolveOpen(dir, path.join(dir, 'projects', 'deck', 'slides.html')).how, 'open');
assert.strictEqual(O.resolveOpen(dir, 'projects/deck/slides.html').how, 'open', 'relative to the office');
assert.strictEqual(O.resolveOpen(dir, `\`${path.join(dir, 'projects', 'deck', 'slides.html')}\``).how, 'open', 'backticks stripped');
assert.strictEqual(O.resolveOpen(dir, 'projects/deck/run.bat').how, 'reveal', 'a script is never run');
assert.strictEqual(O.resolveOpen(dir, 'projects/deck').how, 'folder');
assert.strictEqual(code(() => O.resolveOpen(dir, outside)), 403, 'outside the office');
assert.strictEqual(code(() => O.resolveOpen(dir, 'projects/../../outside.html')), 403, 'no climbing out');
assert.strictEqual(code(() => O.resolveOpen(dir, 'projects/deck/gone.html')), 404);
assert.strictEqual(code(() => O.resolveOpen(dir, path.join(linked, 'price.pdf'))), 403, 'not linked yet');
O.addLinked(dir, { path: linked, label: 'Shop' });
assert.strictEqual(O.resolveOpen(dir, path.join(linked, 'price.pdf')).how, 'open', 'linked folder');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('ok open: office and linked only, scripts only shown\n\n1 open test passed');

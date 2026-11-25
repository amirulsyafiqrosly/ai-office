// AI Office document tools. AI Office installs them into <office>/.office/doc-tools and keeps this file up to date.
// In a staff script (CommonJS, .cjs):
//   const t = require('<office>/.office/doc-tools');
//   t.PptxGenJS (PowerPoint), t.ExcelJS (Excel), t.docx (Word), t.svgToPng, t.htmlToPng, t.htmlToPdf
// The browser helpers use the Chrome or Edge already on this computer, in a throwaway profile.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

function browser() {
  const env = process.env;
  const list = process.platform === 'win32' ? [
    path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ] : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium'];
  return list.find((p) => p && fs.existsSync(p)) || null;
}

// HTML text or an .html file -> a file:// address (HTML text goes to a temporary file)
function page(htmlOrFile) {
  if (/^\s*</.test(htmlOrFile)) {
    const f = path.join(os.tmpdir(), `aio-page-${process.pid}-${Date.now()}.html`);
    fs.writeFileSync(f, htmlOrFile);
    return { url: pathToFileURL(f).href, tmp: f };
  }
  return { url: pathToFileURL(path.resolve(htmlOrFile)).href, tmp: null };
}

function headless(args, htmlOrFile) {
  const b = browser();
  if (!b) throw new Error('No Chrome or Edge on this computer. Draw an SVG and use svgToPng instead.');
  const p = page(htmlOrFile);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'aio-browser-'));
  try {
    execFileSync(b, ['--headless', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      '--virtual-time-budget=5000', `--user-data-dir=${prof}`, ...args, p.url], { stdio: 'ignore', timeout: 120000 });
  } finally {
    fs.rmSync(prof, { recursive: true, force: true });
    if (p.tmp) fs.rmSync(p.tmp, { force: true });
  }
}

module.exports = {
  get PptxGenJS() { return require('pptxgenjs'); },
  get ExcelJS() { return require('exceljs'); },
  get docx() { return require('docx'); },
  browser,
  // SVG text -> PNG file, no browser needed. width in pixels.
  svgToPng(svg, out, width = 1600) {
    const { Resvg } = require('@resvg/resvg-js');
    const sans = process.platform === 'win32' ? 'Segoe UI' : process.platform === 'darwin' ? 'Helvetica' : 'DejaVu Sans'; // when a font is missing
    const font = { loadSystemFonts: true, defaultFontFamily: sans, sansSerifFamily: sans, serifFamily: process.platform === 'win32' ? 'Times New Roman' : 'DejaVu Serif' };
    fs.writeFileSync(out, new Resvg(svg, { fitTo: { mode: 'width', value: width }, font }).render().asPng());
    return out;
  },
  // HTML (text or file) -> PNG screenshot. scale 2 = sharper (twice the pixels).
  htmlToPng(htmlOrFile, out, { width = 1600, height = 900, scale = 1 } = {}) {
    headless([`--screenshot=${path.resolve(out)}`, `--window-size=${width},${height}`, `--force-device-scale-factor=${scale}`], htmlOrFile);
    if (!fs.existsSync(out)) throw new Error('The browser did not make the picture.');
    return out;
  },
  // HTML (text or file) -> PDF (A4 unless the page sets @page { size: ... }).
  htmlToPdf(htmlOrFile, out) {
    headless([`--print-to-pdf=${path.resolve(out)}`, '--no-pdf-header-footer'], htmlOrFile);
    if (!fs.existsSync(out)) throw new Error('The browser did not make the PDF.');
    return out;
  },
};

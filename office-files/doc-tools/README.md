# Making real office files

You can make PowerPoint, Excel, Word, PDF and PNG files. Write a small script, run it with node, then check
the file.

1. Save a script as `make-<thing>.cjs` in the project folder (or your own staff folder). Use `require`, not `import`.
2. Load the tools with the full path below (it works from any folder):
   ```js
   const t = require(String.raw`TOOLS_DIR`);
   ```
3. Run it: `node "<folder>/make-<thing>.cjs"`. Only `node` on a script saved in the office is allowed.
4. Check the file exists and is not empty, and report the file's full path in backticks. Keep the script next
   to the file: when the boss wants a change, edit the script and run it again.
5. Save results next to the work they belong to: `projects/<project>/` (or your staff folder).

Make it look professional: one clear idea per slide, real numbers, the company's name, a consistent colour.
Ask for missing facts instead of inventing them.

## PowerPoint (.pptx)

```js
const t = require(String.raw`TOOLS_DIR`), path = require('path');
(async () => {
  const pres = new t.PptxGenJS(); pres.layout = 'LAYOUT_WIDE';               // 13.33 x 7.5 inches
  let s = pres.addSlide(); s.background = { color: '7C3AED' };               // colours without #
  s.addText('Sales Plan 2027', { x: 0.6, y: 2.4, w: 12, h: 1.2, fontSize: 48, bold: true, color: 'FFFFFF' });
  s = pres.addSlide(); s.addText('Three ideas', { x: 0.6, y: 0.4, fontSize: 32, bold: true });
  s.addText([{ text: 'Partner with 5 resellers', options: { bullet: true } }, { text: 'Referral bonus RM50', options: { bullet: true } }],
    { x: 0.6, y: 1.4, w: 7, h: 3, fontSize: 22 });
  s.addImage({ path: path.join(__dirname, 'poster.png'), x: 8, y: 1.4, w: 4.8, h: 2.52 });   // a PNG you made
  s = pres.addSlide();
  s.addChart(pres.charts.BAR, [{ name: 'Sales', labels: ['Jan', 'Feb', 'Mar'], values: [12, 19, 15] }],
    { x: 0.6, y: 1.3, w: 7, h: 5, showValue: true, chartColors: ['7C3AED'] });             // also LINE, PIE, DOUGHNUT
  s.addTable([[{ text: 'Month', options: { bold: true } }, { text: 'RM k', options: { bold: true } }], ['Jan', '12']],
    { x: 8.2, y: 1.3, w: 4.4, fontSize: 16, border: { color: 'DDDDDD', pt: 1 } });
  s.addNotes('Speaker notes for this slide.');
  await pres.writeFile({ fileName: path.join(__dirname, 'sales-plan.pptx') });
})();
```

## Excel (.xlsx)

```js
const t = require(String.raw`TOOLS_DIR`), path = require('path');
(async () => {
  const wb = new t.ExcelJS.Workbook(); const ws = wb.addWorksheet('Invoices');
  ws.columns = [{ header: 'Invoice', key: 'no', width: 14 }, { header: 'Customer', key: 'c', width: 26 },
    { header: 'Amount (RM)', key: 'a', width: 16, style: { numFmt: '#,##0.00' } }];
  ws.addRow({ no: 'INV-001', c: 'Syarikat Maju', a: 3980 });
  ws.addRow({ c: 'Total', a: { formula: 'SUM(C2:C2)' } }).font = { bold: true };          // real formulas
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.autoFilter = 'A1:C1';
  await wb.xlsx.writeFile(path.join(__dirname, 'invoices.xlsx'));
  // read one: await wb.xlsx.readFile(file); wb.getWorksheet(1).getRow(2).values
})();
```

## Word (.docx)

```js
const t = require(String.raw`TOOLS_DIR`), path = require('path'), fs = require('fs');
const { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun, WidthType } = t.docx;
(async () => {
  const cell = (x, bold) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: x, bold })] })] });
  const doc = new Document({ sections: [{ children: [
    new Paragraph({ text: 'Meeting notes', heading: HeadingLevel.HEADING_1 }),
    new Paragraph('Decisions from the sales meeting.'),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
      new TableRow({ children: [cell('Task', true), cell('Who', true)] }), new TableRow({ children: [cell('Reseller list'), cell('Siti')] })] }),
  ] }] });
  fs.writeFileSync(path.join(__dirname, 'meeting-notes.docx'), await Packer.toBuffer(doc));
})();
```

## PDF (quotation, letter, report, flyer)

Design it as HTML and CSS, then print it. Best for anything that must look exact.

```js
const t = require(String.raw`TOOLS_DIR`), path = require('path');
t.htmlToPdf(`<html><head><style>@page { size: A4; margin: 18mm } body { font-family: Arial; font-size: 12px }
  table { width: 100%; border-collapse: collapse } td, th { border-bottom: 1px solid #ddd; padding: 6px; text-align: left }</style></head>
  <body><h1 style="color:#7C3AED">Quotation Q-0012</h1><table><tr><th>Item</th><th>Price (RM)</th></tr>
  <tr><td>Website</td><td>3,500.00</td></tr></table></body></html>`, path.join(__dirname, 'quotation.pdf'));
// or an .html file you wrote: t.htmlToPdf(path.join(__dirname, 'report.html'), out)
```

## Pictures (.png): posters, social media posts, banners, charts, diagrams

Claude cannot paint photos, but it can design. Two ways:

- HTML and CSS, then a screenshot: gradients, shadows, web fonts, emoji, layouts. Best for posts and posters.
  ```js
  t.htmlToPng(`<html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(135deg,#F97316,#EC4899);font-family:Segoe UI,Arial"><h1 style="color:#fff;font-size:80px">Promo Merdeka</h1>
    </body></html>`, path.join(__dirname, 'promo.png'), { width: 1080, height: 1080, scale: 2 });   // 1080x1080 = Instagram post
  ```
- SVG, no browser needed: shapes, icons, charts, diagrams, logos.
  ```js
  t.svgToPng(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#7C3AED"/>
    <text x="80" y="300" font-family="Arial" font-size="84" font-weight="700" fill="#fff">Raya Sale 30%</text></svg>`,
    path.join(__dirname, 'poster.png'), 1200);
  ```
Sizes: Facebook/LinkedIn post 1200x630, Instagram 1080x1080, story 1080x1920, A4 poster as PDF.
Look at the result with Read (it can show images) and fix anything that looks off before you report.

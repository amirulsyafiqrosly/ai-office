// Chat Markdown: commands in code blocks must come out exactly as written.
import assert from 'assert';
import { markdown } from '../dashboard/markdown.js';

const ps = 'Run this:\n\n```powershell\nSet-Content x.md "# Title`n`nLine one.`n"\nRemove-Item inbox\\* -Force\n```\n\nDone.';
const out = markdown(ps);
const code = /<pre><code>([\s\S]*?)<\/code><\/pre>/.exec(out)[1];
assert.strictEqual(code, 'Set-Content x.md &quot;# Title`n`nLine one.`n&quot;\nRemove-Item inbox\\* -Force');
assert.match(out, /<p>Run this:<\/p>/); assert.match(out, /<p>Done\.<\/p>/); assert.match(out, /data-copy/);
assert.doesNotMatch(markdown('```\n<script>alert(1)</script>\n```'), /<script>/);
assert.match(markdown('use `npm test` and **bold**'), /<code>npm test<\/code> and <b>bold<\/b>/);
assert.match(markdown('| a | b |\n|---|---|\n| 1 | 2 |'), /<td>1<\/td><td>2<\/td>/);
console.log('ok markdown: code blocks kept exactly, inline code, tables, no HTML injection\n\n1 markdown test passed');

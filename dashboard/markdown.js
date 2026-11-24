// Small, safe Markdown for chat replies: text is escaped first, then a few
// patterns are turned into HTML (bold, code, links, lists, tables, headings).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function markdown(text) {
  const lines = esc(text).replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l || '');
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
  while (i < lines.length) {
    const l = lines[i];
    if (isRow(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) { // table
      const head = cells(l); i += 2;
      const rows = [];
      while (isRow(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<table class="mdt"><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (/^\s*([-*]|\d+[.)])\s+/.test(l)) { // list
      const ordered = /^\s*\d/.test(l);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) items.push(inline(lines[i++].replace(/^\s*([-*]|\d+[.)])\s+/, '')));
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${x}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
    } else if (/^#{1,4}\s/.test(l)) {
      out.push(`<p><b>${inline(l.replace(/^#{1,4}\s+/, ''))}</b></p>`); i++;
    } else if (/^\s*&gt;\s?/.test(l)) {
      const q = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) q.push(inline(lines[i++].replace(/^\s*&gt;\s?/, '')));
      out.push(`<blockquote>${q.join('<br>')}</blockquote>`);
    } else if (!l.trim()) { i++; } else {
      const p = [];
      while (i < lines.length && lines[i].trim() && !isRow(lines[i]) && !/^\s*([-*]|\d+[.)])\s+/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i]) && !/^\s*&gt;/.test(lines[i])) p.push(inline(lines[i++]));
      out.push(`<p>${p.join('<br>')}</p>`);
    }
  }
  return out.join('');
}

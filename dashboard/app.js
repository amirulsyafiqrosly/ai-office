// AI Office dashboard. Plain JS, no build step. Every change goes through the local
// API to the office files; the server tells us when files change (Claude may edit them too).
import { icon } from './icons.js';
import { portrait } from './avatar.js';

const KEY = document.querySelector('meta[name="office-key"]').content;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SWATCH = ['#FF6B6B', '#FF9F1C', '#2EC4B6', '#3A86FF', '#06D6A0', '#F15BB5', '#8D6E63', '#118AB2', '#8338EC', '#E0524F'];
const SKINS = ['#F7D7B5', '#F3C7A2', '#F0C8A0', '#EDB98A', '#E3AE7C', '#C98E5E', '#A8724A', '#7A4E2E'];
const HAIRS = ['#1A1A1A', '#2B2233', '#6B4423', '#A0522D', '#C9A26B', '#8D93A5'];

async function api(path, method = 'GET', body) {
  const res = await fetch(`/api/${path}`, {
    method, headers: { 'X-Office-Key': KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// ------------------------------------------------------------------ state
const S = {
  office: null, staff: [], projects: [], inbox: [], approvals: [],
  view: 'office', staffSeg: 'active', settings: 'general',
  sel: { staff: null, project: null, inbox: null },
  okOpen: false, dirty: new Set(), project: null,
  status: { people: {}, banner: null },
};
const views = ['office', 'staff', 'projects', 'inbox', 'settings'];

async function load(areas = ['office', 'staff', 'projects', 'inbox', 'approvals']) {
  const map = { office: 'office', staff: 'staff', projects: 'projects', inbox: 'inbox', approvals: 'approvals' };
  await Promise.all(areas.map(async (a) => { S[a] = await api(map[a]); }));
  if (areas.includes('projects') && S.sel.project) S.project = await api(`projects/${encodeURIComponent(S.sel.project)}`).catch(() => null);
}

// ------------------------------------------------------------------ helpers
const pa = () => S.office.pa;
const staffById = (id) => S.staff.find((s) => s.id === id) || (S.office.archived || []).find((s) => s.id === id);
const av = (s, cls = '') => `<span class="av ${cls}">${portrait(s.colour, s.look)}</span>`;
const paAv = () => av({ colour: pa().colour, look: pa().look || { scarf: true, skin: '#F2C9A0' } });
const MGR = '<span class="mgr" title="Manager: oversees all staff"><img src="assets/emoji/star.png" alt="">Manager</span>';
const nameOf = (id) => (id === 'boss' ? 'You' : (staffById(id) || {}).name || id || '');
function when(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return esc(iso);
  const s = (Date.now() - d) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
let toastT;
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = `toast on${err ? ' err' : ''}`;
  clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, err ? 5000 : 2200);
}
async function act(fn, ok) {
  try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(e.message, true); throw e; }
}
function modal(html, wire) {
  $('#mbox').innerHTML = html; $('#modal').classList.add('on');
  const close = () => $('#modal').classList.remove('on');
  $$('[data-close]', $('#mbox')).forEach((b) => { b.onclick = close; });
  wire && wire(close);
  const first = $('input,textarea', $('#mbox')); first && first.focus();
}
$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') $('#modal').classList.remove('on'); });

// Resizable split panes; the fixed pane's width is remembered.
function wireSplits(root) {
  $$('.gutter', root).forEach((g) => {
    const pane = g.dataset.side === 'prev' ? g.previousElementSibling : g.nextElementSibling;
    const key = `aio.pane.${g.dataset.key}`;
    const saved = Number(localStorage.getItem(key)); if (saved) pane.style.flexBasis = `${saved}px`;
    g.onpointerdown = (e) => {
      const x0 = e.clientX, w0 = pane.getBoundingClientRect().width, dir = g.dataset.side === 'prev' ? 1 : -1;
      g.setPointerCapture(e.pointerId); g.classList.add('drag'); document.body.classList.add('dragging');
      g.onpointermove = (ev) => { const w = Math.max(220, Math.min(760, w0 + dir * (ev.clientX - x0))); pane.style.flexBasis = `${w}px`; };
      g.onpointerup = () => { g.onpointermove = null; g.classList.remove('drag'); document.body.classList.remove('dragging'); localStorage.setItem(key, parseInt(pane.style.flexBasis, 10)); };
    };
  });
}

// ------------------------------------------------------------------ top bar + routing
function renderTop() {
  $('#company').textContent = S.office.company;
  document.title = `${S.office.company}: AI Office`;
  const newIn = S.inbox.filter((x) => x.status === 'new').length;
  const activeP = S.projects.filter((p) => p.status !== 'done').length;
  const tabs = [['office', 'layout-grid', 'Office', ''], ['staff', 'users', 'Staff', S.staff.length],
    ['projects', 'folder', 'Projects', activeP || ''], ['inbox', 'inbox', 'Inbox', newIn || '']];
  $('#tabs').innerHTML = tabs.map(([v, ic, label, n]) => `<button class="tab ${S.view === v ? 'on' : ''}" data-go="${v}">${icon(ic)}${label}${n !== '' ? ` <span class="n ${v === 'inbox' ? 'warn' : ''}">${n}</span>` : ''}</button>`).join('');
  const st = Object.values(S.status.people);
  const cnt = (k) => st.filter((x) => x.status === k).length;
  $('#stat').innerHTML = `<span class="d working" style="background:#4ADE80"></span><b>${cnt('working')}</b> working <span class="d" style="background:rgba(255,255,255,.55);margin-left:8px"></span><b>${cnt('sleeping')}</b> sleeping${cnt('waiting') ? ` <span class="d" style="background:#FFB020;margin-left:8px"></span><b>${cnt('waiting')}</b> waiting` : ''}`;
  $('#where').textContent = location.host;
  $('#gear').innerHTML = icon('settings');
}

function renderSub() {
  const t = {
    office: `<span class="livebadge"><i class="d working"></i>Live</span><span class="legend2"><span><i class="d working"></i>Working</span><span><i class="d sleeping"></i>Sleeping</span><span><i class="d waiting"></i>Waiting for OK</span></span>
      <span class="faint" style="margin-left:10px">Click anyone to see their work. Drag to move, scroll to zoom.</span>
      <div class="zoom"><button class="ibtn" id="zOut" title="Zoom out">${icon('minus')}</button><span id="zPct">${Math.round(V.zoom * 100)}%</span><button class="ibtn" id="zIn" title="Zoom in">${icon('plus')}</button><button class="ibtn" id="zFit" title="Fit to screen">${icon('maximize')}</button></div>`,
    staff: `<b>Team</b><span class="muted">${esc(pa().name)} + ${S.staff.length} staff. Changes save to each staff's CLAUDE.md.</span>`,
    projects: `<b>Projects</b><span class="muted">One folder per project, each with its own notes that staff read before working.</span>`,
    inbox: `<b>Inbox</b><span class="muted">Customer requests waiting for your team. One file each in inbox/.</span>`,
    settings: `<b>Settings</b><span class="muted">Saved in office.json in your office folder.</span>`,
  };
  $('#sub').innerHTML = t[S.view];
  if (S.view === 'office') {
    $('#zIn').onclick = () => zoomAt(V.zoom * 1.25);
    $('#zOut').onclick = () => zoomAt(V.zoom / 1.25);
    $('#zFit').onclick = () => { V.zoom = 1; V.panX = 0; V.panY = 0; fitOffice(true); };
  }
}

function go(view) {
  if (!views.includes(view)) view = 'office';
  S.view = view;
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  render();
}

function render() {
  renderTop(); renderSub();
  const main = $('#views');
  if (!$('.view', main)) main.innerHTML = views.map((v) => `<section class="view" id="v-${v}"></section>`).join('');
  $$('.view', main).forEach((el) => el.classList.toggle('on', el.id === `v-${S.view}`));
  ({ office: renderOffice, staff: renderStaff, projects: renderProjects, inbox: renderInbox, settings: renderSettings })[S.view]();
  renderOk();
}

// ------------------------------------------------------------------ office: live 3D office
// View (zoom, drag) is kept for this tab, so a normal refresh keeps it; a hard refresh
// (Ctrl+Shift+R) or a new tab starts at the default: zoomed in a little.
const VKEY = 'aio.view';
if ($('meta[name="fresh"]').content === '1') sessionStorage.removeItem(VKEY);
const V = Object.assign({ zoom: 1.4, panX: 0, panY: 0 }, JSON.parse(sessionStorage.getItem(VKEY) || '{}'));
const saveView = () => sessionStorage.setItem(VKEY, JSON.stringify(V));
let office3d = null, scene = null, sceneKey = '', building = false, again = false;

function renderOffice() {
  const v = $('#v-office');
  if (!$('#officeWrap', v)) {
    v.innerHTML = `<div class="officeWrap live" id="officeWrap"><button class="okbtn" id="okStat"></button><div id="termBar"></div>
      <div class="officeStage" id="officeStage"></div><div class="loading" id="oLoad">Opening the office...</div></div>`;
    wireOffice();
  }
  const b = S.status.banner;
  $('#termBar').innerHTML = b ? `<div class="termbar">${icon('circle-alert')}${esc(nameOf(b.who === 'pa' ? '' : b.who) || pa().name)} needs you in the terminal: ${esc(b.msg)}</div>` : '';
  renderOkButton();
  draw3d();
}

// "Siti: quote for Kedai Ali" -> "Quote for Kedai Ali" (the tag already shows the name)
function taskText(id, t) {
  const n = id === 'pa' ? pa().name : (staffById(id) || {}).name;
  const out = n && t ? t.replace(new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:,-]\\s*`, 'i'), '') : t || '';
  return out.charAt(0).toUpperCase() + out.slice(1);
}

// Rebuild the 3D office only when something it shows has changed.
async function draw3d() {
  const open = S.inbox.filter((x) => x.status !== 'done').sort((a, b) => Number(a.ticket) - Number(b.ticket));
  const opts = {
    company: S.office.company,
    pa: { name: pa().name, colour: pa().colour, look: pa().look || { scarf: true, skin: '#F2C9A0' } },
    staff: S.staff.map(({ id, name, role, colour, look }) => ({ id, name, role, colour, look })),
    status: Object.fromEntries(Object.entries(S.status.people).map(([k, x]) => [k, { status: x.status, task: taskText(k, x.task) }])),
    queue: open.slice(0, 3).map((x) => ({ text: (x.text || '').split('\n')[0], ticket: x.ticket })),
    queueCount: open.length,
  };
  const key = JSON.stringify(opts);
  if (key === sceneKey) return;
  if (building) { again = true; return; }
  building = true; sceneKey = key;
  try {
    office3d = office3d || await import('./office3d.js');
    const inner = document.createElement('div');
    const r = await office3d.renderOffice(inner, { ...opts, width: 900, dpr: Math.min(3, (window.devicePixelRatio || 1) * 2) });
    const stage = $('#officeStage'); if (!stage) return;
    if (scene) scene.dispose();
    stage.replaceChildren(inner); scene = r;
    stage.style.width = `${r.width}px`; stage.style.height = `${r.height}px`;
    $$('.tag[data-id]', inner).forEach((t) => { t.onclick = () => { S.sel.staff = t.dataset.id; S.staffSeg = 'active'; go('staff'); }; });
    const l = $('#oLoad'); if (l) l.remove();
    fitOffice();
  } catch (e) {
    console.error(e);
    const l = $('#oLoad'); if (l) l.textContent = 'This browser cannot show the 3D office. Everything else works.';
  } finally {
    building = false;
    if (again) { again = false; draw3d(); }
  }
}

function fitOffice(animate) {
  const stage = $('#officeStage'), wrap = $('#officeWrap');
  if (!stage || !scene || !wrap.offsetWidth) return;
  const base = Math.min(wrap.clientWidth / scene.width, wrap.clientHeight / scene.height) * 0.94;
  stage.style.transition = animate ? 'transform .25s ease' : 'none';
  stage.style.transform = `translate(calc(-50% + ${V.panX.toFixed(1)}px), calc(-50% + ${V.panY.toFixed(1)}px)) scale(${(base * V.zoom).toFixed(4)})`;
  const pct = $('#zPct'); if (pct) pct.textContent = `${Math.round(V.zoom * 100)}%`;
  saveView();
}
function zoomAt(z, cx, cy) { // keep the point under the cursor still
  const r = $('#officeWrap').getBoundingClientRect();
  const nz = Math.max(0.5, Math.min(4, z)); if (nz === V.zoom) return;
  const ox = (cx ?? r.left + r.width / 2) - (r.left + r.width / 2) - V.panX, oy = (cy ?? r.top + r.height / 2) - (r.top + r.height / 2) - V.panY;
  V.panX -= ox * (nz / V.zoom - 1); V.panY -= oy * (nz / V.zoom - 1); V.zoom = nz; fitOffice();
}
function wireOffice() {
  const wrap = $('#officeWrap');
  wrap.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(V.zoom * Math.pow(1.0015, -e.deltaY), e.clientX, e.clientY); }, { passive: false });
  wrap.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.tag[data-id],.okbtn,.termbar')) return;
    const sx = e.clientX - V.panX, sy = e.clientY - V.panY;
    wrap.setPointerCapture(e.pointerId); wrap.classList.add('panning');
    const mv = (ev) => { V.panX = ev.clientX - sx; V.panY = ev.clientY - sy; fitOffice(); };
    const up = () => { wrap.classList.remove('panning'); wrap.removeEventListener('pointermove', mv); wrap.removeEventListener('pointerup', up); };
    wrap.addEventListener('pointermove', mv); wrap.addEventListener('pointerup', up);
  });
  new ResizeObserver(() => fitOffice()).observe(wrap);
}

// ------------------------------------------------------------------ approvals drawer
const pendingOks = () => S.approvals.filter((a) => a.status === 'pending');
function renderOkButton() {
  const b = $('#okStat'); if (!b) return;
  const n = pendingOks().length;
  b.className = `okbtn${S.okOpen ? ' on' : ''}${n ? '' : ' clear'}`;
  b.innerHTML = n ? `${icon('hand')}<b>${n}</b> need your OK${icon(S.okOpen ? 'chevron-right' : 'chevron-left')}`
    : `${icon('check')}All clear${icon(S.okOpen ? 'chevron-right' : 'chevron-left')}`;
}
function okItem(a) {
  const who = staffById(a.from);
  const done = a.status !== 'pending';
  return `<div class="oki ${done ? 'done' : ''}">
    <div class="okh2">${who ? av(who) : ''}<b>${esc(who ? who.name : a.from)}</b><span class="faint">${when(a.created)}</span>${a.project ? `<span class="proj">${esc(a.project)}</span>` : ''}</div>
    <div class="okq">${esc(a.action)}</div>${a.details ? `<div class="okc">${esc(a.details)}</div>` : ''}
    ${done ? `<div class="okdone ${a.status}">${icon(a.status === 'approved' ? 'check' : 'x')}${a.status === 'approved' ? 'Approved' : 'Rejected'} ${when(a.decided)}</div>`
    : `<div class="okb"><button class="btn ok" data-ok="${esc(a.id)}" data-d="approved">${icon('check')}Approve</button><button class="btn" data-ok="${esc(a.id)}" data-d="rejected">${icon('x')}Reject</button></div>`}
  </div>`;
}
function renderOk() {
  document.body.classList.toggle('ok-open', S.okOpen);
  const n = pendingOks().length;
  const decided = S.approvals.filter((a) => a.status !== 'pending').slice(0, 10);
  $('#okDrawer').innerHTML = `<div class="okhead"><span class="okicon">${icon('hand')}</span>Needs your OK<span class="okn ${n ? '' : 'zero'}">${n}</span><button class="ibtn" data-oktoggle title="Close">${icon('x')}</button></div>
    <div class="okbody">${n ? pendingOks().map(okItem).join('') : `<div class="okempty">${icon('party-popper')}All clear. Nothing waiting for you.</div>`}
    ${decided.length ? `<div class="oksec">Decided</div>${decided.map(okItem).join('')}` : ''}</div>`;
  renderOkButton();
}

// ------------------------------------------------------------------ staff
function renderStaff() {
  const v = $('#v-staff');
  if (!$('.split', v)) {
    v.innerHTML = `<div class="split">
      <div class="pane" style="flex:1 1 auto"><div class="ph"><div class="seg" id="staffSeg"></div><div class="acts"><button class="btn sm pri" id="addStaff">${icon('plus')}Add staff</button></div></div><div class="pb" id="staffList"></div></div>
      <div class="gutter" data-side="next" data-key="staff"></div>
      <div class="pane" style="flex:0 0 400px" id="staffForm"></div></div>`;
    wireSplits(v);
    $('#addStaff').onclick = addStaffModal;
  }
  const arch = S.office.archived || [];
  $('#staffSeg').innerHTML = `<button class="${S.staffSeg === 'active' ? 'on' : ''}" data-seg="active">Active <span>${S.staff.length + 1}</span></button><button class="${S.staffSeg === 'archived' ? 'on' : ''}" data-seg="archived">Archived <span>${arch.length}</span></button>`;
  $$('#staffSeg button').forEach((b) => { b.onclick = () => { S.staffSeg = b.dataset.seg; renderStaff(); }; });
  $('#addStaff').disabled = S.staff.length >= 8;
  $('#addStaff').title = S.staff.length >= 8 ? 'At most 8 staff. Archive one first.' : '';
  const inv = S.office.addons && S.office.addons['invois-online'];
  const invChip = (id) => (inv && inv.enabled && (inv.staff || []).includes(id) ? '<span class="ichip" title="Works with Invois Online"><img src="assets/invois-icon.png" alt="">Invois</span>' : '');

  if (S.staffSeg === 'active') {
    const LAB = { working: 'Working', sleeping: 'Sleeping', waiting: 'Waiting for OK' };
    const stCells = (id) => { const x = S.status.people[id] || { status: 'sleeping' };
      return `<td><span class="badge ${x.status}"><i class="d ${x.status}"></i>${LAB[x.status]}</span></td><td class="muted" style="max-width:260px">${esc(x.status === 'working' ? taskText(id, x.task) : '') || '-'}</td><td class="muted">${x.last ? when(x.last) : '-'}</td>`; };
    $('#staffList').innerHTML = `<table><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Now doing</th><th>Last active</th></tr></thead><tbody>
      <tr data-who="pa" class="${S.sel.staff === 'pa' ? 'sel' : ''}"><td><span class="who">${paAv()}${esc(pa().name)} ${MGR}</span></td><td>PA</td>${stCells('pa')}</tr>
      ${S.staff.map((s) => `<tr data-who="${esc(s.id)}" class="${S.sel.staff === s.id ? 'sel' : ''}" title="${esc(s.job)}"><td><span class="who">${av(s)}${esc(s.name)}</span></td><td><span style="display:inline-flex;align-items:center;gap:6px"><i class="d" style="border-radius:2px;background:${esc(s.colour)}"></i>${esc(s.role)}</span>${invChip(s.id)}</td>${stCells(s.id)}</tr>`).join('')}
      </tbody></table>`;
    $$('#staffList tr[data-who]').forEach((tr) => { tr.onclick = () => { if (S.dirty.has('staff') && !confirm('Discard your unsaved changes?')) return; S.dirty.delete('staff'); S.sel.staff = tr.dataset.who; renderStaff(); }; });
  } else {
    $('#staffList').innerHTML = `<div class="arcnote">${icon('archive')}<div>Archived staff keep their folder, notes and history. They don't get work and don't show in the office.</div></div>
      ${arch.length ? `<table><thead><tr><th>Name</th><th>Role</th><th>Archived</th><th>Folder</th><th></th></tr></thead><tbody>${arch.map((s) => `<tr style="cursor:default"><td><span class="who">${av(s, 'grey')}${esc(s.name)}</span></td><td class="muted">${esc(s.role)}</td><td class="muted">${esc(s.archivedAt || '')}</td><td class="mono muted">.archive/staff/${esc(s.id)}/</td>
        <td style="text-align:right"><button class="btn sm" data-react="${esc(s.id)}">${icon('rotate-ccw')}Reactivate</button> <button class="btn sm danger" data-del="${esc(s.id)}">${icon('trash-2')}Delete permanently</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No archived staff.</div>'}`;
    $$('[data-react]').forEach((b) => { b.onclick = () => act(() => api(`staff/${b.dataset.react}/reactivate`, 'POST'), 'Reactivated').then(() => refresh(['office', 'staff'])); });
    $$('[data-del]').forEach((b) => { b.onclick = () => deleteStaffModal(staffById(b.dataset.del)); });
  }
  if (!S.dirty.has('staff')) renderStaffForm();
}

function renderStaffForm() {
  const f = $('#staffForm');
  const id = S.sel.staff;
  if (id === 'pa') {
    f.innerHTML = `<div class="ph">${paAv()}<h3>${esc(pa().name)}</h3>${MGR}<div class="acts"><button class="ibtn" data-x>${icon('x')}</button></div></div>
      <div class="pb pre">${esc(pa().name)} is your PA and manager. Every task goes through ${esc(pa().name)}, who hands it to the right staff, checks the result and reports back to you.

${esc(pa().name)}'s instructions are in <span class="mono">CLAUDE.md</span> in the office folder. The team table in it updates by itself when you add, edit or archive staff.</div>`;
  } else {
    const s = S.staff.find((x) => x.id === id);
    if (!s) { f.innerHTML = `<div class="empty"><b>Pick a staff</b>Click a row to edit their job, rules and look.</div>`; S.sel.staff = null; return; }
    const look = s.look || {};
    f.innerHTML = `<div class="ph"><span id="fAv">${av(s)}</span><h3>${esc(s.name)}</h3><span class="cnt">Edit</span><div class="acts"><button class="ibtn" data-x title="Close">${icon('x')}</button></div></div>
      <div class="pb form" id="sf">
        <div class="grid2"><div><label class="lbl">Name</label><input class="in" name="name" value="${esc(s.name)}" maxlength="40"></div>
        <div><label class="lbl">Role</label><input class="in" name="role" value="${esc(s.role)}" maxlength="60"></div></div>
        <label class="lbl">What does ${esc(s.name)} do?</label><textarea class="in" name="job" rows="3">${esc(s.job)}</textarea>
        <label class="lbl">Rules (one per line)</label><textarea class="in" name="rules" rows="6">${esc(s.rules.join('\n'))}</textarea>
        <label class="lbl">Notes</label><textarea class="in" name="notes" rows="3" placeholder="Things worth remembering about this job">${esc(s.notes)}</textarea>
        <label class="lbl">Colour</label><div class="swatches" data-pick="colour">${SWATCH.map((c) => `<i style="background:${c}" data-v="${c}" class="${c.toLowerCase() === String(s.colour).toLowerCase() ? 'on' : ''}"></i>`).join('')}</div>
        <label class="lbl">Look</label>
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><input type="checkbox" name="scarf" ${look.scarf ? 'checked' : ''}> Headscarf</label>
        <div class="swatches" data-pick="skin" style="margin-bottom:6px">${SKINS.map((c) => `<i style="background:${c}" data-v="${c}" class="${c === look.skin ? 'on' : ''}"></i>`).join('')}</div>
        <div class="swatches" data-pick="hair">${HAIRS.map((c) => `<i style="background:${c}" data-v="${c}" class="${c === look.hair ? 'on' : ''}"></i>`).join('')}</div>
        <label class="lbl">Tools</label><div class="pre" style="padding:0;color:var(--muted)">${esc(s.tools.replace(/<!--[\s\S]*?-->/g, '').trim())}</div>
        <div class="arcnote" style="margin:10px 0 0">${icon('plug')}<div>To give ${esc(s.name)} a new tool (email, WhatsApp, an API), ask Claude in the office folder, for example <i>"let ${esc(s.name)} send WhatsApp messages"</i>.</div></div>
        <label class="lbl">Saved to</label><div class="mono muted">${esc(s.file)}</div>
      </div>
      <div class="formfoot"><button class="btn pri" id="sSave">${icon('save')}Save</button><button class="btn" id="sCancel">Cancel</button><button class="btn danger" style="margin-left:auto" id="sArch">${icon('archive')}Archive</button></div>`;
    const pick = { colour: s.colour, skin: look.skin, hair: look.hair };
    const preview = () => { const sc = $('[name=scarf]', f).checked; $('#fAv').innerHTML = av({ colour: pick.colour, look: { scarf: sc, skin: pick.skin, hair: pick.hair } }); };
    $$('[data-pick]', f).forEach((g) => { g.onclick = (e) => { const v = e.target.dataset.v; if (!v) return; pick[g.dataset.pick] = v; $$('i', g).forEach((i) => i.classList.toggle('on', i === e.target)); S.dirty.add('staff'); preview(); }; });
    $('#sf').oninput = () => { S.dirty.add('staff'); preview(); };
    $('#sCancel').onclick = () => { S.dirty.delete('staff'); renderStaffForm(); };
    $('#sSave').onclick = () => {
      const val = (n) => $(`[name=${n}]`, f).value;
      act(() => api(`staff/${id}`, 'PUT', { name: val('name'), role: val('role'), job: val('job'), rules: val('rules').split('\n'), notes: val('notes'),
        colour: pick.colour, look: { scarf: $('[name=scarf]', f).checked, skin: pick.skin, hair: pick.hair } }), 'Saved')
        .then(() => { S.dirty.delete('staff'); return refresh(['office', 'staff']); });
    };
    $('#sArch').onclick = () => modal(`<div class="mh">${icon('archive')}<b>Archive ${esc(s.name)}?</b></div>
      <p>${esc(s.name)} stops getting work and leaves the office. The folder, notes and history are kept, and you can reactivate any time.</p>
      <div class="mfoot"><button class="btn" data-close>Cancel</button><button class="btn pri" id="mGo">${icon('archive')}Archive</button></div>`,
    (close) => { $('#mGo').onclick = () => act(() => api(`staff/${id}/archive`, 'POST'), `${s.name} archived`).then(() => { close(); S.dirty.delete('staff'); S.sel.staff = null; return refresh(['office', 'staff']); }); });
  }
  const x = $('[data-x]', f); if (x) x.onclick = () => { S.dirty.delete('staff'); S.sel.staff = null; renderStaff(); };
}

function addStaffModal() {
  modal(`<div class="mh">${icon('user-plus')}<b>Add staff</b></div>
    <div class="grid2"><div><label class="lbl">Name</label><input class="in" id="nName" maxlength="40" placeholder="Farah"></div><div><label class="lbl">Role</label><input class="in" id="nRole" maxlength="60" placeholder="Marketing"></div></div>
    <label class="lbl">What do they do?</label><textarea class="in" id="nJob" rows="3" placeholder="Social media posts, promos, captions."></textarea>
    <p style="margin-top:10px;font-size:12px">${esc(pa().name)} can hand them work right away. You can change their rules and look after.</p>
    <div class="mfoot"><button class="btn" data-close>Cancel</button><button class="btn pri" id="mGo">${icon('plus')}Add</button></div>`,
  (close) => {
    $('#mGo').onclick = () => act(() => api('staff', 'POST', { name: $('#nName').value, role: $('#nRole').value, job: $('#nJob').value }), 'Added')
      .then((s) => { close(); S.sel.staff = s.id; S.staffSeg = 'active'; return refresh(['office', 'staff']); });
  });
}

function deleteStaffModal(s) {
  modal(`<div class="mh">${icon('trash-2')}<b>Delete ${esc(s.name)} permanently?</b></div>
    <p>This removes the folder, job description and notes:</p>
    <div class="mono" style="background:var(--line2);border-radius:var(--rs);padding:6px 8px;margin:8px 0">.archive/staff/${esc(s.id)}/</div>
    <p>This cannot be undone. Project notes they wrote stay in the projects.</p>
    <label class="lbl">Type <b>DELETE</b> to confirm</label><input class="in" id="mConf" autocomplete="off">
    <div class="mfoot"><button class="btn" data-close>Cancel</button><button class="btn dangerSolid" id="mGo" disabled>${icon('trash-2')}Delete permanently</button></div>`,
  (close) => {
    $('#mConf').oninput = (e) => { $('#mGo').disabled = e.target.value !== 'DELETE'; };
    $('#mGo').onclick = () => act(() => api(`staff/${s.id}/delete`, 'POST', { confirm: $('#mConf').value }), 'Deleted').then(() => { close(); return refresh(['office', 'staff']); });
  });
}

// ------------------------------------------------------------------ projects
const PSTAT = { active: 'In progress', waiting: 'Waiting', done: 'Done' };
function renderProjects() {
  const v = $('#v-projects');
  if (!$('.split', v)) {
    v.innerHTML = `<div class="split">
      <div class="pane" style="flex:0 0 300px"><div class="ph"><h3>Projects</h3><span class="cnt" id="pCnt"></span><div class="acts"><button class="btn sm pri" id="newProj">${icon('plus')}New</button></div></div><div class="pb" id="projList"></div></div>
      <div class="gutter" data-side="prev" data-key="projects"></div>
      <div class="pane" style="flex:1 1 auto" id="projMain"></div>
      <div class="gutter" data-side="next" data-key="projmem"></div>
      <div class="pane" style="flex:0 0 360px" id="projMem"></div></div>`;
    wireSplits(v);
    $('#newProj').onclick = newProjectModal;
  }
  $('#pCnt').textContent = S.projects.length;
  $('#projList').innerHTML = S.projects.length ? S.projects.map((p) => `<div class="row ${S.sel.project === p.id ? 'sel' : ''}" data-p="${esc(p.id)}">${icon(p.status === 'done' ? 'check' : 'folder', 'faint')}<span class="txt"><b style="font-weight:600">${esc(p.title)}</b>${p.customer ? ` <span class="muted">${esc(p.customer)}</span>` : ''}</span><span class="badge ${esc(p.status)}">${esc(PSTAT[p.status] || p.status)}</span></div>`).join('')
    : `<div class="empty"><b>No projects yet</b>${esc(pa().name)} creates one when you start work for a customer, or press New.</div>`;
  $$('#projList [data-p]').forEach((r) => { r.onclick = async () => { S.sel.project = r.dataset.p; S.project = await api(`projects/${encodeURIComponent(r.dataset.p)}`); renderProjects(); }; });
  const p = S.project && S.project.id === S.sel.project ? S.project : null;
  if (!p) {
    $('#projMain').innerHTML = `<div class="empty"><b>Pick a project</b>Each project is a folder in projects/ with a CLAUDE.md that staff read before working.</div>`;
    $('#projMem').innerHTML = ''; return;
  }
  if (!S.dirty.has('project')) {
    $('#projMain').innerHTML = `<div class="ph">${icon('folder-open', 'faint')}<h3>${esc(p.title)}</h3><span class="badge ${esc(p.status)}">${esc(PSTAT[p.status] || p.status)}</span></div>
      <div class="pb form" id="pf">
        <div class="grid2"><div><label class="lbl">Status</label><select class="in" name="status">${Object.entries(PSTAT).map(([k, l]) => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label class="lbl">Deadline</label><input class="in" name="deadline" type="date" value="${esc(/^\d{4}-\d{2}-\d{2}$/.test(p.deadline) ? p.deadline : '')}"></div></div>
        <label class="lbl">Customer</label><input class="in" name="customer" value="${esc(p.customer)}">
        <label class="lbl">Files</label>${p.files.length ? `<div class="mono muted" style="line-height:1.7">${p.files.map(esc).join('<br>')}</div>` : '<div class="muted">No files yet.</div>'}
        <label class="lbl">Folder</label><div class="mono muted">${esc(p.folder)}</div>
      </div>
      <div class="formfoot"><button class="btn pri" id="pSave">${icon('save')}Save</button></div>`;
    $('#pf').oninput = () => S.dirty.add('project');
    $('#pSave').onclick = () => {
      const val = (n) => $(`#pf [name=${n}]`).value;
      act(() => api(`projects/${p.id}`, 'PUT', { status: val('status'), deadline: val('deadline'), customer: val('customer') }), 'Saved')
        .then((np) => { S.dirty.delete('project'); S.project = np; return refresh(['projects']); });
    };
  }
  $('#projMem').innerHTML = `<div class="ph">${icon('brain', 'faint')}<h3>Notes</h3><span class="cnt">${p.notes.length}</span></div>
    <div class="pb">${p.notes.map((n) => `<div class="note">${icon(/\((?:boss|you),/i.test(n) ? 'pin' : 'bot')}<div>${esc(n)}</div></div>`).join('')}
      <div class="muted" style="padding:10px 12px;font-size:12px">Staff read these before working on the project and add new ones. Saved in <span class="mono">${esc(p.folder)}CLAUDE.md</span>.</div></div>
    <div class="formfoot"><input class="in" id="noteIn" placeholder="Add a note for the team" maxlength="400"><button class="btn" id="noteAdd">${icon('plus')}Add</button></div>`;
  const addNote = () => { const t = $('#noteIn').value.trim(); if (!t) return; act(() => api(`projects/${p.id}/notes`, 'POST', { note: t })).then((np) => { S.project = np; renderProjects(); }); };
  $('#noteAdd').onclick = addNote;
  $('#noteIn').onkeydown = (e) => { if (e.key === 'Enter') addNote(); };
}

function newProjectModal() {
  modal(`<div class="mh">${icon('folder')}<b>New project</b></div>
    <label class="lbl">Project name</label><input class="in" id="nT" placeholder="Kedai Ali website" maxlength="80">
    <div class="grid2"><div><label class="lbl">Customer</label><input class="in" id="nC" maxlength="80"></div><div><label class="lbl">Deadline</label><input class="in" id="nD" type="date"></div></div>
    <label class="lbl">What do they want?</label><textarea class="in" id="nW" rows="3"></textarea>
    <div class="mfoot"><button class="btn" data-close>Cancel</button><button class="btn pri" id="mGo">${icon('plus')}Create</button></div>`,
  (close) => {
    $('#mGo').onclick = () => act(() => api('projects', 'POST', { title: $('#nT').value, customer: $('#nC').value, deadline: $('#nD').value, what: $('#nW').value }), 'Project created')
      .then(async (p) => { close(); S.sel.project = p.id; S.project = p; await refresh(['projects']); });
  });
}

// ------------------------------------------------------------------ inbox
const TYPE_COL = { lead: '#7C3AED', order: '#0F766E', enquiry: '#2563EB', message: '#6B7082' };
function renderInbox() {
  const v = $('#v-inbox');
  if (!$('.split', v)) {
    v.innerHTML = `<div class="split">
      <div class="pane" style="flex:1 1 auto"><div class="ph"><h3>Customer queue</h3><span class="cnt" id="iCnt"></span><div class="acts"><button class="btn sm pri" id="iAdd">${icon('plus')}Add a request</button></div></div><div class="pb" id="inList"></div></div>
      <div class="gutter" data-side="next" data-key="inbox"></div>
      <div class="pane" style="flex:0 0 380px" id="inSide"></div></div>`;
    wireSplits(v);
    $('#iAdd').onclick = () => { S.sel.inbox = 'new'; renderInbox(); };
  }
  $('#iCnt').textContent = `${S.inbox.length} request${S.inbox.length === 1 ? '' : 's'}`;
  $('#inList').innerHTML = S.inbox.length ? `<table><thead><tr><th>Ticket</th><th>Type</th><th>From</th><th>Source</th><th>Request</th><th>Who</th><th>Status</th><th>Received</th></tr></thead><tbody>
    ${S.inbox.map((x) => { const w = staffById(x.assigned); return `<tr data-i="${esc(x.id)}" class="${S.sel.inbox === x.id ? 'sel' : ''}"><td class="mono">#${esc(x.ticket)}</td>
      <td><span style="color:${TYPE_COL[x.type] || 'var(--muted)'};font-weight:600">${esc(x.type || 'message')}</span></td><td>${esc(x.from)}</td><td class="muted">${esc(x.source)}</td>
      <td style="max-width:280px">${esc((x.text || '').split('\n')[0])}</td><td>${w ? `<span class="who">${av(w)}${esc(w.name)}</span>` : '<span class="faint">-</span>'}</td>
      <td><span class="badge ${esc(x.status)}">${esc(x.status || 'new')}</span></td><td class="muted">${when(x.received)}</td></tr>`; }).join('')}</tbody></table>`
    : `<div class="empty"><b>The inbox is empty</b>Add a request by hand, or ask Claude to connect email, WhatsApp or your shop so requests arrive here by themselves.</div>`;
  $$('#inList tr[data-i]').forEach((tr) => { tr.onclick = () => { S.sel.inbox = tr.dataset.i; renderInbox(); }; });
  if (!S.dirty.has('inbox')) renderInboxSide();
}

function renderInboxSide() {
  const f = $('#inSide');
  const x = S.inbox.find((i) => i.id === S.sel.inbox);
  if (!x) {
    f.innerHTML = `<div class="ph"><h3>Add a request</h3></div>
      <div class="pb form" id="nf">
        <div class="grid2"><div><label class="lbl">Type</label><select class="in" name="type">${['enquiry', 'order', 'lead', 'message'].map((t) => `<option>${t}</option>`).join('')}</select></div>
        <div><label class="lbl">Source</label><select class="in" name="source">${['whatsapp', 'email', 'phone', 'walk-in', 'manual'].map((t) => `<option>${t}</option>`).join('')}</select></div></div>
        <label class="lbl">From</label><input class="in" name="from" maxlength="80" placeholder="Customer name">
        <label class="lbl">Request</label><textarea class="in" name="text" rows="6" placeholder="Paste the customer's message"></textarea>
        <div class="arcnote" style="margin:16px 0 0">${icon('plug')}<div>Want email, WhatsApp, your shop or a webhook to add requests here by themselves? Ask Claude in the office folder: <i>"connect my Gmail enquiries to the inbox"</i>.</div></div>
      </div>
      <div class="formfoot"><button class="btn pri" id="nAdd">${icon('plus')}Add to queue</button></div>`;
    $('#nf').oninput = () => S.dirty.add('inbox');
    $('#nAdd').onclick = () => {
      const val = (n) => $(`#nf [name=${n}]`).value;
      act(() => api('inbox', 'POST', { type: val('type'), source: val('source'), from: val('from'), text: val('text') }), `Added. Ask ${pa().name} to check the inbox.`)
        .then((it) => { S.dirty.delete('inbox'); S.sel.inbox = it.id; return refresh(['inbox']); });
    };
    return;
  }
  f.innerHTML = `<div class="ph"><span class="mono">#${esc(x.ticket)}</span><h3>${esc(x.from)}</h3><span class="badge ${esc(x.status)}">${esc(x.status)}</span><div class="acts"><button class="ibtn" data-x title="Close">${icon('x')}</button></div></div>
    <div class="pb form">
      <div class="grid2"><div><label class="lbl">Who handles it</label><select class="in" id="iWho"><option value="">Not assigned</option>${S.staff.map((s) => `<option value="${esc(s.id)}" ${x.assigned === s.id ? 'selected' : ''}>${esc(s.name)} (${esc(s.role)})</option>`).join('')}</select></div>
      <div><label class="lbl">Status</label><select class="in" id="iSt">${['new', 'working', 'waiting', 'done'].map((t) => `<option ${x.status === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
      <label class="lbl">${esc(x.type)} from ${esc(x.source)}, ${when(x.received)}</label>
      <div class="pre" style="border:1px solid var(--line2);border-radius:var(--r)">${esc(x.text)}</div>
      <label class="lbl">File</label><div class="mono muted">inbox/${esc(x.id)}.md</div>
    </div>`;
  const save = () => act(() => api(`inbox/${encodeURIComponent(x.id)}`, 'PUT', { assigned: $('#iWho').value, status: $('#iSt').value }), 'Saved').then(() => refresh(['inbox']));
  $('#iWho').onchange = save; $('#iSt').onchange = save;
  $('[data-x]', f).onclick = () => { S.sel.inbox = null; renderInbox(); };
}

// ------------------------------------------------------------------ settings
function renderSettings() {
  const nav = [['general', 'info', 'General'], ['addons', 'plug', 'Add-ons'], ['api', 'file-text', 'Office key and API']];
  const inv = (S.office.addons || {})['invois-online'];
  const body = {
    general: `<h3 style="margin-bottom:12px">General</h3><div class="kv">
      <span class="muted">Company</span><span>${esc(S.office.company)}</span>
      <span class="muted">PA and manager</span><span>${esc(pa().name)}</span>
      <span class="muted">Office folder</span><span class="mono">${esc(S.office.folder)}</span>
      <span class="muted">Dashboard</span><span class="mono">http://${esc(location.host)}</span></div>
      <p class="muted" style="margin-top:16px;line-height:1.6">To change the company or PA name, ask Claude in the office folder, for example <i>"rename the company to Kedai Ali Sdn Bhd"</i>. Everything is plain files: OFFICE.md explains each one.</p>`,
    addons: `<div class="featured"><div class="fhead"><img src="assets/invois-icon.png" alt=""><div><h2>Invois Online</h2><div class="muted">Real quotations, invoices and payments for your sales and finance staff. Made by the team behind AI Office.</div></div></div>
      <div class="fbody">${inv && inv.enabled ? `Turned on for: <b>${(inv.staff || []).map((id) => esc(nameOf(id))).join(', ') || 'no staff yet'}</b>.<br>To log in (one time): open a terminal in the office folder, run <code>claude</code>, type <code>/mcp</code>, pick <b>invois-online</b> and log in in your browser.`
      : `Not connected. Free plan: 60 documents a month. To connect, ask Claude in the office folder: <i>"connect Invois Online for my sales and finance staff"</i>.`}</div>
      <div class="ffoot"><a class="btn inv" href="https://invois.online/?ref=ai-office" target="_blank" rel="noopener">Create free account</a><span class="muted">Sending and payments always ask for your OK first.</span></div></div>
      <p class="muted" style="margin-top:20px;line-height:1.6">More: email, WhatsApp, your shop, any API. Ask Claude in the office folder, for example <i>"connect my Gmail enquiries to the inbox"</i> or <i>"let Siti send WhatsApp messages"</i>.</p>`,
    api: `<h3 style="margin-bottom:8px">Office key and local API</h3>
      <p class="muted" style="line-height:1.6;margin-bottom:12px">Scripts and connectors you set up can add inbox items, ask for approvals and log activity while the dashboard runs. Every call needs the office key. It only works on this computer.</p>
      <div class="kv"><span class="muted">Office key</span><span><span class="mono" id="keyV">••••••••••••••••</span> <button class="btn sm" id="keyShow">Show</button></span></div>
      <div class="pre mono" style="background:var(--line2);border-radius:var(--r);margin-top:14px">curl -X POST http://${esc(location.host)}/api/inbox \\
  -H "X-Office-Key: &lt;office key&gt;" -H "Content-Type: application/json" \\
  -d '{"from":"Kedai Ali","source":"webhook","type":"order","text":"50 t-shirts, size L"}'</div>
      <p class="muted" style="margin-top:12px">All calls are listed in OFFICE.md. Keep the key secret.</p>`,
  };
  $('#v-settings').innerHTML = `<div class="split"><div class="pane" style="flex:0 0 220px"><div class="pb" style="padding:8px">${nav.map(([k, ic, l]) => `<button class="snav ${S.settings === k ? 'on' : ''}" data-s="${k}">${icon(ic)}${l}</button>`).join('')}</div></div>
    <div class="gutter" data-side="prev" data-key="settings"></div><div class="pane" style="flex:1 1 auto"><div class="pb" style="padding:20px 24px;max-width:900px">${body[S.settings]}</div></div></div>`;
  wireSplits($('#v-settings'));
  $$('[data-s]').forEach((b) => { b.onclick = () => { S.settings = b.dataset.s; renderSettings(); }; });
  const ks = $('#keyShow'); if (ks) ks.onclick = () => { $('#keyV').textContent = KEY; ks.remove(); };
}

// ------------------------------------------------------------------ events
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-go],[data-oktoggle],#okStat,[data-ok]');
  if (!t) return;
  if (t.dataset.go) go(t.dataset.go);
  else if (t.id === 'okStat' || t.dataset.oktoggle !== undefined && t.hasAttribute('data-oktoggle')) { S.okOpen = !S.okOpen; renderOk(); }
  else if (t.dataset.ok) {
    t.disabled = true;
    act(() => api(`approvals/${encodeURIComponent(t.dataset.ok)}/decide`, 'POST', { decision: t.dataset.d }), t.dataset.d === 'approved' ? 'Approved. The staff will see it.' : 'Rejected.')
      .then(() => refresh(['approvals']), () => { t.disabled = false; });
  }
});
window.addEventListener('hashchange', () => go(location.hash.slice(1)));
window.addEventListener('beforeunload', (e) => { if (S.dirty.size) { e.preventDefault(); e.returnValue = ''; } });

async function refresh(areas) {
  await load(areas.filter((a) => a !== 'events'));
  render();
}

// Live refresh: the server says which part of the office folder changed.
function live() {
  let fails = 0, bar = null;
  const es = new EventSource(`/api/stream?key=${encodeURIComponent(KEY)}`);
  es.addEventListener('status', (e) => {
    S.status = JSON.parse(e.data);
    renderTop();
    if (S.view === 'office') renderOffice();
    if (S.view === 'staff' && $('#staffList')) renderStaff();
  });
  es.addEventListener('changed', (e) => {
    const areas = JSON.parse(e.data).map((a) => (a === 'office' ? ['office', 'staff'] : a === 'staff' ? ['staff', 'office'] : [a])).flat();
    refresh([...new Set(areas)].filter((a) => a !== 'events')).catch(() => {});
  });
  es.onopen = () => { fails = 0; if (bar) { bar.remove(); bar = null; load().then(render); } };
  es.onerror = () => {
    if (++fails >= 2 && !bar) { bar = document.createElement('div'); bar.className = 'offline'; bar.textContent = 'The office server stopped. Start it again from the office folder, then this page reconnects.'; document.body.append(bar); }
  };
}

(async () => {
  try { await load(); S.status = await api('status'); } catch (e) { document.body.innerHTML = `<div class="empty"><b>Cannot load the office</b>${esc(e.message)}</div>`; return; }
  go(location.hash.slice(1) || 'office');
  live();
})();

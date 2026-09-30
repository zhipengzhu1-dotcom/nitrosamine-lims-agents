/* Ledger and Rail: RD LIMS prototype for wayfinder ticket #23, candidate c2.
   Vanilla JS, no build. window.LIMS is the server's answer; nothing here edits it.
   Session state lives in S and in override maps; a full render() follows every recorded action,
   and typing inside a rail form updates only the nodes it touches. */
(() => {
'use strict';
const L = window.LIMS;
if (!L) { document.getElementById('app').textContent = 'data.js did not load.'; return; }

// ---------- lookups ----------
const index = (a) => Object.fromEntries(a.map((x) => [x.id, x]));
const PEOPLE = index(L.people), CUST = index(L.customers), PROD = index(L.products), METH = index(L.methods);
const SAMP = index(L.samples), EQ = index(L.equipment), ROOM = index(L.rooms), DEV = index(L.deviations), CHECKS = index(L.checksToday);
const TESTS = index(L.tests);
const LABDAY = L.meta.labDay, ZONE = L.meta.labZone;
const OPEN = ['Requested', 'Accepted', 'Ready', 'Assigned', 'In Progress', 'Submitted for Review', 'Reviewed'];
const TRACK = ['Requested', 'Accepted', 'Ready', 'Assigned', 'In Progress', 'Submitted for Review', 'Reviewed', 'Reported'];
const ROUTES = ['queue', 'assign', 'test', 'imported', 'sign', 'checks', 'check-fail'];
const PERSONA = { queue: L.personas.queue, assign: L.personas.queue, test: L.personas.test, imported: L.personas.test, sign: L.personas.test, checks: L.personas.checks, 'check-fail': L.personas.checks };
const FOCUS = L.focus.test;
const ANALYSTS = L.people.filter((p) => p.roles.includes('Analyst'));
const IDLE_MIN = L.demoCredentials.idleLockMinutes;
const LOCK_AFTER = L.demoCredentials.lockoutAfterFailures;

// ---------- clock: anchored to the dataset's now, moving with real seconds ----------
const T0 = Date.now(), NOW0 = Date.parse(L.meta.now);
const now = () => new Date(NOW0 + (Date.now() - T0));
const nowIso = () => now().toISOString();

// ---------- formatting ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const partsOf = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'long', timeZoneName: 'short' }).formatToParts(d).map((p) => [p.type, p.value]));
const fDay = (iso) => { const [, m, d] = iso.slice(0, 10).split('-'); return `${+d} ${MON[+m - 1]}`; };
const fDayFull = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${+d} ${MON[+m - 1]} ${y}`; };
const fDT = (iso) => { const p = partsOf(new Date(iso)); return `${+p.day} ${MON[+p.month - 1]} ${p.hour}:${p.minute}`; };
const fT = (iso) => { const p = partsOf(new Date(iso)); return `${p.hour}:${p.minute}`; };
const fTs = (iso) => { const p = partsOf(new Date(iso)); return `${p.hour}:${p.minute}:${p.second}`; };
const zone = (iso) => partsOf(new Date(iso)).timeZoneName;
const fUTC = (iso) => new Date(iso).toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
const fLocalFull = (iso) => { const p = partsOf(new Date(iso)); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ${p.hour}:${p.minute}:${p.second} ${p.timeZoneName}`; };
const labToday = () => { const p = partsOf(now()); return `${p.weekday} ${+p.day} ${MON[+p.month - 1]} ${p.year}`; };
const minus = (s) => String(s).replace(/-/g, '−');
const num = (v, d) => (v == null || v === '' ? '—' : minus(Number(v).toFixed(d)));
const signed = (v, d) => (v > 0 ? '+' : '') + minus(Number(v).toFixed(d));
const thousands = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'));
const grp8 = (h) => (h ? h.match(/.{1,8}/g).join(' ') : '');
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
function since(iso) {
  const ms = now() - new Date(iso), m = Math.floor(ms / 6e4);
  if (m < 60) return `${Math.max(m, 1)} min`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24), rh = h % 24; return d < 3 && rh ? `${d} d ${rh} h` : `${d} d`;
}
function bizBetween(a, b) { let n = 0; const d = new Date(a + 'T00:00:00Z'), e = new Date(b + 'T00:00:00Z'); while (d < e) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w && w !== 6) n++; } return n; }
const HORIZON = (() => { const d = new Date(LABDAY + 'T00:00:00Z'); let k = 0; while (k < 2) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w && w !== 6) k++; } return d.toISOString().slice(0, 10); })();
function dueInfo(t) {
  if (!t.dueDate) return { kind: 'none', text: t.state === 'Requested' ? 'set at Acceptance' : 'set at receipt' };
  if (t.dueDate < LABDAY) return { kind: 'overdue', text: `Overdue ${bizBetween(t.dueDate, LABDAY)} d` };
  if (t.dueDate === LABDAY) return { kind: 'risk', text: 'Due today' };
  if (t.dueDate <= HORIZON) return { kind: 'risk', text: `Due in ${bizBetween(LABDAY, t.dueDate)} d` };
  return { kind: 'later', text: `in ${bizBetween(LABDAY, t.dueDate)} d` };
}

// ---------- session state ----------
const S = {
  route: 'queue', user: null,
  q: { search: '', state: '', assignee: '', method: '', customer: '', gxp: '', holds: '', due: '', sort: 'due', selected: null },
  ws: { imported: false, flag: { handled: null, comment: '' }, checklist: [false, false, false], signature: null, uploading: null, pickedFile: false },
  ck: { selected: null, values: {}, confirm: {}, saved: {}, acked: null, nextDev: 94, holdsPlaced: 0 },
  auth: { fails: {}, locked: {} },
  dlg: null, focus: null, toastTimer: null,
};
const over = new Map();   // Test overrides after actions
const eqOver = new Map(); // Equipment overrides after a failed Check or an Excursion
const T = (t) => (over.has(t.id) ? { ...t, ...over.get(t.id) } : t);
const E = (id) => (eqOver.has(id) ? { ...EQ[id], ...eqOver.get(id) } : EQ[id]);
const openTests = () => L.tests.map(T).filter((t) => OPEN.includes(t.state));
const P = (id) => PEOPLE[id];
const pname = (id) => (id ? PEOPLE[id].name : '');
const lastAt = (t) => t.history[t.history.length - 1].at;
const openAssigned = (pid) => openTests().filter((t) => t.assigneeId === pid && (t.state === 'Assigned' || t.state === 'In Progress')).length;
const inReview = (pid) => openTests().filter((t) => t.assigneeId === pid && (t.state === 'Submitted for Review' || t.state === 'Reviewed')).length;

function eligibility(t) {
  if (t.id === L.focus.assignTestId) return L.focus.assignEligibility.map((e) => ({ ...e }));
  const m = METH[t.methodId], pre = L.prerequisites;
  return ANALYSTS.map((p) => {
    const reasons = [];
    if (!L.trainingRecords.some((r) => r.personId === p.id && r.documentNumber === m.number && r.version === m.version)) reasons.push(`No Training Record on ${m.number} v${m.version} (Effective ${m.effectiveDate})`);
    if (!L.trainingRecords.some((r) => r.personId === p.id && r.documentNumber === pre.documentNumber && r.version === pre.version)) reasons.push(`No Training Record on ${pre.documentNumber} v${pre.version}`);
    const a = L.authorisations.find((x) => x.personId === p.id && x.meaning === 'Performed' && x.scope === m.number && x.lab === L.lab.id);
    if (!a) reasons.push(`No Performed Authorisation for ${m.number}`);
    else if (a.status === 'Suspended') reasons.push(`Performed Authorisation suspended (${a.suspendedBy})`);
    else if (a.status === 'Expired' || a.validUntil < LABDAY) reasons.push(`Performed Authorisation expired ${a.validUntil}`);
    return { personId: p.id, reasons, openAssigned: openAssigned(p.id) };
  });
}

// ---------- glyphs ----------
const svg = (inner, cls = 'gl') => `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${inner}</svg>`;
const G = {
  check: svg('<path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  dot: svg('<circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/>'),
  half: svg('<circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 3.5a4.5 4.5 0 0 1 0 9z" fill="currentColor"/>'),
  warn: svg('<path d="M8 2.2l6.3 11.3H1.7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 6.4v3.4M8 12.1h.01" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'),
  stop: svg('<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M4 4l8 8" stroke="currentColor" stroke-width="1.9"/>'),
  hold: svg('<path d="M5.5 3v10M10.5 3v10" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'),
  flag: svg('<path d="M3.5 14.5V2.5h8.5l-1.6 3.2 1.6 3.3H3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'),
  lock: svg('<rect x="3" y="7" width="10" height="7.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.3 7V5a2.7 2.7 0 0 1 5.4 0v2" fill="none" stroke="currentColor" stroke-width="1.8"/>'),
  user: svg('<circle cx="8" cy="5.5" r="2.8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M2.8 14a5.2 5.2 0 0 1 10.4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  dash: svg('<path d="M4 8h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  fast: svg('<path d="M3 4l4 4-4 4M8.5 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  back: svg('<path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  sort: svg('<path d="M8 3v10M4.5 9.5L8 13l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  x: svg('<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  file: svg('<path d="M4 1.5h5l3.5 3.5v9.5H4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 1.5V5h3.5M6 8h4M6 10.5h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'),
  sig: svg('<path d="M2 12.5c2-3 3.5-5 5-5s1 4 2.5 4 2-3 4.5-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  clock: svg('<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
};
const st = (k, text, g) => `<span class="st st--${k}">${g || ''}<span>${esc(text)}</span></span>`;
const FIT = { 'In use': ['ok', 'check'], Suspended: ['bad', 'stop'], Expired: ['bad', 'warn'], Quarantined: ['warn', 'warn'], Retired: ['mute', 'dash'] };
const fitness = (f, reason) => { const [k, g] = FIT[f] || ['mute', 'dash']; return st(k, f, G[g]) + (reason ? ` <span class="why">${esc(reason)}</span>` : ''); };
const CKST = { Done: ['ok', 'check'], Due: ['mute', 'dot'], 'Due soon': ['warn', 'half'], Overdue: ['bad', 'warn'], Blocked: ['bad', 'stop'], 'Not used today': ['mute', 'dash'] };
const RISK = { Minor: 'mute', Major: 'warn', Critical: 'bad' };
const track = (state) => { const i = TRACK.indexOf(state); return `<span class="track" aria-hidden="true">${TRACK.map((s, j) => `<i class="${j <= i ? 'on' : ''}"></i>`).join('')}</span>`; };
const gxpTag = (g) => `<span class="tag ${g === 'GMP' ? 'tag--gmp' : 'tag--nongmp'}">${g}</span>`;
const dueTag = (du) => (du.kind === 'overdue' ? st('bad', du.text, G.warn) : du.kind === 'risk' ? st('warn', du.text, G.half) : `<span class="muted">${esc(du.text)}</span>`);
const devTag = (id) => { const d = DEV[id]; return d ? `<span class="st st--${RISK[d.risk]}" title="${esc(d.title)}">${G.warn}<span>${id}</span></span>` : `<span class="st st--mute">${G.warn}<span>${id}</span></span>`; };

// ---------- identity bar ----------
function renderTop() {
  const u = S.user;
  const active = { queue: 'queue', assign: 'queue', test: 'test', imported: 'test', sign: 'test', checks: 'checks', 'check-fail': 'checks' }[S.route];
  const navs = [['queue', 'Lab queue'], ['test', 'Test workspace'], ['checks', 'Today’s Checks']];
  return `<header class="topbar">
    <div class="brand">${L.lab.id} LIMS <span class="brand__lab">${esc(L.lab.name)}</span></div>
    <div class="who">
      <div>
        <div class="who__name">${esc(u.name)}${u.nativeName ? ` <span class="who__native">${esc(u.nativeName)}</span>` : ''}</div>
        <div class="who__meta"><b>${esc(u.roles.join(', '))}</b><span class="who__sep"></span>${esc(u.username)}<span class="who__sep"></span>Lab ${L.lab.id}<span class="who__sep"></span>locks in <b id="idle-left">${mmss(IDLE_MIN * 60)}</b></div>
      </div>
    </div>
    <nav class="nav" aria-label="Screens">${navs.map(([r, label]) => `<button class="nav__btn" data-act="go" data-route="${r}"${active === r ? ' aria-current="page"' : ''}>${label}</button>`).join('')}</nav>
    <div class="top-actions">
      <span class="fictional" title="${esc(L.meta.note)}">Fictional data</span>
      <button class="btn" data-act="lock">${G.lock}Lock</button>
      <button class="btn" data-act="switch">${G.user}Switch user</button>
    </div>
  </header>`;
}

// ---------- queue ----------
function queueFiltered(ignoreState) {
  const q = S.q, s = q.search.trim().toLowerCase();
  return openTests().filter((t) => {
    if (!ignoreState && q.state && t.state !== q.state) return false;
    if (q.assignee === 'unassigned' ? t.assigneeId : q.assignee && t.assigneeId !== q.assignee) return false;
    if (q.method && t.methodId !== q.method) return false;
    if (q.customer && t.customerId !== q.customer) return false;
    if (q.gxp && t.gxp !== q.gxp) return false;
    if (q.holds === 'with' && !t.holds.length) return false;
    if (q.holds === 'none' && t.holds.length) return false;
    if (q.due === 'overdue' && dueInfo(t).kind !== 'overdue') return false;
    if (q.due === 'risk' && dueInfo(t).kind !== 'risk') return false;
    if (q.due === 'dev' && !t.deviationIds.length) return false;
    if (s) {
      const sm = SAMP[t.sampleId], p = PROD[t.productId];
      const hay = [t.id, t.sampleId, t.submissionId, sm.lot, sm.customerRef, p.name, p.code, CUST[t.customerId].name, t.methodNumber, ...t.deviationIds, ...t.holds.map((h) => h.kind), t.assigneeId && pname(t.assigneeId), t.retestOf].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });
}
const dueKey = (t) => t.dueDate || '9999';
const SORTERS = {
  due: (a, b) => dueKey(a).localeCompare(dueKey(b)) || a.id.localeCompare(b.id),
  id: (a, b) => a.id.localeCompare(b.id),
  state: (a, b) => TRACK.indexOf(a.state) - TRACK.indexOf(b.state) || dueKey(a).localeCompare(dueKey(b)),
  since: (a, b) => lastAt(a).localeCompare(lastAt(b)),
  assignee: (a, b) => pname(a.assigneeId).localeCompare(pname(b.assigneeId)) || dueKey(a).localeCompare(dueKey(b)),
};
function renderQueue() {
  const all = openTests();
  const held = all.filter((t) => t.holds.length).length, overdue = all.filter((t) => dueInfo(t).kind === 'overdue').length, risk = all.filter((t) => dueInfo(t).kind === 'risk').length;
  return `<main class="screen">
    <section class="ledger" aria-label="Lab queue">
      <div class="shead"><div><h1>Lab queue</h1>
        <p class="shead__sub">${all.length} open Tests of ${thousands(L.tests.length)} this year: ${held} with Holds, ${overdue} overdue, ${risk} due within 2 business days.</p></div></div>
      <div id="q-tabs">${qTabs()}</div>
      <div class="filters">${qFilters()}</div>
      <div class="panel" id="q-table">${qTable()}</div>
    </section>
    <aside class="rail" aria-label="Actions">${S.q.selected ? testPanel(S.q.selected) : workloadPanel()}</aside>
  </main>`;
}
function qTabs() {
  const base = queueFiltered(true);
  const counts = Object.fromEntries(OPEN.map((s) => [s, base.filter((t) => t.state === s).length]));
  return `<div class="tabs" role="group" aria-label="Filter by state">
    <button class="tab" data-act="q-state" data-v="" aria-pressed="${!S.q.state}">All open <span class="tab__n">${base.length}</span></button>
    ${OPEN.map((s) => `<button class="tab" data-act="q-state" data-v="${s}" aria-pressed="${S.q.state === s}">${s} <span class="tab__n">${counts[s]}</span></button>`).join('')}
  </div>`;
}
function qFilters() {
  const q = S.q;
  const sel = (key, label, opts) => `<label class="sel"><span class="sel__l">${label}</span><select data-in="q" data-key="${key}" aria-label="${label}">${opts.map(([v, l]) => `<option value="${esc(v)}"${q[key] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const any = q.search || q.state || q.assignee || q.method || q.customer || q.gxp || q.holds || q.due;
  const ready = openTests().filter((t) => t.state === 'Ready' && !t.assigneeId).length;
  const quickOn = q.state === 'Ready' && q.assignee === 'unassigned';
  return `<input class="input search" id="q-search" type="search" data-in="q-search" value="${esc(q.search)}" placeholder="Search any ID, Lot, Product or Customer" aria-label="Search the queue" autocomplete="off">
    ${sel('assignee', 'Assignee', [['', 'Any'], ['unassigned', 'Unassigned'], ...ANALYSTS.map((p) => [p.id, p.name])])}
    ${sel('method', 'Method', [['', 'Any'], ...L.methods.map((m) => [m.id, `${m.number} v${m.version} ${m.title}`])])}
    ${sel('customer', 'Customer', [['', 'Any'], ...L.customers.map((c) => [c.id, c.name])])}
    ${sel('gxp', 'GxP Class', [['', 'Any'], ['GMP', 'GMP'], ['non-GMP', 'non-GMP']])}
    ${sel('holds', 'Holds', [['', 'Any'], ['with', 'With open Holds'], ['none', 'No Holds']])}
    ${sel('due', 'Due', [['', 'Any'], ['overdue', 'Overdue'], ['risk', 'Due within 2 business days'], ['dev', 'With Deviations']])}
    <button class="btn${quickOn ? ' is-on' : ''}" data-act="q-quick" aria-pressed="${quickOn}">Needs assignment <b>${ready}</b></button>
    ${any ? `<button class="btn btn--quiet" data-act="q-clear">${G.x}Clear filters</button>` : ''}`;
}
function qTable() {
  const rows = queueFiltered(false).sort(SORTERS[S.q.sort] || SORTERS.due);
  const th = (key, l1, l2) => `<th aria-sort="${S.q.sort === key ? 'ascending' : 'none'}"><button class="th-btn" data-act="q-sort" data-v="${key}" title="Sort by ${l1}"><span><div class="l1">${l1}${S.q.sort === key ? ' ' + G.sort : ''}</div><div class="l2">${l2}</div></span></button></th>`;
  const thp = (l1, l2) => `<th><div class="l1">${l1}</div><div class="l2">${l2}</div></th>`;
  return `<table class="qtable">
    <colgroup><col style="width:10%"><col style="width:16%"><col style="width:16%"><col style="width:9%"><col style="width:15%"><col style="width:11%"><col style="width:11%"><col style="width:12%"></colgroup>
    <thead><tr>${th('id', 'Test', 'Sample')}${thp('Product, Lot', 'Customer')}${thp('Method', 'title')}${thp('GxP Class', 'service level')}${th('state', 'State', 'time in state')}${th('due', 'Due', 'business days')}${th('assignee', 'Assignee', 'username')}${thp('Holds', 'Deviations')}</tr></thead>
    <tbody>${rows.length ? rows.map(qRow).join('') : `<tr><td colspan="8" class="empty">No open Tests match these filters. <button class="btn btn--quiet" data-act="q-clear">Clear filters</button></td></tr>`}</tbody>
  </table><div class="tfoot">${rows.length} of ${openTests().length} open Tests${S.q.sort === 'due' ? ', earliest due first' : ''}</div>`;
}
function qRow(t) {
  const sm = SAMP[t.sampleId], p = PROD[t.productId], c = CUST[t.customerId], m = METH[t.methodId];
  const du = dueInfo(t), sel = S.q.selected === t.id;
  const holds = t.holds.length ? `<span class="tag tag--hold" title="${esc(t.holds.map((h) => `${h.kind}: ${h.reason}`).join('\n'))}">${G.hold}${t.holds.length} ${t.holds.length === 1 ? 'Hold' : 'Holds'}</span>` : '<span class="muted">none</span>';
  const devs = t.deviationIds.map(devTag).join(' ');
  const flags = t.flags ? ` <span class="tag tag--bad">${esc(t.flags.join(', '))}</span>` : '';
  return `<tr id="row-${t.id}" tabindex="0" aria-selected="${sel}" data-act="select-test" data-id="${t.id}">
    <td><div class="l1"><b>${t.id}</b></div><div class="l2">${t.sampleId}</div></td>
    <td><div class="l1">${esc(p.name)}, <span class="muted">Lot ${esc(sm.lot)}</span>${flags}</div><div class="l2">${esc(c.name)}</div></td>
    <td><div class="l1">${m.number} v${m.version}</div><div class="l2">${esc(m.title)}</div></td>
    <td><div class="l1">${gxpTag(t.gxp)}</div><div class="l2">${t.serviceLevel === 'Expedited' ? `<span class="st st--warn">${G.fast}<span>Expedited</span></span>` : 'Standard'}</div></td>
    <td><div class="l1">${t.state}</div><div class="l2">${track(t.state)}${since(lastAt(t))}</div></td>
    <td><div class="l1">${t.dueDate ? fDay(t.dueDate) : '<span class="muted">no date</span>'}</div><div class="l2">${dueTag(du)}</div></td>
    <td>${t.assigneeId ? `<div class="l1">${esc(pname(t.assigneeId))}</div><div class="l2">${P(t.assigneeId).username}</div>` : `<div class="l1 muted">Unassigned</div><div class="l2">${t.state === 'Ready' ? 'ready to assign' : t.state === 'Requested' ? 'awaiting Acceptance' : 'awaiting the Sample'}</div>`}</td>
    <td><div class="l1">${holds}</div><div class="l2">${devs}</div></td>
  </tr>`;
}
function workloadPanel() {
  const rows = ANALYSTS.map((p) => ({ p, n: openAssigned(p.id), r: inReview(p.id) })).sort((a, b) => b.n - a.n || a.p.name.localeCompare(b.p.name));
  const max = Math.max(1, ...rows.map((r) => r.n));
  const unassigned = openTests().filter((t) => !t.assigneeId), ready = unassigned.filter((t) => t.state === 'Ready').length;
  return `<div class="rail__body">
    <h2>Analysts’ workload</h2>
    <p class="muted small">Each bar is one Analyst’s Assigned and In Progress Tests; the grey number is Tests awaiting review. Tap a name to filter the queue.</p>
    <div class="wl">${rows.map(({ p, n, r }) => `<button class="wl__row" style="--w:${(n / max) * 100}%" data-act="q-assignee" data-v="${p.id}" aria-pressed="${S.q.assignee === p.id}"><span class="wl__name">${esc(p.name)}</span><span class="wl__n"><b>${n}</b> <span class="muted">+${r}</span></span></button>`).join('')}</div>
    <h3>Unassigned</h3>
    <p class="small">${unassigned.length} open Tests have no Analyst: ${ready} are Ready to assign, the rest await Acceptance or their Sample.</p>
    <button class="btn btn--bench" data-act="q-quick">Show the ${ready} Tests that need assignment</button>
    <h3>September so far</h3>
    <p class="small">${L.metrics.samplesReceivedSeptember} Samples received, ${L.metrics.testsReportedSeptember} Tests reported, ${L.metrics.onTimePctSeptember} % on time, median TAT ${L.metrics.medianTatBusinessDays} business days.</p>
  </div>`;
}
function testPanel(id) {
  const t = T(TESTS[id]); if (!t) return workloadPanel();
  const sm = SAMP[t.sampleId], p = PROD[t.productId], c = CUST[t.customerId], m = METH[t.methodId];
  const du = dueInfo(t);
  const holds = t.holds.length ? t.holds.map((h) => `<div class="hold"><div class="hold__k">${G.hold}${esc(h.kind)}</div><div>${esc(h.reason)}</div><div class="muted small">Blocks ${esc(h.blocks)}. Opened ${fDT(h.openedAt)}${h.releasedBy ? `; released by the ${esc(h.releasedBy)}` : ''}.</div></div>`).join('') : '<p class="muted small">None open. A Hold pauses named steps without changing the state.</p>';
  const devs = t.deviationIds.length ? t.deviationIds.map((id) => { const d = DEV[id]; return d ? `<div class="dev"><div class="dev__k">${devTag(id)} <span class="tag tag--${RISK[d.risk] === 'mute' ? 'neutral' : RISK[d.risk]}">${d.risk}</span> <span class="muted">${d.kind}, ${d.state}</span></div><div>${esc(d.title)}</div><div class="muted small">Investigator ${esc(pname(d.investigatorId))}, due ${fDayFull(d.dueDate)}</div></div>` : `<div class="dev">${devTag(id)}</div>`; }).join('') : '<p class="muted small">None linked.</p>';
  let action = '';
  if (t.state === 'Ready' && !t.assigneeId) action = `<button class="btn btn--primary btn--bench" data-act="open-assign">Assign to an Analyst</button>`;
  else if (t.state === 'Assigned') action = `<button class="btn btn--bench" data-act="open-assign">Reassign</button>`;
  else if (t.state === 'Requested') action = `<p class="muted small">Awaiting Acceptance by a Sample Custodian; nothing to assign yet.</p>`;
  else if (t.state === 'Accepted') action = `<p class="muted small">Accepted; becomes Ready when the Sample is received.</p>`;
  else action = `<p class="muted small">No Lab Manager action at this state.</p>`;
  if (t.id === FOCUS.testId) action += `<button class="btn btn--bench" data-act="go" data-route="test">Open the Test workspace</button>`;
  return `<div class="rail__body">
    <div class="rail__nav"><button class="btn btn--quiet" data-act="q-deselect">${G.back}Analysts’ workload</button></div>
    <div class="tp-head"><div class="tp-id">${t.id}</div><div class="tp-tags">${gxpTag(t.gxp)}<span class="tag tag--neutral">${t.serviceLevel}</span></div></div>
    <div class="tp-state">${track(t.state)}<b>${t.state}</b><span class="muted">for ${since(lastAt(t))}</span></div>
    <div class="tp-due">${dueTag(du)}<span class="muted">${t.dueDate ? `due ${fDayFull(t.dueDate)}, ` : ''}TAT ${t.tatBusinessDays} business days${t.dueDate ? '' : ' from Acceptance'}</span></div>
    <dl class="facts">
      <dt>Sample</dt><dd>${t.sampleId} <span class="muted">${esc(sm.state)}, ${esc(sm.storage)}</span></dd>
      <dt>Product</dt><dd>${esc(p.name)} <span class="muted">${esc(p.code)}</span></dd>
      <dt>Lot</dt><dd>${esc(sm.lot)} <span class="muted">Customer ref ${esc(sm.customerRef)}</span></dd>
      <dt>Customer</dt><dd>${esc(c.name)}</dd>
      <dt>Method</dt><dd>${m.number} v${m.version} ${esc(m.title)} <span class="muted">${m.technique}</span></dd>
      <dt>Submission</dt><dd>${t.submissionId}${sm.stability ? ` <span class="muted">Stability Pull, ${esc(sm.stability.protocol)}, ${esc(sm.stability.condition)}, ${esc(sm.stability.timePoint)}</span>` : ''}</dd>
      <dt>Assignee</dt><dd>${t.assigneeId ? `${esc(pname(t.assigneeId))} <span class="muted">${P(t.assigneeId).username}</span>` : '<span class="muted">Unassigned</span>'}</dd>
      ${t.reviewerId ? `<dt>Reviewer</dt><dd>${esc(pname(t.reviewerId))}</dd>` : ''}
      ${t.nonGmpReason ? `<dt>non-GMP reason</dt><dd>${esc(t.nonGmpReason)}</dd>` : ''}
      ${t.retestOf ? `<dt>Retest of</dt><dd>${t.retestOf}</dd>` : ''}
      ${t.flags ? `<dt>Flags</dt><dd><span class="tag tag--bad">${esc(t.flags.join(', '))}</span></dd>` : ''}
    </dl>
    <h3>${G.hold}Holds <span class="muted">${t.holds.length}</span></h3>${holds}
    <h3>${G.warn}Deviations <span class="muted">${t.deviationIds.length}</span></h3>${devs}
    <h3>History</h3>
    <ol class="hist">${t.history.map((h) => `<li><span>${esc(h.state)}</span><span class="muted">${fDT(h.at)}${h.by ? `, ${P(h.by).username}` : ''}</span></li>`).join('')}</ol>
  </div>
  <div class="rail__foot">${action}</div>`;
}
function assignDialog(d) {
  const t = T(TESTS[d.testId]); const sm = SAMP[t.sampleId], p = PROD[t.productId], c = CUST[t.customerId], m = METH[t.methodId], pre = L.prerequisites;
  const el = eligibility(t);
  const eligible = el.filter((e) => !e.reasons.length).sort((a, b) => a.openAssigned - b.openAssigned || pname(a.personId).localeCompare(pname(b.personId)));
  const refused = el.filter((e) => e.reasons.length);
  const pick = d.pick;
  return `<div class="scrim"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="as-title">
    <div class="dialog__h">
      <h2 id="as-title">${t.state === 'Assigned' ? 'Reassign' : 'Assign'} ${t.id} <span class="shead__prod">${esc(p.name)}, Lot ${esc(sm.lot)}</span></h2>
      <p class="dialog__sub">${esc(c.name)}. ${m.number} v${m.version} ${esc(m.title)}. ${gxpTag(t.gxp)} ${t.serviceLevel}${t.dueDate ? `, due ${fDayFull(t.dueDate)}` : ''}.${t.assigneeId ? ` Currently assigned to ${esc(pname(t.assigneeId))}.` : ''}</p>
      <p class="dialog__req">The server refuses an assignment, with no override, unless the Analyst has a Training Record on ${m.number} v${m.version}, a Training Record on ${pre.documentNumber} v${pre.version} (${esc(pre.title)}), and a current Performed Authorisation for ${m.number} in Lab ${L.lab.id}.</p>
    </div>
    <div class="dialog__b"><div class="assign">
      <section>
        <h3>Can be assigned <span class="muted">${eligible.length}</span></h3>
        <p class="muted small">Least loaded first. The number is the Analyst’s Assigned and In Progress Tests.</p>
        <div class="pick" role="radiogroup" aria-label="Eligible Analysts">${eligible.map((e) => `<button class="pick__row" role="radio" aria-checked="${pick === e.personId}" data-act="as-pick" data-v="${e.personId}" id="pick-${e.personId}"><span class="radio"></span><span class="pick__who"><span class="pick__name">${esc(pname(e.personId))}</span> <span class="muted">${P(e.personId).username}</span></span><span class="pick__load"><b>${e.openAssigned}</b> open</span></button>`).join('')}</div>
      </section>
      <section>
        <h3>Cannot be assigned <span class="muted">${refused.length}</span></h3>
        <p class="muted small">Refused by the server. Each reason is a record the Analyst lacks.</p>
        <div class="refused">${refused.map((e) => `<div class="refused__row"><span class="pick__name">${esc(pname(e.personId))}</span> <span class="muted">${P(e.personId).username}, ${e.openAssigned} open</span>${e.reasons.map((r) => `<div class="refused__why">${G.stop}<span>${esc(r)}</span></div>`).join('')}</div>`).join('')}</div>
      </section>
    </div></div>
    <div class="dialog__f">
      <p class="muted small">Assigning is recorded in the Audit Trail with your name and the server time. It is not signed.</p>
      <div class="dialog__btns"><button class="btn btn--bench btn--auto" data-act="as-cancel">Cancel</button><button class="btn btn--primary btn--bench btn--auto" data-act="as-confirm"${pick ? '' : ' disabled'}>${pick ? `Assign to ${esc(pname(pick))}` : 'Choose an Analyst'}</button></div>
    </div>
  </div></div>`;
}

// ---------- test workspace ----------
function renderWorkspace() {
  const t = T(TESTS[FOCUS.testId]);
  return `<main class="screen">
    <section class="ledger" aria-label="Test workspace">${wsHead(t)}${S.ws.imported ? wsImport() + wsResults() + wsInjections() + wsRunChecks() + wsPreps() + wsRun() : wsPreps() + wsRun() + wsNoResults()}</section>
    <aside class="rail" aria-label="Actions">${wsRail(t)}</aside>
  </main>`;
}
function wsHead(t) {
  const sm = SAMP[t.sampleId], p = PROD[t.productId], c = CUST[t.customerId], m = METH[t.methodId];
  return `<div class="shead">
    <div><h1>${t.id} <span class="shead__prod">${esc(p.name)}, Lot ${esc(sm.lot)}</span></h1><p class="shead__sub">${esc(c.name)}. ${m.number} v${m.version} ${esc(m.title)} (${m.technique}).</p></div>
    <div class="shead__right">${gxpTag(t.gxp)}<span class="tag tag--neutral">${t.serviceLevel}</span><span class="tp-state">${track(t.state)}<b>${t.state}</b><span class="muted">for ${since(lastAt(t))}</span></span>${dueTag(dueInfo(t))}<span class="muted">${t.dueDate ? `due ${fDayFull(t.dueDate)}` : ''}</span></div>
  </div>
  <dl class="facts facts--4 panel pad">
    <dt>Sample</dt><dd>${t.sampleId} <span class="muted">${esc(sm.state)}, ${esc(sm.storage)}, received ${fDT(sm.receivedAt)}</span></dd>
    <dt>Submission</dt><dd>${t.submissionId} <span class="muted">Customer ref ${esc(sm.customerRef)}</span></dd>
    <dt>Assignee</dt><dd>${esc(pname(t.assigneeId))} <span class="muted">${t.assigneeId === S.user.id ? 'you' : P(t.assigneeId).username}</span></dd>
    <dt>Product code</dt><dd>${esc(p.code)} <span class="muted">maximum daily dose ${p.maxDailyDoseMg} mg</span></dd>
    <dt>Notebook Entry</dt><dd>${FOCUS.notebookEntry}</dd>
    <dt>Record Version</dt><dd>${FOCUS.recordVersion} <span class="mono muted">${FOCUS.contentSha256.slice(0, 8)}</span></dd>
  </dl>`;
}
function wsPreps() {
  const eqCell = (id) => { const e = E(id); return `${id} ${fitness(e.fitness)}`; };
  return `<section class="sec"><div class="sec__h"><h2>Preparations</h2><span class="muted">${FOCUS.preparations.length}, each entered by the Analyst and Verified by a second person</span></div>
  <div class="panel"><table class="dt"><thead><tr><th>Preparation</th><th class="num">Weight (mg)</th><th class="num">Volume (mL)</th><th>Balance</th><th>Pipettes</th><th>DI water</th><th>Diluent</th><th>Entered by</th><th>Verified by</th></tr></thead>
  <tbody>${FOCUS.preparations.map((pr) => `<tr><td><b>${pr.id}</b></td><td class="num">${num(pr.weightMg, 2)}</td><td class="num">${num(pr.volumeMl, 2)}</td><td>${eqCell(pr.balance)}</td><td>${pr.pipettes.map(eqCell).join(', ')}</td><td>${eqCell(pr.diWater)}</td><td>${pr.diluent} ${fitness(FOCUS.run.solutions.find((s) => s.id === pr.diluent)?.fitness || 'In use')}</td><td>${esc(pname(pr.enteredBy))} <span class="muted">${fDT(pr.enteredAt)}</span></td><td>${st('ok', pname(pr.verifiedBy), G.sig)} <span class="muted">${fDT(pr.verifiedAt)}</span></td></tr>`).join('')}</tbody></table></div></section>`;
}
function wsRun() {
  const r = FOCUS.run, inst = E(r.instrument);
  return `<section class="sec"><div class="sec__h"><h2>Run ${r.id}</h2><span class="muted">${r.injections} injections, ${r.testsInRun} Tests in the Run</span></div>
  <div class="panel"><dl class="facts facts--4 pad">
    <dt>Instrument</dt><dd>${r.instrument} ${esc(inst.name)} ${fitness(inst.fitness, inst.reason)} <span class="muted">${esc(inst.software || '')}</span></dd>
    <dt>Column</dt><dd>${r.column.pack} ${esc(r.column.material)} ${fitness(r.column.fitness)}</dd>
    <dt>Acquired</dt><dd>${fDT(r.acquiredFrom)} to ${fDT(r.acquiredTo)} ${zone(r.acquiredTo)}</dd>
  </dl>
  <table class="dt"><thead><tr><th>Solution</th><th>What</th><th>Made on</th><th>Expires</th><th>Fitness Status</th></tr></thead>
  <tbody>${r.solutions.map((s) => `<tr><td><b>${s.id}</b></td><td class="wrap">${esc(s.what)}</td><td>${fDayFull(s.madeOn)}</td><td>${fDayFull(s.expires)}</td><td>${fitness(s.fitness)}</td></tr>`).join('')}</tbody></table></div></section>`;
}
function wsNoResults() {
  return `<section class="sec"><div class="sec__h"><h2>Results</h2></div>
  <div class="panel empty-state"><b>No results yet.</b> The Run finished at ${fT(FOCUS.run.acquiredTo)} ${zone(FOCUS.run.acquiredTo)}. Upload the TargetLynx export from the rail: the worker parses it into draft values and cross-checks the PDF. Nothing becomes a result until you sign Performed.</div></section>`;
}
function wsImport() {
  const im = FOCUS.import;
  return `<section class="sec"><div class="sec__h"><h2>Import</h2><span class="muted">parsed by the worker, ${im.rowsForThisTest} rows for this Test</span></div>
  <div class="panel"><dl class="facts facts--4 pad">
    <dt>File</dt><dd><span class="mono">${esc(im.file)}</span> <span class="muted">${thousands(im.bytes)} bytes</span></dd>
    <dt>Parser</dt><dd>${esc(im.parser)}</dd>
    <dt>Uploaded</dt><dd>${esc(pname(im.uploadedBy))}, ${fDT(im.uploadedAt)} ${zone(im.uploadedAt)}</dd>
    <dt>SHA-256</dt><dd class="mono">${grp8(im.sha256)}</dd>
    <dt>Dataset</dt><dd class="mono">${esc(im.dataset)}</dd>
    <dt>PDF cross-check</dt><dd>${st('ok', `${thousands(im.pdf.crossCheck.cellsCompared)} cells compared, ${im.pdf.crossCheck.mismatches} mismatches`, G.check)} <span class="mono muted">${esc(im.pdf.file)}</span></dd>
  </dl></div></section>`;
}
const draftClass = () => (S.ws.signature ? '' : ' dt--draft');
const draftTag = () => (S.ws.signature ? `<span class="tag tag--ok">${G.check}Confirmed by your Performed signature</span>` : `<span class="tag tag--draft">Draft: becomes your results when you sign Performed</span>`);
function wsResults() {
  const rows = FOCUS.results.map((r) => {
    const flagged = r.flags.length;
    return `<tr${flagged ? ' class="flagged"' : ''}><td><b>${r.analyte}</b></td>${r.perPrep.map((pp) => `<td class="num v">${pp.display ? esc(pp.display) : num(pp.ppm, 4)}</td>`).join('')}<td class="num v rep">${r.reportableDisplay ? esc(r.reportableDisplay) : num(r.reportablePpm, 4)}</td><td class="num">${num(r.loqPpm, 3)}</td><td class="num">${num(r.limitPpm, 4)}</td><td class="num">${r.pctOfLimit == null ? '—' : r.pctOfLimit.toFixed(1) + ' %'}</td><td>${flagged ? r.flags.map((f) => `<span class="st st--warn">${G.flag}<span>${esc(f.kind)}, ${f.injection}</span></span>`).join(' ') : ''}</td></tr>`;
  }).join('');
  return `<section class="sec"><div class="sec__h"><h2>Results</h2>${draftTag()}</div>
  ${S.ws.signature ? sigBlock(S.ws.signature) : ''}
  <div class="panel"${S.ws.signature ? ' style="margin-top:10px"' : ''}><table class="dt${draftClass()}"><thead><tr><th>Analyte</th><th class="num">Preparation 1 (ppm)</th><th class="num">Preparation 2 (ppm)</th><th class="num">Reportable Result (ppm)</th><th class="num">LOQ (ppm)</th><th class="num">Illustrative limit (ppm)</th><th class="num">Of limit</th><th>Flags</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="note">${esc(FOCUS.limitsNote)} Units: ${esc(FOCUS.units.result)}; the Reportable Result is the mean of the Preparations, each the mean of its injections.</p></section>`;
}
function wsInjections() {
  const byA = {};
  FOCUS.injections.forEach((i) => (byA[i.analyte] = byA[i.analyte] || []).push(i));
  const flagOf = (i) => FOCUS.results.find((r) => r.analyte === i.analyte)?.flags.find((f) => f.injection === i.name);
  const rows = Object.entries(byA).map(([a, list]) => list.map((i, k) => { const f = flagOf(i); return `<tr${f ? ' class="flagged"' : ''}>${k === 0 ? `<td class="grp" rowspan="${list.length}">${a}</td>` : ''}<td>${i.prep}</td><td>${i.inj}</td><td>${i.name}</td><td class="num v">${num(i.rt, 2)}</td><td class="num v">${thousands(i.area)}</td><td class="num v">${thousands(i.isArea)}</td><td class="num v">${typeof i.pguL === 'number' ? num(i.pguL, 3) : esc(i.pguL ?? '—')}</td><td class="num v">${num(i.peakRatio, 3)}</td><td class="num v">${i.sn ?? '—'}</td><td>${f ? `<span class="st st--warn">${G.flag}<span>${esc(f.kind)}: ${f.found} vs ${f.window[0]}–${f.window[1]}</span></span>` : ''}</td></tr>`; }).join('')).join('');
  return `<section class="sec"><div class="sec__h"><h2>Injections for this Test</h2><span class="muted">${FOCUS.injections.length} rows, ${esc(FOCUS.units.pguL)}</span></div>
  <div class="panel"><table class="dt${draftClass()}"><thead><tr><th>Analyte</th><th>Preparation</th><th>Injection</th><th>Name</th><th class="num">RT (min)</th><th class="num">Area</th><th class="num">IS area</th><th class="num">pg/µL</th><th class="num">Peak ratio</th><th class="num">S/N</th><th>Flag</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}
function wsRunChecks() {
  const c = FOCUS.run.checks;
  const rows = c.calibration.map((cal) => {
    const ccv = c.ccv.filter((x) => x.analyte === cal.analyte), bl = c.blanks.filter((x) => x.analyte === cal.analyte), sn = c.loqSignalToNoise.find((x) => x.analyte === cal.analyte);
    const pass = cal.pass && ccv.every((x) => x.pass) && bl.every((x) => x.pass) && sn.pass;
    return `<tr><td><b>${cal.analyte}</b> <span class="muted">${cal.internalStandard}</span></td><td class="num">${cal.r2.toFixed(4)}</td>${ccv.map((x) => `<td class="num">${x.recoveryPct.toFixed(1)}</td>`).join('')}<td>${bl.every((x) => x.found == null) ? 'none found in 2 blanks' : 'found'}</td><td class="num">${sn.sn}</td><td>${st(pass ? 'ok' : 'bad', pass ? 'Pass' : 'Fail', pass ? G.check : G.stop)}</td></tr>`;
  }).join('');
  const cal0 = c.calibration[0], lim = c.ccv[0].limits;
  return `<section class="sec"><div class="sec__h"><h2>Run checks</h2><span class="muted">calibration ${cal0.levels} levels ${cal0.rangePguL[0]}–${cal0.rangePguL[1]} pg/µL, weighting ${cal0.weighting}; CCV limits ${lim[0]}–${lim[1]} %; S/N at LOQ at least ${c.loqSignalToNoise[0].limit}</span></div>
  <div class="panel"><table class="dt"><thead><tr><th>Analyte, internal standard</th><th class="num">r²</th><th class="num">CCV-1 (%)</th><th class="num">CCV-2 (%)</th><th class="num">CCV-3 (%)</th><th>Blanks</th><th class="num">S/N at LOQ</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}
function sigBlock(sig) {
  return `<div class="sigblock sigblock--in" id="sigblock">
    <div class="sigblock__title">${G.sig}Signed ${esc(sig.meaning)}</div>
    <dt>Signed by</dt><dd><b>${esc(sig.name)}</b> (${esc(sig.username)}), ${esc(sig.role)}, Lab ${L.lab.id}</dd>
    <dt>Meaning</dt><dd>${esc(sig.meaning)}: “${esc(L.signatureMeanings[sig.meaning])}”</dd>
    <dt>Time</dt><dd>${fUTC(sig.at)}; ${fLocalFull(sig.at)} (${ZONE})</dd>
    <dt>Record</dt><dd>${esc(sig.record)}, Record Version ${sig.version}, SHA-256 <span class="mono">${sig.hash.slice(0, 8)}</span></dd>
  </div>`;
}
function wsRail(t) {
  const ws = S.ws, r = FOCUS.run, im = FOCUS.import;
  if (!ws.imported) {
    let body;
    if (ws.uploading != null) {
      const steps = ['Reading the file and computing its SHA-256', 'Parsing the TargetLynx TXT into draft values', 'Cross-checking every cell against the PDF'];
      body = `<ol class="progress" aria-live="polite">${steps.map((s, i) => `<li class="${i < ws.uploading ? 'done' : i === ws.uploading ? 'now' : 'pending'}">${i < ws.uploading ? G.check : i === ws.uploading ? G.clock : G.dot}<span>${s}</span></li>`).join('')}</ol>`;
    } else if (ws.pickedFile) {
      body = `<div class="upload-list">
        <button class="file" role="radio" aria-checked="true" data-act="noop">${G.file}<span><b class="mono">${esc(im.file)}</b><br><span class="muted">${thousands(im.bytes)} bytes, exported ${fDT(im.uploadedAt)} from LCMS-02. The PDF ${esc(im.pdf.file)} uploads with it.</span></span></button>
      </div>
      <button class="btn btn--primary btn--bench" data-act="upload-file">Upload this export</button>
      <button class="btn btn--bench btn--quiet" data-act="upload-cancel">Cancel</button>`;
    } else {
      body = `<p>The Run finished at ${fT(r.acquiredTo)} ${zone(r.acquiredTo)}. Export the Compound Summary from TargetLynx as TXT (with its PDF) and upload it here.</p>
      <p class="muted small">The worker parses the TXT into draft values and cross-checks them against the PDF. The drafts become your results only when you sign Performed.</p>
      <button class="btn btn--primary btn--bench" data-act="upload">Upload the TargetLynx export</button>`;
    }
    return `<div class="rail__body"><h2>Next step</h2><p class="muted small">Run ${r.id} on ${r.instrument}</p>${body}</div>`;
  }
  if (ws.signature) {
    const sig = ws.signature;
    return `<div class="rail__body"><h2>Signed Performed</h2>
      <p>${t.id} is <b>Submitted for Review</b>. A Reviewer signs Reviewed next; if anything is Returned you will see it here.</p>
      <div class="sig-mini">${G.sig} ${esc(sig.name)} (${esc(sig.username)}), ${fUTC(sig.at)}<br><span class="muted">Record Version ${sig.version}, SHA-256 ${sig.hash.slice(0, 8)}</span></div>
    </div>
    <div class="rail__foot"><button class="btn btn--bench" data-act="lock">${G.lock}Lock this PC</button><p class="muted small">Your session stays locked for the next person to switch user.</p></div>`;
  }
  const fl = FOCUS.results.find((x) => x.flags.length), f = fl.flags[0], h = ws.flag.handled;
  const flagHtml = h === null
    ? `<label class="field"><span class="field__label">Comment</span><textarea class="input input--area" id="flag-comment" data-in="flag-comment" placeholder="Why the value stands: what you checked in the chromatogram">${esc(ws.flag.comment)}</textarea><span class="field__hint">At least 10 characters. The comment is part of the signed record.</span></label>
       <button class="btn btn--primary btn--bench" data-act="flag-accept" id="flag-accept"${ws.flag.comment.trim().length < 10 ? ' disabled' : ''}>Accept with this comment</button>
       <button class="btn btn--bench" data-act="flag-reinject">Request a Reinjection</button>`
    : h === 'accepted'
      ? `<div class="done">${G.check}<span>Accepted with a comment: “${esc(ws.flag.comment)}”</span><button class="btn btn--quiet" data-act="flag-undo">Undo</button></div>`
      : `<div class="done">${G.check}<span>Reinjection of ${f.injection} requested. Signing Performed waits for the new injection.</span><button class="btn btn--quiet" data-act="flag-undo">Withdraw</button></div>`;
  const items = FOCUS.performedChecklist;
  const left = ws.checklist.filter((x) => !x).length;
  const missing = [];
  if (h === null) missing.push('handle the flag'); if (h === 'reinject') missing.push('the Reinjection is pending'); if (left) missing.push(`${left} of ${items.length} checklist items`);
  const ready = !missing.length;
  return `<div class="rail__body"><h2>Before you sign</h2>
    <section class="rc${h === 'accepted' ? ' is-done' : ''}"><h3>${G.flag}${h === null ? '1 flag to handle' : 'Flag handled'}</h3>
      <p><b>${fl.analyte}</b>, injection ${f.injection} (Preparation ${f.prep}): ${esc(f.kind)}. Peak Ratio ${f.found}, window ${f.window[0]}–${f.window[1]}. ${esc(f.detail)}.</p>
      ${flagHtml}</section>
    <section class="rc"><h3>Performed checklist</h3>
      ${items.map((it, i) => `<button class="chk" role="checkbox" aria-checked="${ws.checklist[i]}" data-act="chk-toggle" data-i="${i}" id="chk-${i}"><span class="chk__box">${ws.checklist[i] ? G.check : ''}</span><span>${esc(it)}</span></button>`).join('')}</section>
  </div>
  <div class="rail__foot">
    <button class="btn btn--primary btn--bench btn--sign" data-act="open-sign"${ready ? '' : ' disabled'}>${G.sig}Sign Performed</button>
    <p class="muted small">${ready ? 'Opens the signature prompt. Nothing is signed until you re-enter your user ID, password and a fresh code.' : `Not yet: ${missing.join('; ')}.`}</p>
  </div>`;
}

// ---------- checks ----------
const FIELD = { tempC: ['Temperature', '°C', 1], tempMinC: ['Minimum since reset', '°C', 1], tempMaxC: ['Maximum since reset', '°C', 1], rhPct: ['Relative humidity', '% RH', 0], resistivityMOhmCm: ['Resistivity', 'MΩ·cm', 1], tocPpb: ['TOC', 'ppb', 0] };
const baseField = (f) => (f === 'tempMinC' || f === 'tempMaxC' ? 'tempC' : f);
const ckView = (c) => { const s = S.ck.saved[c.id]; return s ? { ...c, status: 'Done', at: s.at, by: s.by, values: s.values, outcome: s.outcome, signature: s.signature, savedNote: s.note } : c; };
const targetOf = (c) => (c.targetKind === 'Room' ? ROOM[c.target] : E(c.target));
const isStorage = (c) => (c.targetKind === 'Room' ? ROOM[c.target].storage : /^(FRZ|CMB)/.test(c.target));
function consequenceText(c) {
  const tg = targetOf(c);
  if (c.targetKind === 'Room' && !tg.storage) return `Saving opens a Room Deviation for ${c.target} ${tg.name}.`;
  if (isStorage(c)) return `Saving opens an Excursion Deviation for ${c.target}${c.compartment ? ` (${c.compartment})` : ''} and refuses new placements in it until QA closes the Deviation. Removals stay allowed.`;
  if (/^DIW/.test(c.target)) return `Saving opens an Equipment Deviation for ${c.target} and suspends it.`;
  return `Saving opens a Deviation for ${c.target}.`;
}
function fieldState(c, f, raw) {
  const [label, unit] = FIELD[f];
  if (raw === '' || raw == null) return { kind: 'empty', msg: '' };
  const v = Number(raw); if (!Number.isFinite(v)) return { kind: 'invalid', msg: 'Enter a number.' };
  const lim = c.limits[baseField(f)], pl = c.plausible[baseField(f)];
  if (pl && (v < pl[0] || v > pl[1])) return { kind: 'implausible', msg: `${minus(raw)} ${unit} is outside the plausible range ${minus(pl[0])} to ${minus(pl[1])} ${unit}. Type it again to confirm.` };
  if (lim && (v < lim[0] || v > lim[1])) return { kind: 'out', msg: `${minus(raw)} ${unit} is ${v < lim[0] ? 'below' : 'above'} the limit ${minus(lim[0])} to ${minus(lim[1])} ${unit}. Type it again to confirm.` };
  return { kind: 'ok', msg: `Within limits ${minus(lim[0])} to ${minus(lim[1])} ${unit}.` };
}
function readingModel(c) {
  const vals = S.ck.values[c.id] || {}, conf = S.ck.confirm[c.id] || {};
  const fields = c.fields.filter((f) => f !== 'reset').map((f) => {
    const raw = vals[f] ?? '', state = fieldState(c, f, raw), needConfirm = state.kind === 'out' || state.kind === 'implausible';
    const confRaw = conf[f] ?? '', confOk = needConfirm && confRaw !== '' && Number(confRaw) === Number(raw);
    return { f, label: FIELD[f][0], unit: FIELD[f][1], raw, state, needConfirm, confRaw, confOk, valid: state.kind === 'ok' || (needConfirm && confOk) };
  });
  const out = fields.filter((x) => x.state.kind === 'out');
  return { fields, valid: fields.every((x) => x.valid), consequence: out.length ? consequenceText(c) : '', reset: vals.reset !== false };
}
function balanceModel(c) {
  const vals = S.ck.values[c.id] || {}, conf = S.ck.confirm[c.id] || {};
  const weights = c.weights.map((w, i) => {
    const raw = vals['r' + i] ?? '', v = Number(raw), filled = raw !== '' && Number.isFinite(v);
    const err = filled ? ((v - w.certifiedMg) / w.certifiedMg) * 100 : null;
    const implausible = filled && Math.abs(err) > (c.plausiblePct || 5);
    const pass = filled && !implausible && Math.abs(err) <= c.tolerancePct;
    const needConfirm = filled && !pass;
    const confRaw = conf['r' + i] ?? '', confOk = needConfirm && confRaw !== '' && Number(confRaw) === v;
    return { i, w, raw, filled, err, implausible, pass, needConfirm, confRaw, confOk, valid: filled && (pass || confOk) };
  });
  const allFilled = weights.every((x) => x.filled), fail = allFilled && weights.some((x) => !x.pass);
  return { weights, allFilled, fail, valid: weights.every((x) => x.valid) };
}
function ckValuesText(c) {
  const v = c.values;
  if (c.status === 'Done' && v) {
    if (v.readingsMg) { const m = c.weights.map((w, i) => ((v.readingsMg[i] - w.certifiedMg) / w.certifiedMg) * 100); const worst = m.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0); return `${c.outcome === 'fail' ? st('bad', 'Fail', G.stop) : st('ok', 'Pass', G.check)} <span class="muted">largest error ${signed(worst, 4)} % of ${c.tolerancePct} %</span>${c.savedNote ? `<div class="l2">${esc(c.savedNote)}</div>` : ''}`; }
    const parts = [];
    if (v.tempC != null) parts.push(`${num(v.tempC, 1)} °C${v.tempMinC != null ? ` (min ${num(v.tempMinC, 1)}, max ${num(v.tempMaxC, 1)})` : ''}`);
    if (v.rhPct != null) parts.push(`${num(v.rhPct, 0)} % RH`);
    if (v.resistivityMOhmCm != null) parts.push(`${num(v.resistivityMOhmCm, 1)} MΩ·cm`);
    if (v.tocPpb != null) parts.push(`${num(v.tocPpb, 0)} ppb TOC`);
    if (v.reset) parts.push('min/max reset');
    return `${parts.join(', ')}${c.outcome && c.outcome !== 'ok' ? `<div class="l2"><span class="st st--bad">${G.warn}<span>${esc(c.savedNote || '')}</span></span></div>` : ''}`;
  }
  const bits = [];
  if (c.last) bits.push(`Yesterday ${fT(c.last.at)}: ${num(c.last.tempC, 1)} °C (min ${num(c.last.tempMinC, 1)}, max ${num(c.last.tempMaxC, 1)})`);
  if (c.lastPass) bits.push(`Last passing Check ${fDT(c.lastPass)}; ${c.testsSinceLastPass} Tests weighed since`);
  if (c.note) bits.push(`<span class="st st--${c.status === 'Blocked' || c.status === 'Overdue' ? 'bad' : 'warn'}">${G.warn}<span>${esc(c.note)}</span></span>`);
  if (c.buffers) bits.push(`Buffers ${c.buffers.map((b) => b.toFixed(2)).join(', ')}`);
  return bits.join('<br>') || '<span class="muted">No value yet</span>';
}
function renderChecks() {
  const items = L.checksToday.map(ckView);
  const counts = {}; items.forEach((c) => (counts[c.status] = (counts[c.status] || 0) + 1));
  const groups = [['Rooms', (c) => c.targetKind === 'Room'], ['Storage units', (c) => /^(FRZ|CMB)/.test(c.target)], ['DI water', (c) => /^DIW/.test(c.target)], ['Balances', (c) => /^BAL/.test(c.target)], ['Pipettes and meters', (c) => /^(PIP|PH)/.test(c.target)]];
  const missed = L.missedChecks[0];
  const alarm = missed ? (S.ck.acked
    ? `<div class="alarm alarm--acked">${G.check}<div><span class="alarm__t">Missed reading acknowledged.</span> ${missed.target} ${esc(ROOM[missed.target].name)} had no daily reading on ${fDayFull(missed.day)}. Acknowledged by ${esc(S.user.username)} at ${fTs(S.ck.acked)} ${zone(S.ck.acked)}, recorded in the Audit Trail. The missed day stays on record.</div></div>`
    : `<div class="alarm" role="alert">${G.warn}<div><span class="alarm__t">Missed reading.</span> ${missed.target} ${esc(ROOM[missed.target].name)} had no daily reading on ${fDayFull(missed.day)}. Raised to ${missed.raisedTo.map((id) => esc(pname(id))).join(' and ')}; ${esc(missed.alarm.toLowerCase())}.</div><button class="btn btn--primary" data-act="ack-alarm">Acknowledge</button></div>`) : '';
  const list = groups.map(([g, fn]) => { const rows = items.filter(fn); return rows.length ? `<div class="ckgroup">${g}</div>${rows.map(ckRow).join('')}` : ''; }).join('');
  const sel = items.find((c) => c.id === S.ck.selected) || items.find((c) => c.status === 'Due');
  return `<main class="screen">
    <section class="ledger" aria-label="Today's Checks">
      <div class="shead"><div><h1>Today’s Checks</h1><p class="shead__sub">${labToday()}, Lab ${L.lab.id}. ${items.length} items: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')}. Readings are audited and unsigned; balance verifications sign Performed. Times are set by the server.</p></div></div>
      ${alarm}
      <div class="panel">${list}</div>
    </section>
    <aside class="rail" aria-label="Actions">${sel ? ckRail(sel) : ''}</aside>
  </main>`;
}
function ckRow(c) {
  const [k, g] = CKST[c.status], tg = targetOf(c);
  const name = `${esc(tg.name)}${c.compartment ? `, ${esc(c.compartment)}` : ''}`;
  const kind = c.type === 'Reading' ? `${c.schedule} reading` : `${c.schedule === 'Before first use each day' ? 'Daily' : c.schedule} verification`;
  const when = c.status === 'Done' ? `<div class="l1">${fT(c.at)} ${zone(c.at)}</div><div class="l2">${esc(pname(c.by))}</div>` : c.dueDate ? `<div class="l2">due ${fDayFull(c.dueDate)}</div>` : c.status === 'Due' ? `<div class="l2">today</div>` : '';
  return `<button class="ckrow" id="ck-${c.id}" data-act="select-check" data-id="${c.id}" aria-pressed="${S.ck.selected === c.id}">
    <span>${st(k, c.status, G[g])}</span>
    <span><div class="l1"><span class="id">${c.target}</span> ${name}</div>${c.targetKind === 'Equipment' && tg.fitness !== 'In use' ? `<div class="l2">${fitness(tg.fitness)}</div>` : ''}</span>
    <span><div class="l1">${kind}</div><div class="l2">${c.signed ? 'Signed Performed' : 'Audited, not signed'}</div></span>
    <span class="l1">${ckValuesText(c)}</span>
    <span>${when}</span>
  </button>`;
}
function keypad() {
  const keys = [['7'], ['8'], ['9'], ['⌫', 'back', 'Backspace'], ['4'], ['5'], ['6'], ['−', 'neg', 'Minus sign'], ['1'], ['2'], ['3'], ['.'], ['0'], ['00'], ['Clear', 'clear'], ['Next', 'next']];
  return `<div class="keypad" aria-label="Keypad">${keys.map(([k, act, label]) => `<button type="button" class="key${act === 'next' || act === 'clear' ? ' key--act' : ''}" data-act="key" data-k="${act || k}" aria-label="${label || k}" tabindex="-1">${k}</button>`).join('')}</div>`;
}
const serverTime = () => `<div class="server-time">${G.clock}<span>Time is set by the server when you save: now <b id="server-now">${fTs(nowIso())} ${zone(nowIso())}</b></span></div>`;
function ckRail(c) {
  const tg = targetOf(c);
  const head = `<h2>${c.target} <span class="shead__prod">${esc(tg.name)}${c.compartment ? `, ${esc(c.compartment)}` : ''}</span></h2>`;
  if (c.status === 'Done') {
    const v = c.values, isBal = !!v.readingsMg;
    let vals;
    if (isBal) vals = `<dl class="vals">${c.weights.map((w, i) => `<dt>${w.nominal}</dt><dd><b>${minus(String(v.readingsMg[i]))}</b> mg<br><span class="muted">error ${signed(((v.readingsMg[i] - w.certifiedMg) / w.certifiedMg) * 100, 4)} % of ±${c.tolerancePct} %</span></dd>`).join('')}</dl><div class="result result--${c.outcome === 'fail' ? 'fail' : 'pass'}"><div class="result__h">${c.outcome === 'fail' ? G.stop + 'Result: Fail' : G.check + 'Result: Pass'}</div></div>`;
    else vals = `<dl class="vals">${Object.entries(v).filter(([k]) => FIELD[k]).map(([k, x]) => `<dt>${FIELD[k][0]}</dt><dd><b>${num(x, FIELD[k][2])}</b> ${FIELD[k][1]}</dd>`).join('')}${'reset' in v ? `<dt>Min/max memory</dt><dd>${v.reset ? 'Reset after the reading' : 'Not reset'}</dd>` : ''}</dl>`;
    return `<div class="rail__body">${head}<p class="muted small">${c.type === 'Reading' ? 'Reading' : 'Verification'} done at ${fTs(c.at)} ${zone(c.at)} (server time) by ${esc(pname(c.by))}.</p>${vals}
      ${c.signature ? `<div class="sigblock" style="margin-top:12px"><div class="sigblock__title">${G.sig}Signed Performed</div><dt>By</dt><dd>${esc(c.signature.name)} (${esc(c.signature.username)}), ${esc(c.signature.role)}</dd><dt>Time</dt><dd>${fUTC(c.signature.at)}</dd><dt>Record</dt><dd>Version ${c.signature.version}, SHA-256 <span class="mono">${c.signature.hash.slice(0, 8)}</span></dd></div>` : c.signed ? `<div class="sig-mini" style="margin-top:12px">${G.sig} Signed Performed by ${esc(pname(c.by))}, ${fUTC(c.at)}</div>` : `<p class="muted small" style="margin-top:12px">Recorded in the Audit Trail; readings are not signed.</p>`}
      ${c.savedNote ? `<div class="consequence" style="margin-top:12px">${esc(c.savedNote)}</div>` : ''}
    </div>`;
  }
  if (c.status === 'Blocked') return `<div class="rail__body">${head}<p>${fitness(tg.fitness, tg.reason)}</p><p>${esc(c.note)}</p><p class="muted small">No Check can be entered on a Suspended balance. It returns to service only through the Deviation.</p></div>`;
  if (c.status === 'Not used today') return `<div class="rail__body">${head}<p>Not used today. The before-use verification with buffers ${c.buffers.map((b) => b.toFixed(2)).join(', ')} is only due when ${c.target} is used.</p><p class="muted small">If you use it today, verify it first; the result signs Performed like a balance Check.</p></div>`;
  if (/^PIP/.test(c.target)) return `<div class="rail__body">${head}<p>${c.schedule} gravimetric verification, ${c.status === 'Overdue' ? `overdue since ${fDayFull(c.dueDate)}` : `due ${fDayFull(c.dueDate)}`}.</p>${c.note ? `<p>${st('bad', c.note, G.warn)}</p>` : ''}<p class="muted small">Gravimetric verification is done in the balance room on BAL-01 and signed Performed there.</p></div>`;
  if (c.type === 'Reading') return readingForm(c);
  return balanceForm(c);
}
function readingForm(c) {
  const m = readingModel(c), tg = targetOf(c);
  const fieldHtml = (x) => `<div class="nf nf--${x.state.kind}" id="nf-${x.f}">
    <label class="nf__label" for="in-${x.f}"><span>${x.label}</span><span class="muted">limits ${minus(c.limits[baseField(x.f)][0])} to ${minus(c.limits[baseField(x.f)][1])} ${x.unit}</span></label>
    <div class="unit-wrap"><input class="input input--bench input--num" id="in-${x.f}" inputmode="decimal" autocomplete="off" data-in="ck" data-cid="${c.id}" data-f="${x.f}" value="${esc(x.raw)}"><span class="unit">${x.unit}</span></div>
    <div class="nf__msg" id="msg-${x.f}">${x.state.msg ? `${x.state.kind === 'ok' ? G.check : G.warn}<span>${x.state.msg}</span>` : ''}</div>
    <div class="nf__confirm" id="cf-${x.f}"${x.needConfirm ? '' : ' hidden'}><label for="cin-${x.f}">Type the ${x.label.toLowerCase()} again to confirm</label><div class="unit-wrap"><input class="input input--bench input--num${x.confOk ? ' is-ok' : ''}" id="cin-${x.f}" inputmode="decimal" autocomplete="off" data-in="ck-confirm" data-cid="${c.id}" data-f="${x.f}" value="${esc(x.confRaw)}"><span class="unit">${x.unit}</span></div><div class="nf__msg" id="cmsg-${x.f}">${x.confRaw && !x.confOk ? `${G.warn}<span>Does not match the value above. Check the display and type it again.</span>` : x.confOk ? `${G.check}<span>Confirmed.</span>` : ''}</div></div>
  </div>`;
  const intro = c.targetKind === 'Room' ? `Daily reading of the room thermohygrometer${tg.storage ? ', with the minimum and maximum since the last reset' : ''}.` : /^DIW/.test(c.target) ? 'Daily reading from the dispenser display.' : `Daily reading from the unit’s display: current, and the minimum and maximum since the last reset.${c.last ? ` Yesterday ${fT(c.last.at)}: ${num(c.last.tempC, 1)} °C (min ${num(c.last.tempMinC, 1)}, max ${num(c.last.tempMaxC, 1)}).` : ''}`;
  return `<div class="rail__body"><h2>${c.target} <span class="shead__prod">${esc(tg.name)}${c.compartment ? `, ${esc(c.compartment)}` : ''}</span></h2>
    <p class="small">${intro}${c.note ? ` ${st('bad', c.note, G.warn)}` : ''}</p>
    ${serverTime()}
    ${m.fields.map(fieldHtml).join('')}
    ${c.fields.includes('reset') ? `<button class="chk" role="checkbox" aria-checked="${m.reset}" data-act="ck-reset" data-cid="${c.id}" style="margin-top:8px"><span class="chk__box">${m.reset ? G.check : ''}</span><span>Reset the min/max memory after this reading</span></button>` : ''}
  </div>
  ${railFoot(`<div class="consequence" id="ck-consequence"${m.consequence ? '' : ' hidden'}><b>Out of limits.</b> ${m.consequence}</div>`,
    `<button class="btn btn--primary btn--bench" id="ck-save" data-act="ck-save" data-cid="${c.id}"${m.valid ? '' : ' disabled'}>Save reading</button>`,
    'Audit-trailed with your name and the server time; not signed.')}`;
}
const keypadOpen = () => (S.ck.keypad == null ? window.innerHeight >= 900 : S.ck.keypad);
function railFoot(before, save, note) {
  const kp = keypadOpen();
  return `<div class="rail__foot">${kp ? keypad() : ''}${before}${save}<div class="foot-row"><p class="muted small">${note}</p><button class="btn btn--quiet" data-act="keypad-toggle" aria-pressed="${kp}">${kp ? 'Hide keypad' : 'Show keypad'}</button></div></div>`;
}
function balanceForm(c) {
  const m = balanceModel(c), tg = targetOf(c);
  const wHtml = (x) => `<div class="wt nf nf--${x.filled ? (x.implausible ? 'implausible' : x.pass ? 'ok' : 'out') : 'empty'}" id="nf-r${x.i}">
    <div class="wt__h"><label for="in-r${x.i}"><b>${x.w.nominal}</b> check weight</label><span class="muted">certified ${num(x.w.certifiedMg, 4)} mg</span></div>
    <div class="unit-wrap" style="margin-top:6px"><input class="input input--bench input--num" id="in-r${x.i}" inputmode="decimal" autocomplete="off" data-in="ck" data-cid="${c.id}" data-f="r${x.i}" value="${esc(x.raw)}" aria-label="Reading for the ${x.w.nominal} weight in mg"><span class="unit">mg</span></div>
    <div class="wt__err nf__msg" id="msg-r${x.i}">${wErr(x, c)}</div>
    <div class="nf__confirm" id="cf-r${x.i}"${x.needConfirm ? '' : ' hidden'}><label for="cin-r${x.i}">Type the ${x.w.nominal} reading again to confirm</label><div class="unit-wrap"><input class="input input--bench input--num${x.confOk ? ' is-ok' : ''}" id="cin-r${x.i}" inputmode="decimal" autocomplete="off" data-in="ck-confirm" data-cid="${c.id}" data-f="r${x.i}" value="${esc(x.confRaw)}"><span class="unit">mg</span></div><div class="nf__msg" id="cmsg-r${x.i}">${x.confRaw && !x.confOk ? `${G.warn}<span>Does not match the reading above. Check the display and type it again.</span>` : x.confOk ? `${G.check}<span>Confirmed.</span>` : ''}</div></div>
  </div>`;
  return `<div class="rail__body"><h2>${c.target} <span class="shead__prod">${esc(tg.name)}</span></h2>
    <p class="small">Daily verification before first use with check weights CW-01 (OIML E2, certificate ${esc(EQ['CW-01'].certificate)}). Tolerance ±${c.tolerancePct} % of the certified value.</p>
    ${serverTime()}
    ${m.weights.map(wHtml).join('')}
  </div>
  ${railFoot(`<div class="result result--${m.allFilled ? (m.fail ? 'fail' : 'pass') : 'pending'}" id="ck-result">${resultText(m, c)}</div>`,
    `<button class="btn btn--primary btn--bench btn--sign" id="ck-save" data-act="ck-save-sign" data-cid="${c.id}"${m.valid ? '' : ' disabled'}>${G.sig}Save and sign Performed</button>`,
    'Opens the signature prompt; saved only when the signature succeeds.')}`;
}
const wErr = (x, c) => !x.filled ? '' : x.implausible ? `${G.warn}<span>Error ${signed(x.err, 2)} % is outside the plausible ±${c.plausiblePct || 5} %. Check the weight and the tare, then type it again to confirm.</span>` : x.pass ? `${G.check}<span>Error ${signed(x.err, 4)} %, within ±${c.tolerancePct} %. Pass.</span>` : `${G.stop}<span>Error ${signed(x.err, 4)} %, outside ±${c.tolerancePct} %. Fail. Type it again to confirm.</span>`;
const resultText = (m, c) => !m.allFilled ? `<div class="result__h">${G.dot}Result: enter both readings</div>` : m.fail ? `<div class="result__h">${G.stop}Result: Fail</div><div class="result__why">${balConsequence(c)}</div>` : `<div class="result__h">${G.check}Result: Pass</div><div class="result__why">Saving records a passed Check; ${c.target} stays In use today.</div>`;
const balConsequence = (c) => `Saving records a failed Check: it opens an Equipment Deviation for ${c.target}, suspends ${c.target}, and puts a Hold on each of the ${c.testsSinceLastPass ?? 0} Tests that cited ${c.target} since its last passing Check (${fDT(c.lastPass || nowIso())} ${zone(c.lastPass || nowIso())}).`;
function updateCheckForm(cid) {
  const c = CHECKS[cid]; if (!c) return;
  const setMsg = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  const setKind = (id, kind) => { const el = document.getElementById(id); if (el) el.className = el.className.replace(/nf--\w+/, `nf--${kind}`); };
  const confirmBox = (f, x) => { const cf = document.getElementById('cf-' + f); if (!cf) return; cf.hidden = !x.needConfirm; const ci = document.getElementById('cin-' + f); if (ci) ci.classList.toggle('is-ok', x.confOk); setMsg('cmsg-' + f, x.confRaw && !x.confOk ? `${G.warn}<span>Does not match the value above. Check the display and type it again.</span>` : x.confOk ? `${G.check}<span>Confirmed.</span>` : ''); };
  const save = document.getElementById('ck-save'), cons = document.getElementById('ck-consequence');
  if (c.type === 'Reading') {
    const m = readingModel(c);
    m.fields.forEach((x) => { setKind('nf-' + x.f, x.state.kind); setMsg('msg-' + x.f, x.state.msg ? `${x.state.kind === 'ok' ? G.check : G.warn}<span>${x.state.msg}</span>` : ''); confirmBox(x.f, x); });
    if (cons) { cons.hidden = !m.consequence; cons.innerHTML = `<b>Out of limits.</b> ${m.consequence}`; }
    if (save) save.disabled = !m.valid;
  } else {
    const m = balanceModel(c);
    m.weights.forEach((x) => { setKind('nf-r' + x.i, x.filled ? (x.implausible ? 'implausible' : x.pass ? 'ok' : 'out') : 'empty'); setMsg('msg-r' + x.i, wErr(x, c)); confirmBox('r' + x.i, x); });
    const res = document.getElementById('ck-result'); if (res) { res.className = `result result--${m.allFilled ? (m.fail ? 'fail' : 'pass') : 'pending'}`; res.innerHTML = resultText(m, c); }
    if (save) save.disabled = !m.valid;
  }
}

// ---------- signature prompt ----------
const attemptsLeft = (u) => LOCK_AFTER - (S.auth.fails[u] || 0);
async function sha256Hex(s) {
  if (!(window.crypto && crypto.subtle)) return null;
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function signRecord(d) {
  if (d.target === 'test') return { record: `Test ${FOCUS.testId} results`, version: FOCUS.recordVersion, hash: FOCUS.contentSha256, changes: `${FOCUS.testId} moves to Submitted for Review. Its ${FOCUS.injections.length} draft injections and ${FOCUS.results.length} Reportable Results become your results; the flag comment and the checklist are part of the record.` };
  const c = CHECKS[d.checkId], m = balanceModel(c);
  return { record: `Balance verification ${c.id} on ${c.target}`, version: 1, hash: d.hash, changes: m.fail ? `The Check is recorded as Failed: ${c.target} is suspended, an Equipment Deviation opens, and Holds go on the ${c.testsSinceLastPass} Tests that cited it since ${fDT(c.lastPass)}.` : `The Check is recorded as Passed; ${c.target} stays In use for today.` };
}
function signDialog(d) {
  const u = S.user, rec = signRecord(d), locked = S.auth.locked[u.username];
  return `<div class="scrim"><form class="dialog dialog--sign" data-act="sign-submit" role="dialog" aria-modal="true" aria-labelledby="sg-title" novalidate>
    <div class="dialog__h"><h2 id="sg-title">Electronic Signature</h2><p class="dialog__sub">Re-enter your credentials in full. The login session does not count.</p></div>
    <div class="dialog__b">
      <div class="signer"><div class="signer__lbl">You are signing as</div><div class="signer__name">${esc(u.name)}${u.nativeName ? ` <span class="who__native">${esc(u.nativeName)}</span>` : ''}</div><div class="signer__meta">${esc(u.username)}, ${esc(u.roles.join(' and '))}, Lab ${L.lab.id}</div></div>
      <dl class="facts facts--sig">
        <dt>Meaning</dt><dd><span class="meaning">Performed</span>: <span class="statement">“${esc(L.signatureMeanings.Performed)}”</span></dd>
        <dt>Record</dt><dd>${esc(rec.record)}, <b>Record Version ${rec.version}</b></dd>
        <dt>SHA-256</dt><dd class="mono" id="sg-hash">${rec.hash ? grp8(rec.hash) : 'computing…'}</dd>
        <dt>What changes</dt><dd>${esc(rec.changes)}</dd>
      </dl>
      <div class="sg-fields">
        <label class="field"><span class="field__label">User ID</span><input class="input" id="sg-user" data-in="sg" autocomplete="off" autocapitalize="off" spellcheck="false"${locked ? ' disabled' : ''}><span class="field__hint">Must be ${esc(u.username)}, the person signed in.</span></label>
        <label class="field"><span class="field__label">Password</span><input class="input" id="sg-pass" data-in="sg" type="password" autocomplete="current-password"${locked ? ' disabled' : ''}></label>
        <label class="field"><span class="field__label">Authenticator code</span><input class="input input--code" id="sg-code" data-in="sg" inputmode="numeric" maxlength="6" autocomplete="one-time-code"${locked ? ' disabled' : ''}><span class="field__hint">A fresh 6-digit code from your authenticator.</span></label>
      </div>
      <button type="button" class="btn btn--quiet" data-act="passkey" style="margin-top:8px">Use a passkey instead of the password and code</button>
      <p class="sg-error" id="sg-error" role="alert">${d.error ? `${G.stop}<span>${esc(d.error)}</span>` : ''}</p>
      <p class="demo">Demo credentials: password ${esc(L.demoCredentials.users[u.username]?.password || '')}, code ${esc(L.demoCredentials.users[u.username]?.totp || '')}. ${esc(L.demoCredentials.note)}</p>
    </div>
    <div class="dialog__f"><p class="muted small">Cancel signs nothing. ${attemptsLeft(u.username) < LOCK_AFTER && !locked ? `${attemptsLeft(u.username)} attempts left before the account locks.` : `${LOCK_AFTER} consecutive failures lock the account.`}</p><div class="dialog__btns"><button type="button" class="btn btn--bench btn--auto" data-act="sign-cancel">Cancel</button><button type="submit" class="btn btn--primary btn--bench btn--sign btn--auto" id="sg-submit" disabled>${G.sig}Sign Performed</button></div></div>
  </form></div>`;
}
function updateSignButton() {
  const b = $('#sg-submit'); if (!b) return;
  const filled = ['#sg-user', '#sg-pass', '#sg-code'].every((s) => ($(s)?.value || '').trim().length > 0);
  b.disabled = !filled || !!S.auth.locked[S.user.username];
}
function doSign(form) {
  const u = S.user, d = S.dlg, user = ($('#sg-user', form).value || '').trim(), pass = $('#sg-pass', form).value || '', code = ($('#sg-code', form).value || '').trim();
  if (S.auth.locked[u.username]) return;
  if (!user || !pass || !code) return;
  if (user !== u.username) { d.error = `The user ID must be ${u.username}: ${u.name} is signed in on this PC. Someone else must switch user first.`; renderOverlay(); return; }
  const cred = L.demoCredentials.users[u.username];
  if (!cred || cred.password !== pass || cred.totp !== code) {
    S.auth.fails[u.username] = (S.auth.fails[u.username] || 0) + 1;
    const left = attemptsLeft(u.username);
    if (left <= 0) { S.auth.locked[u.username] = true; d.error = `Account ${u.username} is locked after ${LOCK_AFTER} failed attempts. Nothing was signed. An Admin must unlock it.`; }
    else d.error = `Wrong password or code. ${left} ${left === 1 ? 'attempt' : 'attempts'} left before the account locks.`;
    renderOverlay(); return;
  }
  S.auth.fails[u.username] = 0;
  const at = nowIso(), rec = signRecord(d);
  const sig = { name: u.name, username: u.username, role: u.roles.join(', '), meaning: 'Performed', at, record: rec.record, version: rec.version, hash: rec.hash || '' };
  if (d.target === 'test') {
    S.ws.signature = sig;
    const t = T(TESTS[FOCUS.testId]);
    over.set(t.id, { state: 'Submitted for Review', history: [...t.history, { state: 'Submitted for Review', at, by: u.id }] });
    S.dlg = null;
    toast(`${G.check}<span>Signed Performed. ${t.id} is Submitted for Review; the signature block is on the record.</span>`);
    if (S.route === 'sign') location.hash = 'imported'; else render();
  } else {
    const c = CHECKS[d.checkId], m = balanceModel(c), fail = m.fail;
    let note = '';
    if (fail) {
      const devId = `DEV-26-00${S.ck.nextDev++}`; S.ck.holdsPlaced += c.testsSinceLastPass || 0;
      const worst = m.weights.reduce((a, x) => (Math.abs(x.err) > Math.abs(a.err) ? x : a));
      note = `${devId} opened (Equipment, Major); ${c.target} Suspended; Holds placed on ${c.testsSinceLastPass} Tests.`;
      eqOver.set(c.target, { fitness: 'Suspended', reason: `Failed daily verification ${fDay(at)}: ${worst.w.nominal} weight read ${signed(worst.err, 4)} % (limit ±${c.tolerancePct} %). ${devId}` });
    }
    S.ck.saved[c.id] = { at, by: u.id, values: { readingsMg: m.weights.map((x) => Number(x.raw)) }, outcome: fail ? 'fail' : 'pass', signature: sig, note };
    S.dlg = null;
    toast(`${fail ? G.warn : G.check}<span>${c.target} verification signed Performed and recorded as ${fail ? 'Failed' : 'Passed'} at ${fTs(at)} ${zone(at)}. ${note}</span>`);
    selectNextDue(c.id); render();
  }
}

// ---------- lock and switch user ----------
function lockDialog(d) {
  const prev = S.user, target = d.target && d.target !== 'other' ? P(d.target) : null;
  const personas = [L.personas.queue, L.personas.test, L.personas.checks].map(P);
  const cred = target ? L.demoCredentials.users[target.username] : null;
  const locked = d.mode === 'locked';
  const who = locked ? prev : target;
  const lockedOut = who && S.auth.locked[who.username];
  return `<div class="scrim scrim--lock"><form class="dialog dialog--lock" data-act="login-submit" role="dialog" aria-modal="true" aria-labelledby="lk-title" novalidate>
    <div class="lock__head">${locked ? G.lock : G.user}<div><h2 id="lk-title">${locked ? 'This PC is locked' : 'Switch user'}</h2><p>${locked ? `${esc(prev.name)}’s session locked${d.idle ? ` after ${IDLE_MIN} minutes idle` : ''}. Unlock it, or let someone else switch user.` : `${esc(prev.name)} is signed out of this PC. Anything they had not saved is not carried over.`}</p></div></div>
    <div class="lock__form">
      ${locked ? '' : `<div class="persons" role="radiogroup" aria-label="Who is signing in">${personas.map((p) => `<button type="button" class="person" role="radio" aria-checked="${d.target === p.id}" data-act="lk-pick" data-v="${p.id}"><span class="person__name">${esc(p.name)}${p.nativeName ? ` <span class="who__native">${esc(p.nativeName)}</span>` : ''}</span><span class="muted small">${esc(p.roles.join(', '))}, ${esc(p.username)}</span></button>`).join('')}<button type="button" class="person" role="radio" aria-checked="${d.target === 'other'}" data-act="lk-pick" data-v="other"><span class="person__name">Someone else</span><span class="muted small">Type your user ID</span></button></div>`}
      <div class="lock__fields">
        <label class="field"><span class="field__label">User ID</span><input class="input input--text" id="lk-user" autocomplete="username" autocapitalize="off" spellcheck="false" value="${esc(locked ? prev.username : target ? target.username : '')}"${locked ? ' readonly' : ''}></label>
        <label class="field"><span class="field__label">Password</span><input class="input input--text" id="lk-pass" type="password" autocomplete="current-password" value="${esc(d.prefill && (cred || locked) ? (locked ? L.demoCredentials.users[prev.username]?.password || '' : cred.password) : '')}"></label>
        <label class="field"><span class="field__label">Authenticator code</span><input class="input input--text input--code" id="lk-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" value="${esc(d.prefill && (cred || locked) ? (locked ? L.demoCredentials.users[prev.username]?.totp || '' : cred.totp) : '')}"></label>
      </div>
      <p class="sg-error" role="alert">${d.error ? `${G.stop}<span>${esc(d.error)}</span>` : ''}</p>
      <div class="lock__btns">${locked ? `<button type="button" class="btn btn--bench" data-act="lk-switch">${G.user}Switch user</button>` : d.route || d.fromNav ? `<button type="button" class="btn btn--bench" data-act="lk-cancel">Cancel</button>` : `<button type="button" class="btn btn--bench" data-act="lk-cancel">Cancel</button>`}<button type="submit" class="btn btn--primary btn--bench"${lockedOut ? ' disabled' : ''}>${locked ? `Unlock as ${esc(prev.name)}` : `Sign in${target ? ` as ${esc(target.name)}` : ''}`}</button></div>
      <p class="demo">Demo: the credentials are filled in for the three demo people (password ${esc(L.demoCredentials.users.praman.password)}; codes praman ${L.demoCredentials.users.praman.totp}, kwatanabe ${L.demoCredentials.users.kwatanabe.totp}, hkowalski ${L.demoCredentials.users.hkowalski.totp}). Fictional data.</p>
    </div>
  </form></div>`;
}
function doLogin(form) {
  const d = S.dlg, user = ($('#lk-user', form).value || '').trim(), pass = $('#lk-pass', form).value || '', code = ($('#lk-code', form).value || '').trim();
  const person = L.people.find((p) => p.username === user);
  const cred = person && L.demoCredentials.users[user];
  if (person && S.auth.locked[user]) { d.error = `Account ${user} is locked. An Admin must unlock it.`; renderOverlay(); return; }
  if (!person || !cred || cred.password !== pass || cred.totp !== code) {
    if (person) { S.auth.fails[user] = (S.auth.fails[user] || 0) + 1; if (attemptsLeft(user) <= 0) S.auth.locked[user] = true; }
    d.error = !person ? 'No account with that user ID in this Lab.' : S.auth.locked[user] ? `Account ${user} is locked after ${LOCK_AFTER} failed attempts. An Admin must unlock it.` : `Wrong password or code. ${attemptsLeft(user)} ${attemptsLeft(user) === 1 ? 'attempt' : 'attempts'} left before the account locks.`;
    renderOverlay(); return;
  }
  S.auth.fails[user] = 0;
  const switching = person.id !== S.user.id;
  if (switching) { S.ck.values = {}; S.ck.confirm = {}; S.q.selected = S.q.selected; }
  S.user = person; lastActive = Date.now();
  const route = d.route; S.dlg = null;
  if (route && route !== currentRoute()) location.hash = route; else if (route) enterRoute(); else render();
  if (switching) toast(`${G.user}<span>${esc(person.name)} signed in on this PC. The previous session was closed.</span>`);
}

// ---------- overlay, toast, render ----------
function renderDialog(d) { return d.kind === 'assign' ? assignDialog(d) : d.kind === 'sign' ? signDialog(d) : lockDialog(d); }
function renderOverlay() {
  const o = $('#overlay'), app = $('#app');
  o.innerHTML = S.dlg ? renderDialog(S.dlg) : '';
  app.inert = !!S.dlg;
  if (!S.dlg) return;
  if (S.dlg.kind === 'sign' && !S.dlg.hash && S.dlg.target === 'check') {
    const c = CHECKS[S.dlg.checkId], m = balanceModel(c);
    sha256Hex(JSON.stringify({ check: c.id, equipment: c.target, readingsMg: m.weights.map((x) => Number(x.raw)), by: S.user.username })).then((h) => { if (S.dlg && S.dlg.kind === 'sign') { S.dlg.hash = h || ''; const el = $('#sg-hash'); if (el) el.textContent = h ? grp8(h) : 'assigned by the server on save'; } });
  }
  const first = S.dlg.focus ? $(S.dlg.focus) : o.querySelector('[aria-checked="true"], input:not([readonly]):not([disabled])') || o.querySelector('button');
  if (first) first.focus({ preventScroll: true });
  S.dlg.focus = null;
}
function toast(html) {
  const el = $('#toast');
  el.innerHTML = `<span>${html}</span><button class="btn" data-act="toast-close" aria-label="Dismiss">${G.x}</button>`;
  el.classList.add('is-in');
  clearTimeout(S.toastTimer); S.toastTimer = setTimeout(() => el.classList.remove('is-in'), 9000);
}
const TITLES = { queue: 'Lab queue', assign: 'Assign a Test', test: 'Test workspace', imported: 'Test workspace', sign: 'Electronic Signature', checks: 'Today’s Checks', 'check-fail': 'Balance verification' };
function render() {
  const app = $('#app');
  const screen = S.route === 'queue' || S.route === 'assign' ? renderQueue() : S.route === 'checks' || S.route === 'check-fail' ? renderChecks() : renderWorkspace();
  app.innerHTML = renderTop() + screen;
  document.title = `${TITLES[S.route]}: ${L.lab.id} LIMS`;
  renderOverlay();
  if (S.focus) {
    const el = document.getElementById(S.focus);
    if (el && !S.dlg) {
      el.focus({ preventScroll: true });
      const rail = el.closest('.rail');
      if (S.focusScroll && rail) { const r = el.getBoundingClientRect(), rr = rail.getBoundingClientRect(); rail.scrollTop += r.top - rr.top - (rr.height - r.height) / 2; } // centre it in the rail's own scroller, never the page
    }
    S.focus = null; S.focusScroll = false;
  }
  tick();
}

// ---------- routing ----------
const currentRoute = () => { const h = location.hash.replace(/^#/, ''); return ROUTES.includes(h) ? h : 'queue'; };
function enterRoute() {
  const r = currentRoute(); S.route = r;
  const pid = PERSONA[r];
  if (!S.user || S.user.id !== pid) { S.user = P(pid); S.ck.values = {}; S.ck.confirm = {}; }
  S.dlg = null;
  if (r === 'assign') { S.q.selected = L.focus.assignTestId; const t = T(TESTS[S.q.selected]); if (t.state === 'Ready' || t.state === 'Assigned') S.dlg = { kind: 'assign', testId: S.q.selected, pick: null }; }
  if (r === 'imported' || r === 'sign') { S.ws.imported = true; S.ws.uploading = null; }
  if (r === 'sign') {
    if (S.ws.flag.handled !== 'accepted') S.ws.flag = { handled: 'accepted', comment: 'Identity confirmed: retention time 2.41 min on all four injections and S/N 64; the qualifier ratio is low on this one injection only.' };
    S.ws.checklist = [true, true, true];
    if (!S.ws.signature) S.dlg = { kind: 'sign', target: 'test' };
  }
  if (r === 'checks' && !S.ck.selected) S.ck.selected = 'CHK-RD-102';
  if (r === 'check-fail') { S.ck.selected = 'CHK-BAL-04'; const typed = L.focus.checkFail.typed.readingsMg; S.ck.values['CHK-BAL-04'] = { r0: String(typed[0]), r1: String(typed[1]) }; S.ck.confirm['CHK-BAL-04'] = {}; S.focus = 'cin-r1'; S.focusScroll = true; }
  render();
}
function go(r) {
  const pid = PERSONA[r];
  if (S.user && S.user.id !== pid) { S.dlg = { kind: 'lock', mode: 'switch', target: pid, route: r, prefill: true, fromNav: true }; renderOverlay(); return; }
  if (currentRoute() === r) enterRoute(); else location.hash = r;
}
function selectNextDue(afterId) {
  const items = L.checksToday.map(ckView), i = items.findIndex((c) => c.id === afterId);
  const next = [...items.slice(i + 1), ...items.slice(0, i)].find((c) => c.status === 'Due');
  S.ck.selected = next ? next.id : afterId;
}

// ---------- actions ----------
const A = {
  noop() {},
  go(el) { go(el.dataset.route); },
  lock() { S.dlg = { kind: 'lock', mode: 'locked', prefill: true }; renderOverlay(); },
  switch() { S.dlg = { kind: 'lock', mode: 'switch', target: null, prefill: true }; renderOverlay(); },
  'lk-pick'(el) { S.dlg.target = el.dataset.v; S.dlg.prefill = el.dataset.v !== 'other'; S.dlg.error = ''; S.dlg.focus = el.dataset.v === 'other' ? '#lk-user' : '#lk-pass'; renderOverlay(); },
  'lk-switch'() { S.dlg = { kind: 'lock', mode: 'switch', target: null, prefill: true }; renderOverlay(); },
  'lk-cancel'() { S.dlg = null; renderOverlay(); },
  'login-submit'(form) { doLogin(form); },
  'q-state'(el) { S.q.state = el.dataset.v; render(); },
  'q-quick'() { const on = S.q.state === 'Ready' && S.q.assignee === 'unassigned'; S.q.state = on ? '' : 'Ready'; S.q.assignee = on ? '' : 'unassigned'; render(); },
  'q-clear'() { Object.assign(S.q, { search: '', state: '', assignee: '', method: '', customer: '', gxp: '', holds: '', due: '' }); render(); },
  'q-sort'(el) { S.q.sort = el.dataset.v; render(); },
  'q-assignee'(el) { S.q.assignee = S.q.assignee === el.dataset.v ? '' : el.dataset.v; render(); },
  'select-test'(el) { S.q.selected = el.dataset.id; S.focus = 'row-' + el.dataset.id; render(); },
  'q-deselect'() { S.q.selected = null; render(); },
  'open-assign'() { S.dlg = { kind: 'assign', testId: S.q.selected, pick: null }; renderOverlay(); },
  'as-pick'(el) { S.dlg.pick = el.dataset.v; S.dlg.focus = '#pick-' + el.dataset.v; renderOverlay(); },
  'as-cancel'() { S.dlg = null; if (S.route === 'assign') location.hash = 'queue'; else renderOverlay(); },
  'as-confirm'() {
    const d = S.dlg; if (!d.pick) return;
    const t = T(TESTS[d.testId]), at = nowIso();
    over.set(t.id, { state: 'Assigned', assigneeId: d.pick, history: [...t.history, { state: 'Assigned', at, by: S.user.id }] });
    S.dlg = null; S.focus = 'row-' + t.id;
    toast(`${G.check}<span>${t.id} assigned to ${esc(pname(d.pick))}. Recorded in the Audit Trail at ${fUTC(at)} by ${esc(S.user.username)}.</span>`);
    if (S.route === 'assign') location.hash = 'queue'; else render();
  },
  upload() { S.ws.pickedFile = true; render(); },
  'upload-cancel'() { S.ws.pickedFile = false; render(); },
  'upload-file'() {
    S.ws.uploading = 0; render();
    const step = () => { if (S.ws.uploading == null) return; S.ws.uploading += 1; if (S.ws.uploading >= 3) { S.ws.uploading = null; S.ws.pickedFile = false; toast(`${G.check}<span>${esc(FOCUS.import.file)} imported: ${FOCUS.import.rowsForThisTest} draft rows for ${FOCUS.testId}, PDF cross-check ${FOCUS.import.pdf.crossCheck.mismatches} mismatches.</span>`); go('imported'); } else { render(); setTimeout(step, 450); } };
    setTimeout(step, 450);
  },
  'flag-accept'() { if (S.ws.flag.comment.trim().length < 10) return; S.ws.flag.handled = 'accepted'; render(); },
  'flag-reinject'() { S.ws.flag.handled = 'reinject'; render(); },
  'flag-undo'() { S.ws.flag.handled = null; render(); },
  'chk-toggle'(el) { const i = +el.dataset.i; S.ws.checklist[i] = !S.ws.checklist[i]; S.focus = el.id; render(); },
  'open-sign'() { go('sign'); },
  'sign-cancel'() { S.dlg = null; if (S.route === 'sign') location.hash = 'imported'; else renderOverlay(); },
  'sign-submit'(form) { doSign(form); },
  passkey() { if (S.dlg) { S.dlg.error = 'No passkey is registered for this account on this PC. Use your password and a fresh code.'; renderOverlay(); } },
  'select-check'(el) { S.ck.selected = el.dataset.id; S.focus = el.id; render(); },
  'ck-reset'(el) { const cid = el.dataset.cid; S.ck.values[cid] = S.ck.values[cid] || {}; S.ck.values[cid].reset = !(S.ck.values[cid].reset !== false); el.setAttribute('aria-checked', String(S.ck.values[cid].reset)); el.querySelector('.chk__box').innerHTML = S.ck.values[cid].reset ? G.check : ''; },
  'ck-save'(el) {
    const c = CHECKS[el.dataset.cid], m = readingModel(c); if (!m.valid) return;
    const at = nowIso(), values = {}; m.fields.forEach((x) => (values[x.f] = Number(x.raw))); if (c.fields.includes('reset')) values.reset = m.reset;
    let note = '', outcome = 'ok';
    if (m.consequence) {
      const devId = `DEV-26-00${S.ck.nextDev++}`;
      if (c.targetKind === 'Room' && !ROOM[c.target].storage) { outcome = 'room'; note = `${devId} opened (Room). Out of limits: ${m.fields.filter((x) => x.state.kind === 'out').map((x) => `${x.label.toLowerCase()} ${minus(x.raw)} ${x.unit}`).join(', ')}.`; }
      else if (isStorage(c)) { outcome = 'excursion'; note = `${devId} opened (Excursion). New placements in ${c.target} refused until QA closes it.`; if (c.targetKind === 'Equipment') eqOver.set(c.target, { fitness: 'Suspended', blocks: 'new placements', reason: `Excursion at the ${fDay(at)} reading. ${devId}` }); }
      else { outcome = 'deviation'; note = `${devId} opened (Equipment). ${c.target} suspended.`; eqOver.set(c.target, { fitness: 'Suspended', reason: `Out of limits at the ${fDay(at)} reading. ${devId}` }); }
    }
    S.ck.saved[c.id] = { at, by: S.user.id, values, outcome, note };
    toast(`${outcome === 'ok' ? G.check : G.warn}<span>${c.target} reading saved at ${fTs(at)} ${zone(at)} (server time), recorded in the Audit Trail. ${note}</span>`);
    selectNextDue(c.id); render();
  },
  'ck-save-sign'(el) { const c = CHECKS[el.dataset.cid], m = balanceModel(c); if (!m.valid) return; S.dlg = { kind: 'sign', target: 'check', checkId: c.id, hash: null }; renderOverlay(); },
  key(el) {
    const k = el.dataset.k, inputs = [...document.querySelectorAll('.rail input[data-in]')].filter((i) => i.offsetParent !== null);
    let target = document.getElementById(S.activeInput || '') ; if (!target || !inputs.includes(target)) target = inputs[0]; if (!target) return;
    if (k === 'next') { const i = inputs.indexOf(target); const n = inputs[(i + 1) % inputs.length]; n.focus(); S.activeInput = n.id; return; }
    let v = target.value;
    if (k === 'back') v = v.slice(0, -1); else if (k === 'clear') v = ''; else if (k === 'neg') v = v.startsWith('-') ? v.slice(1) : '-' + v; else if (k === '.') { if (!v.includes('.')) v += v === '' || v === '-' ? '0.' : '.'; } else v += k;
    target.value = v; target.focus({ preventScroll: true }); S.activeInput = target.id;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  },
  'keypad-toggle'() { S.ck.keypad = !keypadOpen(); render(); },
  'ack-alarm'() { S.ck.acked = nowIso(); toast(`${G.check}<span>Missed reading acknowledged at ${fTs(S.ck.acked)} ${zone(S.ck.acked)}, recorded in the Audit Trail.</span>`); render(); },
  'toast-close'() { $('#toast').classList.remove('is-in'); },
};
const INP = {
  'q-search'(el) { S.q.search = el.value; $('#q-tabs').innerHTML = qTabs(); $('#q-table').innerHTML = qTable(); },
  q(el) { S.q[el.dataset.key] = el.value; render(); },
  'flag-comment'(el) { S.ws.flag.comment = el.value; const b = $('#flag-accept'); if (b) b.disabled = el.value.trim().length < 10; },
  sg() { updateSignButton(); },
  ck(el) { const cid = el.dataset.cid; (S.ck.values[cid] = S.ck.values[cid] || {})[el.dataset.f] = el.value; updateCheckForm(cid); },
  'ck-confirm'(el) { const cid = el.dataset.cid; (S.ck.confirm[cid] = S.ck.confirm[cid] || {})[el.dataset.f] = el.value; updateCheckForm(cid); },
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el || el.tagName === 'FORM') return;
  if (el.tagName === 'BUTTON' && el.type === 'submit' && el.form) return; // a form's submit button goes through the submit event
  const fn = A[el.dataset.act]; if (fn) fn(el, e);
});
document.addEventListener('submit', (e) => { const f = e.target.closest('form[data-act]'); if (!f) return; e.preventDefault(); A[f.dataset.act]?.(f, e); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.dlg && S.dlg.kind !== 'lock') { (S.dlg.kind === 'assign' ? A['as-cancel'] : A['sign-cancel'])(); return; }
  if (e.key === 'Escape' && S.dlg && S.dlg.kind === 'lock' && S.dlg.mode === 'switch') { A['lk-cancel'](); return; }
  const row = e.target.closest('tr[data-act]'); if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); A[row.dataset.act](row, e); }
  if (e.key === 'Tab' && S.dlg) {
    const f = [...$('#overlay').querySelectorAll('button:not([disabled]), input:not([disabled]), textarea, select, [tabindex="0"]')].filter((x) => x.offsetParent !== null);
    if (!f.length) return; const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
document.addEventListener('input', (e) => { const el = e.target.closest('[data-in]'); if (el) INP[el.dataset.in]?.(el, e); });
document.addEventListener('change', (e) => { const el = e.target.closest('select[data-in]'); if (el) INP[el.dataset.in]?.(el, e); });
document.addEventListener('focusin', (e) => { const el = e.target; if (el.matches && el.matches('.rail input[data-in]')) S.activeInput = el.id; });
document.addEventListener('pointerdown', (e) => { if (e.target.closest('.key')) e.preventDefault(); });

// ---------- idle lock and clocks ----------
let lastActive = Date.now();
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true }));
function tick() {
  const left = IDLE_MIN * 60 - Math.floor((Date.now() - lastActive) / 1000);
  const el = $('#idle-left'); if (el) el.textContent = mmss(Math.max(0, left));
  const sn = $('#server-now'); if (sn) sn.textContent = `${fTs(nowIso())} ${zone(nowIso())}`;
  if (left <= 0 && !(S.dlg && S.dlg.kind === 'lock')) { S.dlg = { kind: 'lock', mode: 'locked', idle: true, prefill: true }; renderOverlay(); }
}
setInterval(tick, 1000);
window.addEventListener('hashchange', enterRoute);
enterRoute();
})();

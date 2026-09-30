'use strict';
/* Ledger & Rail · screens (Lab queue, Test workspace, Checks) and the sheets that rise from the rail. */

/* ======================================================================
   Records as the server would answer them, with this session's changes
   ====================================================================== */
function testNow(t) { const m = S.testMods[t.id]; return m ? { ...t, ...m, history: [...t.history, ...(m.historyAdd || [])] } : t; }
const openTests = () => L.tests.map(testNow).filter((t) => OPEN_STATES.includes(t.state));
const devById = (id) => DEVIATIONS[id] || S.devsAdded.find((d) => d.id === id);
const eqNow = (id) => ({ ...EQUIPMENT[id], ...(S.equipMods[id] || {}) });
const HAY = new Map();
function hay(t) {
  let s = HAY.get(t.id);
  if (!s) {
    const smp = SAMPLES[t.sampleId]; const p = PRODUCTS[t.productId]; const c = CUSTOMERS[t.customerId];
    s = [t.id, t.sampleId, t.submissionId, smp.lot, smp.customerRef, t.methodNumber, p.code, p.name, c.name, ...t.deviationIds, t.retestOf || '', smp.stability ? smp.stability.protocol : ''].join(' ').toLowerCase();
    HAY.set(t.id, s);
  }
  const who = t.assigneeId ? PEOPLE[t.assigneeId] : null;
  return who ? `${s} ${who.name.toLowerCase()} ${who.username}` : s;
}
function workload(tests) {
  const w = Object.fromEntries(ANALYSTS.map((a) => [a.id, { a: 0, ip: 0 }]));
  for (const t of tests) {
    if (!t.assigneeId || !w[t.assigneeId]) continue;
    if (t.state === 'Assigned') w[t.assigneeId].a++;
    else if (t.state === 'In Progress') w[t.assigneeId].ip++;
  }
  return w;
}
/* Assignment gate. For the focus Test this is the server's answer from the data; for any other Ready Test
   the same three rules are applied here (Training Record on the Method version, on the prerequisite, current Authorisation). */
function eligibilityFor(t) {
  if (t.id === L.focus.assignTestId) return L.focus.assignEligibility.map((e) => ({ id: e.personId, reasons: e.reasons }));
  const m = METHODS[t.methodId]; const pre = L.prerequisites;
  return ANALYSTS.map((a) => {
    const reasons = [];
    if (!L.trainingRecords.some((r) => r.personId === a.id && r.documentNumber === m.number && r.version === m.version)) reasons.push(`No Training Record on ${m.number} v${m.version} (Effective ${m.effectiveDate})`);
    if (!L.trainingRecords.some((r) => r.personId === a.id && r.documentNumber === pre.documentNumber && r.version === pre.version)) reasons.push(`No Training Record on ${pre.documentNumber} v${pre.version}`);
    const au = L.authorisations.find((x) => x.personId === a.id && x.meaning === 'Performed' && x.scope === m.number && x.lab === L.lab.id);
    if (!au) reasons.push(`No Performed Authorisation for ${m.number}`);
    else if (au.status === 'Suspended') reasons.push(`Performed Authorisation suspended (${au.suspendedBy})`);
    else if (au.validUntil < LAB_DAY) reasons.push(`Performed Authorisation expired ${au.validUntil}`);
    return { id: a.id, reasons };
  });
}

/* ======================================================================
   LAB QUEUE (#queue, #assign)
   ====================================================================== */
const SORTS = { urgency: 'Most urgent first', due: 'Due date', age: 'Longest in state', id: 'Test ID' };
function queueFilter(t, f, ignoreState) {
  if (!ignoreState && f.states.length && !f.states.includes(t.state)) return false;
  if (f.assignee === 'none' ? !!t.assigneeId : f.assignee && t.assigneeId !== f.assignee) return false;
  if (f.method && t.methodId !== f.method) return false;
  if (f.customer && t.customerId !== f.customer) return false;
  if (f.gxp && t.gxp !== f.gxp) return false;
  if (f.holds && !t.holds.length) return false;
  if (f.devs && !t.deviationIds.length) return false;
  if (f.overdue || f.atRisk) {
    const k = dueInfo(t).kind;
    if (!((f.overdue && k === 'overdue') || (f.atRisk && k === 'risk'))) return false;
  }
  if (f.search.trim() && !hay(t).includes(f.search.trim().toLowerCase())) return false;
  return true;
}
const anyFilter = (f) => !!(f.states.length || f.assignee || f.method || f.customer || f.gxp || f.holds || f.devs || f.overdue || f.atRisk || f.search.trim());
const RANK = { overdue: 0, risk: 1, ok: 2, none: 3 };
function sortRows(rows, sort) {
  const since = (t) => Date.parse(t.history.at(-1).at);
  const cmp = {
    urgency: (a, b) => RANK[dueInfo(a).kind] - RANK[dueInfo(b).kind] || (a.dueDate || '9').localeCompare(b.dueDate || '9') || a.id.localeCompare(b.id),
    due: (a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9') || a.id.localeCompare(b.id),
    age: (a, b) => since(a) - since(b),
    id: (a, b) => a.id.localeCompare(b.id),
  }[sort];
  return rows.sort(cmp);
}
function queueModel() {
  const f = S.q;
  const all = openTests();
  const base = all.filter((t) => queueFilter(t, f, true));
  const rows = sortRows(f.states.length ? base.filter((t) => f.states.includes(t.state)) : base.slice(), f.sort);
  const perState = Object.fromEntries(OPEN_STATES.map((s) => [s, 0]));
  base.forEach((t) => perState[t.state]++);
  const kinds = all.map((t) => dueInfo(t).kind);
  const totals = {
    open: all.length,
    ready: all.filter((t) => t.state === 'Ready').length,
    unassigned: all.filter((t) => !t.assigneeId).length,
    holds: all.filter((t) => t.holds.length).length,
    devs: all.filter((t) => t.deviationIds.length).length,
    overdue: kinds.filter((k) => k === 'overdue').length,
    risk: kinds.filter((k) => k === 'risk').length,
  };
  return { all, rows, perState, totals };
}

function queueScreen() {
  const f = S.q;
  const { all, rows, perState, totals } = queueModel();
  S.qRows = rows.map((t) => t.id);
  return h`<div class="q-screen">
    <section class="q-head">
      <div class="q-title"><h1>Lab queue</h1><p class="q-sub"><b>${totals.open}</b> open Tests</p><p class="q-sub"><b>${totals.overdue}</b> overdue · <b>${totals.holds}</b> held</p></div>
      <div class="pipeline" id="q-pipeline" role="group" aria-label="Open Tests per state. Press a state to filter.">${pipeline(perState, f)}</div>
    </section>
    <div id="q-workload">${workloadBand(all, f, totals)}</div>
    ${filterBar(f, totals)}
    <div class="table-wrap" id="q-wrap">${queueTable(rows)}</div>
  </div>`;
}
function pipeline(perState, f) {
  return OPEN_STATES.map((s) => h`<button type="button" class="seg${s === 'Ready' ? ' ready' : ''}" style="flex-grow:${Math.max(perState[s], 6)}" data-act="q-state" data-arg="${s}" data-k="seg-${slug(s)}" aria-pressed="${tf(f.states.includes(s))}">
    <span class="seg-top">${pips(s)}<span class="seg-n">${perState[s]}</span></span><span class="seg-name">${s}${s === 'Ready' ? h`<small> · to assign</small>` : ''}</span></button>`);
}
function workloadBand(all, f, totals) {
  const w = workload(all);
  const max = Math.max(12, ...Object.values(w).map((x) => x.a + x.ip));
  return h`<section class="workload" aria-label="Workload per Analyst, Assigned plus In Progress. Press an Analyst to filter the queue.">
    <div class="wl-label"><b>Workload</b><span>Assigned + In Progress</span><span class="wl-key"><i class="k-ip"></i>In Progress <i class="k-as"></i>Assigned</span></div>
    <button type="button" class="wl-un" data-act="q-assignee" data-arg="none" data-k="wl-none" aria-pressed="${tf(f.assignee === 'none')}"><span class="wl-un-n">${totals.unassigned}</span><span>Unassigned</span></button>
    <div class="wl-bars">${ANALYSTS.map((a) => {
      const x = w[a.id]; const n = x.a + x.ip;
      return h`<button type="button" class="wl" data-act="q-assignee" data-arg="${a.id}" data-k="wl-${a.id}" aria-pressed="${tf(f.assignee === a.id)}" title="${a.name}: ${x.a} Assigned, ${x.ip} In Progress" aria-label="${a.name}: ${n} open, ${x.a} Assigned and ${x.ip} In Progress"><span class="wl-n">${n}</span><span class="wl-bar"><i class="ip" style="height:${(x.ip / max) * 100}%"></i><i class="as" style="height:${(x.a / max) * 100}%"></i></span><span class="wl-name">${firstName(a)}</span></button>`;
    })}</div>
  </section>`;
}
function filterBar(f, totals) {
  const chip = (key, ic, label, n, title = '') => h`<button type="button" class="chip" data-act="q-chip" data-arg="${key}" data-k="chip-${key}" aria-pressed="${tf(f[key])}"${title ? raw(` title="${esc(title)}"`) : ''}>${icon(ic)}${label} <b>${n}</b></button>`;
  return h`<section class="filters" aria-label="Filters">
    <label class="search">${icon('search')}<span class="sr">Search any ID</span><input id="q-search" type="search" placeholder="Search any ID: Test, Sample, Lot, DEV…" value="${f.search}" autocomplete="off" spellcheck="false"></label>
    <label class="sel"><span class="sr">Method</span><select id="q-method"><option value="">All Methods</option>${L.methods.map((m) => h`<option value="${m.id}"${f.method === m.id ? raw(' selected') : ''}>${m.number} v${m.version} · ${m.title}</option>`)}</select></label>
    <label class="sel"><span class="sr">Customer</span><select id="q-customer"><option value="">All Customers</option>${L.customers.map((c) => h`<option value="${c.id}"${f.customer === c.id ? raw(' selected') : ''}>${c.name}</option>`)}</select></label>
    <div class="segctl" role="group" aria-label="GxP Class">${['', 'GMP', 'non-GMP'].map((g) => h`<button type="button" data-act="q-gxp" data-arg="${g}" data-k="gxp-${g || 'all'}" aria-pressed="${tf(f.gxp === g)}">${g || 'All'}</button>`)}</div>
    ${chip('holds', 'hold', 'Holds', totals.holds)}
    ${chip('devs', 'dev', 'Deviations', totals.devs)}
    ${chip('overdue', 'alarm', 'Overdue', totals.overdue)}
    ${chip('atRisk', 'clock', 'At risk', totals.risk, 'Due within 2 business days and not yet Reviewed')}
    <label class="sel sort"><span class="sr">Sort</span><select id="q-sort">${Object.entries(SORTS).map(([k, v]) => h`<option value="${k}"${f.sort === k ? raw(' selected') : ''}>${v}</option>`)}</select></label>
    <button type="button" class="clear" data-act="q-clear" data-k="q-clear"${anyFilter(f) ? '' : raw(' disabled')}>Clear</button>
  </section>`;
}
function queueTable(rows) {
  return h`<table class="ledger qt" role="grid" aria-label="Open Tests, ${rows.length} shown" aria-rowcount="${rows.length + 1}">
    <colgroup><col class="c-test"><col class="c-cust"><col class="c-meth"><col class="c-gxp"><col class="c-state"><col class="c-due"><col class="c-who"><col class="c-hold"><col class="c-dev"></colgroup>
    <thead><tr><th scope="col">Test · Sample</th><th scope="col">Customer · Product · Lot</th><th scope="col">Method</th><th scope="col">GxP · service</th><th scope="col">State · time in it</th><th scope="col">Due</th><th scope="col">Assignee</th><th scope="col">Holds</th><th scope="col">Deviations</th></tr></thead>
    <tbody id="q-body">${queueRows(rows)}</tbody>
  </table>
  <p class="q-foot"><b id="q-shown">${rows.length}</b> of ${openTests().length} open Tests shown${anyFilter(S.q) ? ' (filtered)' : ''} · ${SORTS[S.q.sort].toLowerCase()} · select a row, then act in the rail below</p>`;
}
function queueRows(rows) {
  if (!rows.length) return h`<tr><td colspan="9" class="empty">No open Tests match these filters.</td></tr>`;
  const focusId = S.q.selected && rows.some((t) => t.id === S.q.selected) ? S.q.selected : rows[0].id;
  return rows.map((t) => queueRow(t, t.id === focusId));
}
function queueRow(t, tabStop) {
  const s = SAMPLES[t.sampleId]; const p = PRODUCTS[t.productId]; const c = CUSTOMERS[t.customerId]; const m = METHODS[t.methodId];
  const d = dueInfo(t);
  const who = t.assigneeId ? PEOPLE[t.assigneeId] : null;
  const devs = t.deviationIds.map(devById);
  const sel = S.q.selected === t.id;
  return h`<tr class="row due-${d.kind}${t.holds.length ? ' held' : ''}${S.flash === t.id ? ' flash' : ''}" data-id="${t.id}" data-act="q-row" tabindex="${tabStop ? 0 : -1}" aria-selected="${tf(sel)}">
    <td><span class="l1"><b class="mono">${t.id}</b>${t.source === 'Stability Pull' ? h` <span class="mini" title="Stability Pull ${s.stability ? `${s.stability.protocol} ${s.stability.timePoint}` : ''}">Pull</span>` : ''}${t.retestOf ? h` <span class="mini" title="Retest of ${t.retestOf}">Retest</span>` : ''}</span><span class="l2 mono">${t.sampleId}</span></td>
    <td><span class="l1" title="${c.name}">${c.name}</span><span class="l2">${p.name} · <span class="mono">${s.lot}</span></span></td>
    <td><span class="l1 mono">${m.number} v${t.methodVersion}</span><span class="l2" title="${m.title}">${m.title}</span></td>
    <td><span class="l1">${gxpTag(t.gxp)}</span><span class="l2">${serviceTag(t.serviceLevel)}</span></td>
    <td><span class="l1 b">${t.state}</span><span class="l2 state-l2">${pips(t.state)}${fmtDuration(nowMs() - Date.parse(t.history.at(-1).at))}</span></td>
    <td><span class="l1${d.kind === 'overdue' ? ' bad-ink b' : ''}">${t.dueDate ? fmtDate(t.dueDate, true) : '—'}</span><span class="l2">${dueTag(t)}</span></td>
    <td>${who
      ? h`<span class="l1">${who.name}</span><span class="l2">${{ Assigned: 'not started', 'In Progress': 'working', 'Submitted for Review': 'awaiting Reviewer', Reviewed: 'awaiting QA release' }[t.state] || ''}</span>`
      : h`<span class="l1 muted i">Unassigned</span><span class="l2">${t.state === 'Ready' ? h`<b class="act-ink">Ready to assign</b>` : 'not Ready yet'}</span>`}</td>
    <td>${t.holds.length
      ? h`<span class="l1">${holdTag(t.holds.length)}</span><span class="l2" title="${t.holds.map((x) => `${x.kind}: ${x.reason} (blocks ${x.blocks})`).join('\n')}">${t.holds.map((x) => x.kind).join(' + ')}</span>`
      : h`<span class="l1 muted">—</span>`}</td>
    <td>${devs.length
      ? h`<span class="l1">${devTag(devs[0])}${devs.length > 1 ? h` <span class="mini">+${devs.length - 1}</span>` : ''}</span><span class="l2">${devs[0].kind} · ${devs[0].risk}</span>`
      : h`<span class="l1 muted">—</span>`}</td>
  </tr>`;
}
function queueRail() {
  const ready = openTests().filter((x) => x.state === 'Ready');
  const next = rows0(ready);
  const t = S.q.selected ? testNow(TESTS[S.q.selected]) : null;
  const nextBtn = rbtn({ act: 'q-assign-next', label: 'Assign next Ready Test', sub: next ? `${next.id} · most urgent of ${ready.length}` : 'none Ready', ic: 'arrow', kind: 'primary', disabled: !next });
  if (!t) return { context: h`<span class="ctx-line">Select a Test in the queue to see its Holds and act on it.</span><span class="ctx-line"><b>${ready.length}</b> Tests are Ready to assign.</span>`, actions: [nextBtn] };
  const d = dueInfo(t);
  const context = h`<span class="ctx-line"><b class="mono">${t.id}</b> · ${t.state} · ${CUSTOMERS[t.customerId].name} · ${t.dueDate ? h`due ${fmtDate(t.dueDate, true)}${d.kind === 'overdue' ? h` · <b class="ctx-bad">overdue ${d.late} d</b>` : ''}` : 'due date set when Ready'}</span>
    ${t.holds.length ? t.holds.map((x) => h`<span class="ctx-line ctx-hold">${icon('hold')}<span><b>Hold · ${x.kind}:</b> ${x.reason}. Blocks ${x.blocks}.${x.deviationId ? ` ${x.deviationId}.` : ''}</span></span>`) : h`<span class="ctx-line">No open Holds${t.deviationIds.length ? ` · linked ${t.deviationIds.join(', ')}` : ''}</span>`}`;
  const actions = [rbtn({ act: 'q-details', label: 'Details', ic: 'info', k: 'q-details' })];
  actions.push(t.state === 'Ready' ? rbtn({ act: 'q-assign', label: `Assign ${t.id}`, sub: 'choose an Analyst', ic: 'arrow', kind: 'primary', k: 'q-assign' }) : nextBtn);
  return { context, actions };
}
const rows0 = (ready) => sortRows(ready.slice(), 'urgency')[0];

/* ---------- Assignment sheet (#assign) ---------- */
function assignSheet(sh) {
  const t = testNow(TESTS[sh.testId]);
  const m = METHODS[t.methodId]; const s = SAMPLES[t.sampleId]; const p = PRODUCTS[t.productId]; const c = CUSTOMERS[t.customerId];
  const w = workload(openTests());
  const elig = eligibilityFor(t).map((e) => ({ ...e, p: PEOPLE[e.id], load: w[e.id] }));
  const ok = elig.filter((e) => !e.reasons.length).sort((a, b) => (a.load.a + a.load.ip) - (b.load.a + b.load.ip) || a.p.name.localeCompare(b.p.name));
  const no = elig.filter((e) => e.reasons.length).sort((a, b) => a.p.name.localeCompare(b.p.name));
  const max = Math.max(12, ...elig.map((e) => e.load.a + e.load.ip));
  const chosen = sh.choice ? PEOPLE[sh.choice] : null;
  const readyAt = t.history.find((x) => x.state === 'Ready');
  const body = h`<header class="sheet-head">
      <p class="overline">${icon('audit')} Assignment · audited, not signed · Lab Manager only</p>
      <div class="title-row"><h2 id="sheet-title" tabindex="-1">Assign <span class="mono">${t.id}</span> to an Analyst</h2>
        <div class="facts-row">${gxpTag(t.gxp)}${serviceTag(t.serviceLevel)}<span>${stateTag(t.state)} <span class="muted">since ${readyAt ? fmtLocal(readyAt.at) : '—'}</span></span><span>Due <b>${fmtDate(t.dueDate, true)}</b> ${dueTag(t)}</span></div></div>
      <p class="sheet-sub"><span class="mono">${s.id}</span> · ${c.name} · ${p.name} <span class="muted">(${p.code})</span> · Lot <span class="mono">${s.lot}</span> · <span class="mono b">${m.number} v${t.methodVersion}</span> ${m.title}</p>
    </header>
    <p class="rule-box">${icon('info')}<span>Refused without a Training Record on <b class="mono">${m.number} v${m.version}</b>, a Training Record on <b class="mono">${L.prerequisites.documentNumber} v${L.prerequisites.version}</b> and a current Performed Authorisation for <b class="mono">${m.number}</b> in ${L.lab.id}. <b>No override.</b></span></p>
    <h3 class="pick-h">${icon('check')} Eligible · ${ok.length} <small>fewest open Tests first · bar: <i class="k-ip"></i> In Progress <i class="k-as"></i> Assigned</small></h3>
    <div class="pick-grid" role="radiogroup" aria-label="Eligible Analysts">${ok.map((e) => {
      const n = e.load.a + e.load.ip;
      return h`<button type="button" role="radio" class="pick" aria-checked="${tf(sh.choice === e.id)}" data-act="assign-pick" data-arg="${e.id}" data-k="pick-${e.id}" title="${e.p.name}: ${e.load.a} Assigned, ${e.load.ip} In Progress" aria-label="${e.p.name}, eligible, ${n} open: ${e.load.a} Assigned and ${e.load.ip} In Progress">
        <span class="pick-radio" aria-hidden="true"></span>
        <span class="pick-main"><span class="pick-name">${e.p.name}${nativeName(e.p)}</span><span class="pick-load"><span class="loadbar" aria-hidden="true"><i class="ip" style="width:${(e.load.ip / max) * 100}%"></i><i class="as" style="width:${(e.load.a / max) * 100}%"></i></span><b>${n}</b> open <span class="muted">· ${e.load.ip} in progress</span></span></span>
      </button>`;
    })}</div>
    <h3 class="pick-h refused-h">${icon('slash')} Refused · ${no.length} <small>cannot be chosen</small></h3>
    <ul class="refused-grid" aria-label="Refused Analysts">${no.map((e) => h`<li class="refused"><span class="ref-top"><span class="pick-name">${e.p.name}${nativeName(e.p)}</span><span class="muted small">${e.load.a + e.load.ip} open</span></span>${e.reasons.map((r) => h`<span class="why">${icon('cross')}<span>${r}</span></span>`)}</li>`)}</ul>`;
  return sheetFrame({
    cls: 'assign-sheet',
    body,
    context: chosen ? h`<span class="ctx-line">Assign <b class="mono">${t.id}</b> to <b>${chosen.name}</b>. The Test moves to Assigned; the Audit Trail records it under your name.</span>` : h`<span class="ctx-line">Choose one of the ${ok.length} eligible Analysts. Refused ones say why.</span>`,
    actions: [
      rbtn({ act: 'sheet-cancel', label: 'Cancel', k: 'assign-cancel' }),
      rbtn({ act: 'assign-confirm', label: chosen ? `Assign to ${chosen.name}` : 'Assign', ic: 'arrow', kind: 'primary', disabled: !chosen, k: 'assign-confirm' }),
    ],
  });
}

/* ---------- Test details sheet (Holds and Deviations on demand) ---------- */
function detailsSheet(sh) {
  const t = testNow(TESTS[sh.testId]);
  const m = METHODS[t.methodId]; const s = SAMPLES[t.sampleId]; const p = PRODUCTS[t.productId]; const c = CUSTOMERS[t.customerId];
  const sub = SUBMISSIONS[t.submissionId];
  const body = h`<header class="sheet-head">
      <p class="overline">Test details</p>
      <h2 id="sheet-title" tabindex="-1"><span class="mono">${t.id}</span> ${stateTag(t.state)} ${gxpTag(t.gxp)} ${serviceTag(t.serviceLevel)}</h2>
      <p class="sheet-sub">Due <b>${t.dueDate ? fmtDate(t.dueDate, true) : 'not set'}</b> ${dueTag(t)} · ${t.assigneeId ? `Assignee ${PEOPLE[t.assigneeId].name}` : 'Unassigned'}</p>
    </header>
    <div class="details-grid">
      <section class="card"><h3 class="card-h">Sample and request</h3><dl class="kv">
        <dt>Sample</dt><dd class="mono">${s.id}</dd><dt>Customer</dt><dd>${c.name}</dd><dt>Product</dt><dd>${p.name} <span class="muted">(${p.code}, ${p.kind})</span></dd>
        <dt>Lot</dt><dd class="mono">${s.lot}</dd><dt>Storage</dt><dd>${s.storage}</dd><dt>Received</dt><dd>${s.receivedAt ? fmtLocal(s.receivedAt) : 'not yet'}</dd>
        <dt>Submission</dt><dd><span class="mono">${sub.id}</span> · ${sub.via}</dd>${s.stability ? h`<dt>Stability Pull</dt><dd>${s.stability.protocol} · ${s.stability.condition} · ${s.stability.timePoint}</dd>` : ''}
        <dt>Method</dt><dd><span class="mono">${m.number} v${t.methodVersion}</span> ${m.title}</dd>${t.nonGmpReason ? h`<dt>non-GMP reason</dt><dd>${t.nonGmpReason}</dd>` : ''}
      </dl></section>
      <section class="card"><h3 class="card-h">${icon('hold')} Holds · ${t.holds.length}</h3>${t.holds.length ? t.holds.map((x) => h`<div class="hold-item"><p><span class="tag hold">${icon('hold')}${x.kind}</span></p><p>${x.reason}</p><dl class="kv small"><dt>Blocks</dt><dd>${x.blocks}</dd><dt>Opened</dt><dd>${fmtLocal(x.openedAt)}</dd>${x.deviationId ? h`<dt>Deviation</dt><dd class="mono">${x.deviationId}</dd>` : ''}${x.releasedBy ? h`<dt>Released by</dt><dd>${x.releasedBy}</dd>` : ''}${x.causedByCustomer ? h`<dt>Waiting on</dt><dd>the Customer</dd>` : ''}</dl></div>`) : h`<p class="muted">No open Holds. The state is not changed by a Hold; it only blocks named steps.</p>`}
        <h3 class="card-h">${icon('dev')} Deviations · ${t.deviationIds.length}</h3>${t.deviationIds.length ? t.deviationIds.map(devById).map((d) => h`<div class="hold-item"><p>${devTag(d)} ${riskTag(d.risk)} <span class="tag neutral">${d.state}</span></p><p>${d.kind}: ${d.title}</p><p class="small muted">Investigator ${PEOPLE[d.investigatorId].name} · due ${fmtDate(d.dueDate, true)}</p></div>`) : h`<p class="muted">None linked.</p>`}
      </section>
      <section class="card"><h3 class="card-h">History</h3><ol class="history">${t.history.map((e) => h`<li>${stateTag(e.state)}<span class="mono small">${fmtLocal(e.at)}</span><span class="small">${e.by ? PEOPLE[e.by].name : 'system'}</span></li>`)}</ol></section>
    </div>`;
  const actions = [rbtn({ act: 'sheet-cancel', label: 'Close', k: 'details-close' })];
  if (t.state === 'Ready') actions.push(rbtn({ act: 'q-assign', label: `Assign ${t.id}`, ic: 'arrow', kind: 'primary' }));
  return sheetFrame({ cls: 'details-sheet', body, context: h`<span class="ctx-line">Read-only. Holds and Deviations change in their own records.</span>`, actions });
}

/* ======================================================================
   TEST WORKSPACE (#test, #imported, #sign)
   ====================================================================== */
const benchTest = () => testNow(TESTS[FOCUS.testId]);
function benchGates() {
  const b = S.bench;
  const flagOk = !!b.flag && b.flag.decision === 'accept';
  const reinject = !!b.flag && b.flag.decision === 'reinject';
  const integOk = b.integrations === 'none' || (b.integrations === 'some' && b.integrationsText.trim().length >= 8);
  const matchOk = !!b.injectionsMatch;
  return { flagHandled: !!b.flag, flagOk, reinject, integOk, matchOk, left: [!flagOk, !integOk, !matchOk].filter(Boolean).length, ready: flagOk && integOk && matchOk };
}
function fitnessBasis(id) {
  const e = eqNow(id);
  if (e.reason) return e.reason;
  const chk = L.checksToday.find((c) => c.target === id);
  const st = chk && (S.checkState[chk.id] || chk);
  if (st && st.status === 'Done' && st.at) return `${chk.type === 'Reading' ? 'reading' : 'daily Check'} passed today ${fmtTime(st.at)} ${ZONE}`;
  return e.nextDue ? `next Check due ${fmtDate(e.nextDue)}${e.nextDue.slice(0, 4) !== LAB_DAY.slice(0, 4) ? ` ${e.nextDue.slice(0, 4)}` : ''}` : 'approved into service';
}
const eqRef = (id) => { const e = eqNow(id); const [cls, ic] = FITNESS[e.fitness]; return h`<span class="eqref"><span class="mono">${id}</span><span class="fit-dot ${cls}" title="${e.fitness}: ${fitnessBasis(id)}">${icon(ic)}</span></span>`; };

const solRef = (id) => { const x = FOCUS.run.solutions.find((y) => y.id === id); const [cls, ic] = FITNESS[x ? x.fitness : 'In use']; return h`<span class="eqref"><span class="mono">${id}</span><span class="fit-dot ${cls}" title="${x ? `${x.fitness}: ${x.what}, expires ${fmtDate(x.expires)}` : ''}">${icon(ic)}</span></span>`; };

function workspaceScreen() {
  const t = benchTest();
  return h`<div class="ws">${wsHead(t)}${S.bench.imported ? importedBody(t) : preImportBody(t)}</div>`;
}
function wsHead(t) {
  const s = SAMPLES[t.sampleId]; const p = PRODUCTS[t.productId]; const c = CUSTOMERS[t.customerId]; const m = METHODS[t.methodId];
  const b = S.bench;
  const assigned = t.history.find((x) => x.state === 'Assigned');
  const steps = [
    ['Preparations', `${FOCUS.preparations.length} entered, Verified`, 'done'],
    ['Run', 'acquired 29 Sep', 'done'],
    ['Import', b.imported ? `TXT + PDF, ${fmtTime(b.importedAt)} ${ZONE}` : 'TargetLynx TXT + PDF', b.imported ? 'done' : 'now'],
    ['Check drafts', 'flag and checklist', b.signature ? 'done' : b.imported ? 'now' : ''],
    ['Sign Performed', b.signature ? `${fmtTime(b.signature.at)} ${ZONE}` : 'drafts become Results', b.signature ? 'done' : ''],
    ['Review', b.signature ? 'Submitted for Review' : 'a Reviewer signs next', b.signature ? 'now' : ''],
  ];
  return h`<section class="ws-head card">
    <div class="ws-top">
      <div class="ws-idblock"><p class="overline">Test at the bench</p><h1 class="ws-id mono">${t.id}</h1></div>
      <dl class="facts">
        <div><dt>State</dt><dd>${stateTag(t.state)} <span class="muted">${fmtDuration(nowMs() - Date.parse(t.history.at(-1).at))}</span></dd></div>
        <div><dt>GxP Class</dt><dd>${gxpTag(t.gxp)}</dd></div>
        <div><dt>Service level</dt><dd>${serviceTag(t.serviceLevel)} <span class="muted">${t.tatBusinessDays} bd</span></dd></div>
        <div><dt>Due</dt><dd><b>${fmtDate(t.dueDate, true)}</b> ${dueTag(t)}</dd></div>
        <div><dt>Holds</dt><dd>${t.holds.length ? holdTag(t.holds.length) : h`<span class="tag neutral">${icon('dash')}None open</span>`}</dd></div>
        <div><dt>Deviations</dt><dd>${t.deviationIds.length ? t.deviationIds.map((id) => devTag(devById(id))) : h`<span class="tag neutral">${icon('dash')}None linked</span>`}</dd></div>
      </dl>
    </div>
    <p class="ws-line">Sample <b class="mono">${s.id}</b> · ${c.name} · ${p.name} <span class="muted">(${p.code}, ${p.kind})</span> · Lot <b class="mono">${s.lot}</b> · <b class="mono">${m.number} v${t.methodVersion}</b> ${m.title} · Notebook Entry <b class="mono">${FOCUS.notebookEntry}</b> · assigned by ${PEOPLE[assigned.by].name}, ${fmtDayOf(assigned.at)}</p>
    <ol class="path" aria-label="Bench steps for this Test">${steps.map(([n, sub, st], i) => h`<li class="${st}"${st === 'now' ? raw(' aria-current="step"') : ''}><span class="path-n">${st === 'done' ? icon('check') : i + 1}</span><span class="path-t"><b>${n}</b><small>${sub}</small></span></li>`)}</ol>
  </section>`;
}

/* ----- before the import ----- */
function preImportBody() {
  return h`<div class="ws-grid">
    <div class="ws-main">${prepsCard()}${runCard()}</div>
    <div class="ws-side">
      <section class="card act-card import-cta" aria-labelledby="imp-h">
        <p class="overline">${icon('upload')} Next step</p>
        <h2 id="imp-h">Import the TargetLynx export</h2>
        <p>Upload the Quantify Compound Summary (TXT) of <b class="mono">${FOCUS.run.id}</b> with its PDF. The server parses the TXT into <b>draft values</b> and cross-checks every cell against the PDF.</p>
        <p class="draft-explain">${draftTag('Drafts')} stay drafts until you sign Performed. Nothing you import counts as your Result before that.</p>
        <button type="button" class="bbtn primary wide" data-act="upload-open" data-k="upload-card">${icon('upload')}Upload TargetLynx export</button>
        <p class="small muted">Expected: <span class="mono">${FOCUS.import.file}</span> and <span class="mono">.pdf</span> from LCMS-02</p>
      </section>
      <section class="card" aria-labelledby="nb-h">
        <p class="overline">Notebook Entry</p>
        <h2 id="nb-h" class="mono">${FOCUS.notebookEntry}</h2>
        <p class="small">Refers to this Test, its ${FOCUS.preparations.length} Preparations, ${FOCUS.run.id} and ${FOCUS.run.solutions.length} Solutions. The values live in those records, not again in the Entry.</p>
      </section>
    </div>
  </div>`;
}
function prepsCard(compact = false) {
  const P = FOCUS.preparations;
  const used = [...new Set(P.flatMap((x) => [x.balance, ...x.pipettes, x.diWater]))];
  return h`<section class="card" aria-labelledby="prep-h">
    <header class="card-head"><div><p class="overline">Preparations · ${P.length}</p><h2 id="prep-h">Weighed and diluted from ${P[0] ? SAMPLES[benchTest().sampleId].id : ''}</h2></div>${passTag(true, 'Verified')}</header>
    <table class="ledger bench-t prep-t">
      <colgroup><col style="width:15%"><col style="width:12%"><col style="width:9%"><col style="width:29%"><col style="width:17%"><col style="width:18%"></colgroup>
      <thead><tr><th>Preparation</th><th class="num">Weight</th><th class="num">Volume</th><th>Balance · pipette · DI water · diluent</th><th>Entered by</th><th>Verified by</th></tr></thead>
      <tbody>${P.map((x) => h`<tr>
        <td><b class="mono">P${x.n}</b><span class="cell-sub mono">${x.id}</span></td>
        <td class="num mono b">${x.weightMg.toFixed(2)} mg</td><td class="num mono">${x.volumeMl} mL</td>
        <td class="refs">${eqRef(x.balance)}${x.pipettes.map(eqRef)}${eqRef(x.diWater)}${solRef(x.diluent)}</td>
        <td>${PEOPLE[x.enteredBy].name}<span class="cell-sub mono">${fmtLocal(x.enteredAt)}</span></td>
        <td>${passTag(true, PEOPLE[x.verifiedBy].name)}<span class="cell-sub mono">${fmtLocal(x.verifiedAt)}</span></td></tr>`)}</tbody>
    </table>
    ${compact ? '' : h`<ul class="fit-list" aria-label="Fitness Status of what the Preparations used">${used.map((id) => { const e = eqNow(id); return h`<li><span class="mono b">${id}</span> ${fitnessTag(e.fitness)} <span class="muted">${fitnessBasis(id)}</span></li>`; })}${[...new Set(P.map((x) => x.diluent))].map((id) => { const x = FOCUS.run.solutions.find((y) => y.id === id); return h`<li><span class="mono b">${id}</span> ${fitnessTag(x.fitness)} <span class="muted">${x.what}, expires ${fmtDate(x.expires)}</span></li>`; })}</ul>`}
  </section>`;
}
function runCard() {
  const r = FOCUS.run; const e = eqNow(r.instrument);
  return h`<section class="card" aria-labelledby="run-h">
    <header class="card-head"><div><p class="overline">Run</p><h2 id="run-h" class="mono">${r.id}</h2></div><span class="muted small">${r.injections} injections · ${r.testsInRun} Tests</span></header>
    <dl class="kv two">
      <dt>Instrument</dt><dd><span class="mono b">${r.instrument}</span> ${e.name}${e.software ? ` · ${e.software}` : ''} ${fitnessTag(e.fitness)} <span class="muted">${fitnessBasis(r.instrument)}</span></dd>
      <dt>Column</dt><dd><span class="mono b">${r.column.pack}</span> ${r.column.material} ${fitnessTag(r.column.fitness)} <span class="muted">Pack opened, in its use period</span></dd>
      <dt>Acquired</dt><dd><span class="mono">${fmtLocal(r.acquiredFrom)} – ${fmtTime(r.acquiredTo)} ${ZONE}</span> <span class="muted">(${fmtUtcTime(r.acquiredFrom)} – ${fmtUtcTime(r.acquiredTo)})</span></dd>
    </dl>
    <table class="ledger bench-t sol-t">
      <thead><tr><th>Solution</th><th>What</th><th>Made</th><th>Expires</th><th>Fitness Status</th></tr></thead>
      <tbody>${r.solutions.map((x) => h`<tr><td class="mono b">${x.id}</td><td>${x.what}</td><td class="mono">${fmtDate(x.madeOn)}</td><td class="mono">${fmtDate(x.expires)}</td><td>${fitnessTag(x.fitness)} <span class="muted small">until ${fmtDate(x.expires)}</span></td></tr>`)}</tbody>
    </table>
  </section>`;
}

/* ----- after the import ----- */
function importedBody() {
  const b = S.bench;
  return h`<div class="ws-grid imported">
    <div class="ws-main">${resultsCard()}${injectionsCard()}</div>
    <div class="ws-side">${b.signature ? signedCard() : beforeSignCard()}${importCard()}${runChecksCard()}
      <details class="card fold"><summary><span class="overline">Preparations and Run</span> <span class="small muted">2 Preparations Verified · ${FOCUS.run.id}</span></summary>${prepsCard(true)}</details>
    </div>
  </div>`;
}
const signedNow = () => !!S.bench.signature;
function resultsCard() {
  const signed = signedNow();
  const fmtPpm = (v) => (v == null ? '' : String(v));
  const cell = (pp) => (pp.ppm != null ? h`<span class="mono">${fmtPpm(pp.ppm)}</span>` : h`<span class="nd">${pp.display}</span>`);
  return h`<section class="card ${signed ? 'inked' : 'draft-card'}" aria-labelledby="res-h">
    <header class="card-head">
      <div><p class="overline">${signed ? h`${icon('nib')} Results · signed Performed by ${S.bench.signature.name}` : h`${icon('pencil')} Draft values from the import`}</p><h2 id="res-h">Per Preparation and Reportable Result</h2></div>
      ${signed ? h`<span class="tag ok">${icon('check')}Results</span>` : draftTag('Draft · not your Result yet')}
    </header>
    <table class="ledger res-t">
      <thead><tr><th>Analyte</th><th class="num">Preparation 1</th><th class="num">Preparation 2</th><th class="num">Reportable Result</th><th class="num">LOQ</th><th class="num">Limit<sup>*</sup></th><th>Share of the limit</th></tr></thead>
      <tbody>${FOCUS.results.map((r) => {
        const flagged = r.flags.length > 0;
        const rep = r.reportablePpm != null ? h`<b class="mono big-num">${String(r.reportablePpm)}</b>` : h`<b class="nd">${r.reportableDisplay}</b>`;
        return h`<tr class="${flagged && !signed ? 'flagged' : ''}">
          <td><b>${r.analyte}</b>${flagged ? h` <span class="tag ${S.bench.flag ? 'neutral' : 'bad'}" title="${r.flags[0].detail}">${icon('flag')}${S.bench.flag ? (S.bench.flag.decision === 'accept' ? 'accepted' : 'reinjecting') : '1 flag'}</span>` : ''}</td>
          <td class="num">${cell(r.perPrep[0])}</td>
          <td class="num">${cell(r.perPrep[1])}${flagged ? h` <span class="flag-mark" title="Flag on Preparation 2">${icon('flag')}</span>` : ''}</td>
          <td class="num">${rep}</td>
          <td class="num mono">${r.loqPpm}</td>
          <td class="num mono">${r.limitPpm}</td>
          <td>${r.pctOfLimit != null ? limitBar(r) : h`<span class="muted small">${r.reportableDisplay === '< LOQ' ? 'below LOQ, not quantified' : 'no peak found'}</span>`}</td>
        </tr>`;
      })}</tbody>
    </table>
    <p class="card-foot">Unit: ${FOCUS.units.result}. Reportable Result = mean of the Preparations, each the mean of its injections; compared with the limit as reported. <sup>*</sup>${FOCUS.limitsNote}</p>
  </section>`;
}
function limitBar(r) {
  const pct = r.pctOfLimit; const loq = (r.loqPpm / r.limitPpm) * 100;
  return h`<span class="lbar" role="img" aria-label="${pct} % of the limit"><span class="lbar-track"><span class="lbar-loq" style="left:${loq}%" title="LOQ"></span><span class="lbar-val" style="width:${Math.min(pct, 100)}%"></span></span><b class="mono">${pct} %</b></span>`;
}
function injectionsCard() {
  const signed = signedNow();
  const flagInj = FOCUS.results.flatMap((r) => r.flags.map((f) => `${r.analyte}|${f.injection}`));
  const rows = FOCUS.injections;
  let last = '';
  return h`<section class="card ${signed ? 'inked' : 'draft-card'}" aria-labelledby="inj-h">
    <header class="card-head"><div><p class="overline">${signed ? 'Injections · confirmed by the Performed signature' : h`${icon('pencil')} Draft · ${rows.length} rows parsed for ${FOCUS.testId}`}</p><h2 id="inj-h">Injections from <span class="mono">${FOCUS.run.id}</span></h2></div><span class="muted small">${FOCUS.units.pguL} · times ${ZONE}</span></header>
    <div class="scroll-x"><table class="ledger inj-t">
      <thead><tr><th>Analyte</th><th>Preparation</th><th>Injection</th><th class="num nocase">RT, min</th><th class="num">Area</th><th class="num">IS area</th><th class="num nocase">pg/µL</th><th class="num">Peak ratio</th><th class="num nocase">S/N</th><th class="num">Acquired</th></tr></thead>
      <tbody>${rows.map((x) => {
        const flagged = flagInj.includes(`${x.analyte}|${x.name}`);
        const first = x.analyte !== last; last = x.analyte;
        const flag = flagged ? FOCUS.results.find((r) => r.analyte === x.analyte).flags[0] : null;
        return h`<tr class="${first ? 'grp' : ''}${flagged ? ' flagged' : ''}">
          <td>${first ? h`<b>${x.analyte}</b>` : ''}</td><td class="mono">P${x.prep} · inj ${x.inj}</td><td class="mono">${x.name}</td>
          <td class="num mono">${x.rt != null ? x.rt.toFixed(2) : '—'}</td><td class="num mono">${x.area != null ? fmtInt(x.area) : '—'}</td><td class="num mono">${fmtInt(x.isArea)}</td>
          <td class="num mono">${typeof x.pguL === 'number' ? x.pguL.toFixed(3) : x.pguL === 'Below RL' ? 'Below RL' : h`<span class="muted">no peak</span>`}</td>
          <td class="num mono${flagged && !signed ? ' cell-bad' : ''}">${x.peakRatio != null ? x.peakRatio.toFixed(3) : '—'}${flagged ? h` ${icon('flag')}<span class="sr">flag: outside ${flag.window[0]}–${flag.window[1]}</span>` : ''}</td>
          <td class="num mono">${x.sn ?? '—'}</td><td class="num mono">${fmtTime(x.acquiredAt)}</td></tr>`;
      })}</tbody>
    </table></div>
  </section>`;
}
function importCard() {
  const imp = FOCUS.import; const b = S.bench;
  return h`<section class="card" aria-labelledby="impid-h">
    <header class="card-head"><div><p class="overline">Import · file identity</p><h2 id="impid-h">TargetLynx export</h2></div>${passTag(imp.pdf.crossCheck.mismatches === 0, 'PDF matches', 'PDF mismatches')}</header>
    <dl class="kv">
      <dt>File</dt><dd class="mono">${imp.file} <span class="muted">· ${fmtInt(imp.bytes)} bytes</span></dd>
      <dt>SHA-256</dt><dd class="hash mono">${hashView(imp.sha256)}${b.fileHashChecked ? h`<span class="tag ok">${icon('check')}recomputed, matches</span>` : ''}</dd>
      <dt>Dataset</dt><dd class="mono path-txt">${imp.dataset}</dd>
      <dt>Parser</dt><dd><span class="mono">${imp.parser}</span> · ${imp.rowsForThisTest} rows for this Test of ${FOCUS.run.injections} injections</dd>
      <dt>PDF</dt><dd class="mono">${imp.pdf.file}<br><span class="muted">SHA-256 ${imp.pdf.sha256.slice(0, 8)}… (attachment)</span></dd>
      <dt>Cross-check</dt><dd>${fmtInt(imp.pdf.crossCheck.cellsCompared)} cells compared · <b>${imp.pdf.crossCheck.mismatches} mismatches</b></dd>
      <dt>Uploaded</dt><dd>${PEOPLE[b.importedBy].name} · <span class="mono">${fmtLocal(b.importedAt)}</span> <span class="muted">(${fmtUtcTime(b.importedAt)})</span></dd>
    </dl>
  </section>`;
}
function runChecksCard() {
  const ch = FOCUS.run.checks;
  const an = FOCUS.results.map((r) => r.analyte);
  const all = [...ch.calibration, ...ch.ccv, ...ch.blanks, ...ch.loqSignalToNoise];
  const ok = all.every((x) => x.pass);
  const ccvNames = [...new Set(ch.ccv.map((x) => x.name))];
  const mark = (pass) => (pass ? icon('check', 'okc') : icon('cross', 'badc'));
  return h`<section class="card" aria-labelledby="rc-h">
    <header class="card-head"><div><p class="overline">Run checks · ${FOCUS.run.id}</p><h2 id="rc-h">${all.filter((x) => x.pass).length} of ${all.length} pass</h2></div>${passTag(ok, 'All pass', 'Failures')}</header>
    <table class="ledger rc-t">
      <thead><tr><th>Analyte</th><th class="num nocase">Calibration r²</th>${ccvNames.map((n) => h`<th class="num nocase">${n}, %</th>`)}<th class="num">Blanks</th><th class="num">LOQ S/N</th></tr></thead>
      <tbody>${an.map((a) => {
        const cal = ch.calibration.find((x) => x.analyte === a);
        const bl = ch.blanks.filter((x) => x.analyte === a);
        const sn = ch.loqSignalToNoise.find((x) => x.analyte === a);
        return h`<tr><td><b>${a}</b></td><td class="num mono">${cal.r2.toFixed(4)} ${mark(cal.pass)}</td>${ccvNames.map((n) => { const c = ch.ccv.find((x) => x.analyte === a && x.name === n); return h`<td class="num mono">${c.recoveryPct.toFixed(1)} ${mark(c.pass)}</td>`; })}<td class="num">${bl.every((x) => x.pass) ? 'clean' : 'found'} ${mark(bl.every((x) => x.pass))}</td><td class="num mono">${sn.sn} ${mark(sn.pass)}</td></tr>`;
      })}</tbody>
    </table>
    <p class="card-foot">Calibration ${ch.calibration[0].levels} levels, ${ch.calibration[0].rangePguL[0]}–${ch.calibration[0].rangePguL[1]} pg/µL, ${ch.calibration[0].weighting} weighting, deuterated internal standards. CCV ${ch.ccv[0].limits[0]}–${ch.ccv[0].limits[1]} %. LOQ S/N ≥ ${ch.loqSignalToNoise[0].limit}. Blanks ${[...new Set(ch.blanks.map((x) => x.name))].join(', ')}.</p>
  </section>`;
}
function beforeSignCard() {
  const b = S.bench; const g = benchGates();
  const r = FOCUS.results.find((x) => x.flags.length); const f = r.flags[0];
  const [i1, i2, i3] = FOCUS.performedChecklist;
  let flagBody;
  if (!b.flag && !b.composing) {
    flagBody = h`<div class="bench-actions"><button type="button" class="bbtn" data-act="flag-accept" data-k="flag-accept">${icon('check')}Accept with comment</button><button type="button" class="bbtn" data-act="flag-reinject" data-k="flag-reinject">${icon('swap')}Request Reinjection</button></div>`;
  } else if (b.composing) {
    flagBody = h`<div class="composer"><label for="flag-comment" class="fld-l">Why the value stands <small>required, goes to the Audit Trail</small></label>
      <textarea id="flag-comment" rows="3" placeholder="What you checked and why the value stands">${b.draftComment}</textarea>
      <div class="phrases" aria-label="Add a phrase">${['RT and peak shape match the standards.', 'The other 3 injections are inside the window.', 'Quantifier ion unaffected; result far below the limit.'].map((p) => h`<button type="button" class="phrase" data-act="phrase" data-arg="${p}">+ ${p}</button>`)}</div>
      <div class="bench-actions"><button type="button" class="bbtn ghost" data-act="flag-cancel">Back</button><button type="button" class="bbtn primary" data-act="flag-save" data-k="flag-save" ${b.draftComment.trim().length < 10 ? raw('disabled') : ''}>${icon('check')}Save decision</button></div></div>`;
  } else if (b.flag.decision === 'accept') {
    flagBody = h`<div class="decision ok"><p>${icon('check')}<b>Accepted with comment</b> · ${PEOPLE[b.flag.by].name} · <span class="mono">${fmtLocal(b.flag.at)}</span></p><blockquote>${b.flag.comment}</blockquote><button type="button" class="bbtn ghost" data-act="flag-change">Change decision</button></div>`;
  } else {
    flagBody = h`<div class="decision warn"><p>${icon('swap')}<b>Reinjection of Preparation ${f.prep} requested</b> · ${PEOPLE[b.flag.by].name} · <span class="mono">${fmtLocal(b.flag.at)}</span></p><p class="small">Signing waits until the Reinjection is imported. The Test stays In Progress.</p><button type="button" class="bbtn ghost" data-act="flag-change">Withdraw the request</button></div>`;
  }
  const row = (done, text, control, note = '') => h`<li class="gate ${done ? 'done' : ''}"><span class="gate-box" aria-hidden="true">${done ? icon('check') : ''}</span><span class="gate-text">${text}${note ? h`<small>${note}</small>` : ''}</span>${control}</li>`;
  return h`<section class="card act-card before-sign" aria-labelledby="bs-h">
    <header class="card-head"><div><p class="overline">Before you sign Performed</p><h2 id="bs-h">${g.ready ? 'Ready to sign' : `${g.left} of 3 left`}</h2></div>${g.ready ? passTag(true, 'Ready') : h`<span class="tag warn">${icon('half')}${g.left} left</span>`}</header>
    <div class="flag-card ${b.flag ? (b.flag.decision === 'accept' ? 'handled' : 'reinject') : 'open'}">
      <p class="flag-head">${icon('flag')}<span><b>Flag on ${r.analyte}</b> · ${f.kind}</span></p>
      <p class="flag-detail">Injection <b class="mono">${f.injection}</b> (Preparation ${f.prep}): Peak Ratio <b class="mono">${f.found.toFixed(2)}</b>, window <b class="mono">${f.window[0]}–${f.window[1]}</b> (calibration mean 0.76 ± 20 %).</p>
      ${flagBody}
    </div>
    <ol class="gates" aria-label="Performed checklist">
      ${row(g.flagHandled, i1, h`<span class="gate-auto">${g.flagHandled ? 'set by the system' : 'handle the flag above'}</span>`)}
      ${row(g.integOk, i2, h`<span class="segbig small" role="radiogroup" aria-label="Manual integrations"><button type="button" role="radio" aria-checked="${tf(b.integrations === 'none')}" data-act="integ" data-arg="none" data-k="integ-none">None</button><button type="button" role="radio" aria-checked="${tf(b.integrations === 'some')}" data-act="integ" data-arg="some" data-k="integ-some">List them</button></span>`,
        b.integrations === 'some' ? raw(String(h`<label class="sr" for="integ-text">Manual integrations and reasons</label><textarea id="integ-text" rows="2" placeholder="Injection, analyte, reason">${b.integrationsText}</textarea>`)) : '')}
      ${row(g.matchOk, i3, h`<button type="button" class="bbtn toggle" role="checkbox" aria-checked="${tf(g.matchOk)}" data-act="match" data-k="match">${g.matchOk ? h`${icon('check')}Confirmed` : 'Confirm'}</button>`)}
    </ol>
    <p class="bs-record">${icon('nib')}Signing binds to <b>Record Version ${FOCUS.recordVersion}</b> · SHA-256 <b class="mono">${FOCUS.contentSha256.slice(0, 8)}</b>. The prompt shows the full hash.</p>
  </section>`;
}
function signedCard() {
  const sig = S.bench.signature;
  return h`<section class="card sig-card" aria-labelledby="sig-h">
    <header class="card-head"><div><p class="overline">Electronic Signature</p><h2 id="sig-h">Performed, and Submitted for Review</h2></div>${passTag(true, 'Signed')}</header>
    ${sigBlock(sig)}
    <p class="small">The draft values are now ${sig.name}'s Results. <b class="mono">${FOCUS.testId}</b> moved to <b>Submitted for Review</b> at <span class="mono">${fmtTime(sig.at)} ${ZONE}</span>. A signature cannot be withdrawn; a correction needs a Reason for Change and a new Record Version.</p>
  </section>`;
}
function signCtxForTest() {
  const imp = FOCUS.import; const b = S.bench;
  return {
    meaning: 'Performed',
    recordId: FOCUS.testId,
    recordTitle: `Test ${FOCUS.testId}: results for ${FOCUS.results.length} analytes from ${FOCUS.run.id}`,
    recordVersion: FOCUS.recordVersion,
    sha: FOCUS.contentSha256,
    lines: [
      ['Contains', h`${FOCUS.preparations.length} Preparations · ${imp.rowsForThisTest} injection rows from <span class="mono">${imp.file}</span> (SHA-256 <span class="mono">${imp.sha256.slice(0, 8)}</span>) · ${FOCUS.results.length} Reportable Results`],
      ['Flag', b.flag && b.flag.decision === 'accept' ? h`NDMA ion ratio on ${FOCUS.results[0].flags[0].injection}: accepted with comment` : 'not handled'],
      ['Checklist', h`${FOCUS.performedChecklist.length} of ${FOCUS.performedChecklist.length} confirmed`],
    ],
    consequence: `When you sign, the draft values become your Results and ${FOCUS.testId} moves to Submitted for Review. A signature can never be withdrawn.`,
    onSigned: 'bench',
  };
}

/* ---------- Upload sheet (simulated file choice; the data holds the parse) ---------- */
function uploadSheet(sh) {
  const imp = FOCUS.import;
  const steps = [
    ['Upload', `${imp.file} (${fmtInt(imp.bytes)} bytes) and its PDF`],
    ['Identify', sh.hash ? h`SHA-256 <span class="mono">${sh.hash.slice(0, 8)}…</span> ${sh.hash === imp.sha256 ? 'matches the server' : 'computed on the server'}` : 'SHA-256 of the TXT'],
    ['Parse', `${imp.parser}: ${FOCUS.run.injections} injections × ${FOCUS.results.length} compounds`],
    ['Cross-check', `PDF: ${fmtInt(imp.pdf.crossCheck.cellsCompared)} cells compared, ${imp.pdf.crossCheck.mismatches} mismatches`],
    ['Drafts', `${imp.rowsForThisTest} draft rows for ${FOCUS.testId}`],
  ];
  const body = h`<header class="sheet-head">
      <p class="overline">${icon('upload')} Import · ${FOCUS.run.id} · ${FOCUS.run.instrument}</p>
      <h2 id="sheet-title" tabindex="-1">Upload the TargetLynx export</h2>
      <p class="sheet-sub">The TXT is parsed into draft values. The PDF is kept as an attachment and every cell is cross-checked against the TXT.</p>
    </header>
    <div class="files">
      <div class="file">${icon('file')}<span><b class="mono">${imp.file}</b><small>${fmtInt(imp.bytes)} bytes · Quantify Compound Summary · parsed into drafts</small></span></div>
      <div class="file">${icon('file')}<span><b class="mono">${imp.pdf.file}</b><small>Attachment · cross-checked cell by cell</small></span></div>
    </div>
    <p class="small muted">Chosen from the LCMS-02 export folder. The file picker is simulated in this prototype; the data already holds the server's parse.</p>
    <ol class="steps" aria-label="Import progress">${steps.map(([n, d], i) => h`<li class="${sh.step > i ? 'done' : sh.step === i && sh.phase === 'running' ? 'now' : ''}"><span class="path-n">${sh.step > i ? icon('check') : i + 1}</span><span><b>${n}</b> <span class="muted">${d}</span></span></li>`)}</ol>`;
  return sheetFrame({
    cls: 'upload-sheet',
    body,
    context: sh.phase === 'running' ? h`<span class="ctx-line">Importing… keep this screen open.</span>` : h`<span class="ctx-line">Nothing becomes a Result on upload. You confirm drafts by signing Performed.</span>`,
    actions: [
      rbtn({ act: 'sheet-cancel', label: 'Cancel', disabled: sh.phase === 'running', k: 'upload-cancel' }),
      rbtn({ act: 'upload-start', label: sh.phase === 'running' ? 'Importing…' : 'Upload and parse', ic: 'upload', kind: 'primary', disabled: sh.phase === 'running', k: 'upload-start' }),
    ],
  });
}

/* ======================================================================
   TODAY'S CHECKS (#checks, #check-fail)
   ====================================================================== */
const checkNow = (c) => ({ ...c, ...(S.checkState[c.id] || {}) });
const GROUPS = [
  ['Rooms', 'readings of temperature and humidity · audited, not signed', (c) => c.targetKind === 'Room'],
  ['Storage units', 'readings of current, minimum and maximum since reset · audited, not signed', (c) => /^(FRZ|CMB)/.test(c.target)],
  ['Balances', 'verification before first use · signed Performed', (c) => /^BAL/.test(c.target)],
  ['Water, pH meter and pipettes', 'DI water reading audited · pH and pipette verifications signed Performed', (c) => /^(DIW|PH|PIP)/.test(c.target)],
];
const FIELD_DEF = {
  tempC: { label: 'Temperature', unit: '°C' },
  tempMinC: { label: 'Minimum since reset', unit: '°C', lim: 'tempC' },
  tempMaxC: { label: 'Maximum since reset', unit: '°C', lim: 'tempC' },
  rhPct: { label: 'Relative humidity', unit: '%RH' },
  resistivityMOhmCm: { label: 'Resistivity', unit: 'MΩ·cm' },
  tocPpb: { label: 'TOC', unit: 'ppb' },
};
const numFields = (c) => (c.fields || []).filter((f) => f !== 'reset');
const rangeText = ([a, b], unit) => (a < 0 || b < 0 ? `${fmtFixed(a, decimalsOf(a))} to ${fmtFixed(b, decimalsOf(b))} ${unit}` : `${a}–${b} ${unit}`);
function checkName(c) {
  const r = ROOMS[c.target];
  if (r) return r.name;
  const e = EQUIPMENT[c.target];
  return c.compartment ? `Combination unit · ${c.compartment}` : e.name;
}
function valuesText(c, values) {
  if (!values) return '';
  if (values.readings) return values.readings.map((v, i) => `${c.weights[i].nominal}: ${v} ${values.unit}`).join(' · ');
  if (values.readingsMg) return values.readingsMg.map((v, i) => `${c.weights[i].nominal}: ${balUnit(c.target) === 'g' ? mgToG(v) + ' g' : v + ' mg'}`).join(' · ');
  return numFields(c).filter((f) => values[f] != null).map((f) => `${f === 'tempMinC' ? 'min ' : f === 'tempMaxC' ? 'max ' : ''}${fmtFixed(values[f], decimalsOf(values[f]))} ${FIELD_DEF[f].unit}`).join(' · ');
}
function checksScreen() {
  const list = L.checksToday.map(checkNow);
  const counts = {};
  list.forEach((c) => { counts[c.status] = (counts[c.status] || 0) + 1; });
  return h`<div class="checks">
    ${alarmBanner()}
    <section class="checks-head">
      <h1>Today's Checks <span class="h1-sub">${fmtDate(LAB_DAY, true)} 2026 · ${list.length} Checks · every time is the server's</span></h1>
      <div class="status-counts" aria-label="Checks by status">${['Overdue', 'Blocked', 'Due', 'Due soon', 'Done', 'Not used today'].filter((s) => counts[s]).map((s) => checkTag(s, `${counts[s]} ${s}`))}</div>
    </section>
    ${GROUPS.map(([name, note, test]) => h`<section class="check-group" aria-labelledby="g-${slug(name)}"><h2 id="g-${slug(name)}" class="group-h">${name} <span>${note}</span></h2><div class="tiles">${list.filter(test).map(checkTile)}</div></section>`)}
  </div>`;
}
function checkTile(c) {
  const e = EQUIPMENT[c.target];
  const fit = e ? eqNow(c.target) : null;
  const kind = c.type === 'Reading' ? `Reading · ${numFields(c).map((f) => FIELD_DEF[f].unit).filter((u, i, a) => a.indexOf(u) === i).join(', ')} · audited` : `Verification · ${c.schedule.toLowerCase()} · signed Performed`;
  let last;
  if (c.status === 'Done') last = h`${icon(c.outcome === 'fail' || c.outOfLimits ? 'dev' : 'check')}<span>${fmtTime(c.at)} · ${firstName(PEOPLE[c.by])}${c.values ? ` · ${valuesText(c, c.values)}` : ''}${c.deviationId ? ` · ${c.deviationId}` : ''}</span>`;
  else if (c.status === 'Blocked') last = h`${icon('slash')}<span>${c.note}</span>`;
  else if (c.status === 'Overdue') last = h`${icon('alarm')}<span>Due since ${fmtDate(c.dueDate, true)} · cannot be cited until a passing Check</span>`;
  else if (c.status === 'Due soon') last = h`${icon('clock')}<span>Due ${fmtDate(c.dueDate, true)} · ${c.schedule.toLowerCase()}</span>`;
  else if (c.status === 'Not used today') last = h`${icon('dash')}<span>Before-use Check only if PH-01 is used today</span>`;
  else if (c.target === 'RD-102') last = h`${icon('bell')}<span>Missed yesterday · alarm open</span>`;
  else if (c.lastPass) last = h`${icon('info')}<span>Last pass ${fmtLocal(c.lastPass)} · ${c.testsSinceLastPass} Tests weighed since</span>`;
  else if (c.last) last = h`${icon('info')}<span>Last ${fmtDayOf(c.last.at)}: ${valuesText(c, c.last)}</span>`;
  else last = h`${icon('ring')}<span>Due today</span>`;
  const fitLine = fit && fit.fitness !== 'In use' && c.status !== 'Blocked' ? h`<span class="tile-fit">${fitnessTag(fit.fitness)}<span>${fit.reason}${fit.blocks ? ` · refuses ${fit.blocks}` : ''}</span></span>` : '';
  return h`<button type="button" class="tile st-${slug(c.status)}${c.outcome === 'fail' || c.outOfLimits ? ' tile-bad' : ''}" data-act="open-check" data-arg="${c.id}" data-k="tile-${c.id}" aria-label="${c.target} ${checkName(c)}. ${kind}. ${c.status}.">
    <span class="tile-top"><span class="tile-id mono">${c.target}</span>${c.outcome === 'fail' ? h`<span class="tag bad">${icon('cross')}Done · failed</span>` : c.outOfLimits ? h`<span class="tag bad">${icon('cross')}Done · out of limits</span>` : checkTag(c.status)}</span>
    <span class="tile-name">${checkName(c)}</span>
    ${fitLine}
    <span class="tile-last">${last}</span>
  </button>`;
}
function alarmBanner() {
  const a = L.missedChecks[0];
  if (!a) return '';
  const room = ROOMS[a.target];
  const to = a.raisedTo.map((id) => PEOPLE[id].name);
  if (S.alarmAck) return h`<section class="alarm acked" aria-label="Missed reading alarm">${icon('check')}<p><b>Missed reading acknowledged</b> · ${a.target} ${room.name}, ${fmtDate(a.day, true)} · ${PEOPLE[S.alarmAck.by].name}, <span class="mono">${fmtLocal(S.alarmAck.at)}</span> · recorded in the Audit Trail: “${S.alarmAck.reason}”</p></section>`;
  const mine = a.raisedTo.includes(S.userId);
  return h`<section class="alarm" aria-label="Missed reading alarm">
    <span class="alarm-ic">${icon('bell')}</span>
    <div class="alarm-text"><p class="overline">Missed reading alarm · ${a.alarm} · raised to ${to.join(' and ')}</p><p><b>${a.target} ${room.name}</b> has no daily reading for <b>${fmtDate(a.day, true)}</b>. A reading takes the server's time, so none can be entered for that day now.</p></div>
    ${mine ? h`<button type="button" class="bbtn warnbtn" data-act="alarm-open" data-k="alarm-open">${icon('check')}Acknowledge</button>` : h`<p class="small alarm-who">Only ${to.join(' or ')} can acknowledge it.</p>`}
  </section>`;
}

/* ---------- readings ---------- */
function evalReading(c, f, text) {
  const key = FIELD_DEF[f].lim || f;
  const lim = c.limits[key]; const pl = c.plausible[key];
  if (!String(text).trim()) return { state: 'empty', lim, pl };
  const v = parseNum(text);
  if (Number.isNaN(v)) return { state: 'invalid', lim, pl };
  const implausible = !!pl && (v < pl[0] || v > pl[1]);
  const out = !!lim && (v < lim[0] || v > lim[1]);
  return { v, lim, pl, state: implausible ? 'implausible' : out ? 'out' : 'in' };
}
const needsRetype = (ev) => ev.state === 'out' || ev.state === 'implausible';
function readingConsequence(c) {
  const t = c.target;
  if (c.targetKind === 'Room') {
    const r = ROOMS[t];
    if (r.storage) return [`opens an Excursion Deviation for ${t} ${r.name}`, `${t} refuses new placements until QA closes it (removals are still allowed)`, 'the Excursion is presumed to have lasted since the last in-limit reading'];
    return [`opens a Room Deviation for ${t} ${r.name}`, 'tells the Lab Manager and QA'];
  }
  if (/^(FRZ|CMB)/.test(t)) {
    const open = L.deviations.find((d) => d.kind === 'Excursion' && d.state !== 'Closed' && d.title.startsWith(t));
    if (open) return [`adds this reading to the open Excursion ${open.id}`, `${t} keeps refusing new placements (removals are still allowed)`];
    return [`opens an Excursion Deviation for ${t}`, `${t} refuses new placements until QA closes it (removals are still allowed)`, `the Excursion is presumed to have lasted since the last in-limit reading${c.last ? ` (${fmtLocal(c.last.at)})` : ''}`];
  }
  if (t === 'DIW-01') return ['opens an Equipment Deviation for DIW-01', 'suspends DIW-01: Preparations cannot cite it until a passing reading'];
  return ['opens a Deviation'];
}
function readingSheet(sh) {
  const c = checkNow(CHECKS[sh.checkId]);
  const fields = numFields(c);
  const hasMinMax = fields.includes('tempMinC');
  const body = h`<header class="sheet-head entry-head">
      <p class="overline">Reading · ${c.schedule} · audited, not signed</p>
      <h2 id="sheet-title" tabindex="-1"><span class="mono">${c.target}</span> ${checkName(c)}</h2>
      <p class="sheet-sub">${icon('clock')} Time: the server's clock when you save <span class="muted">(now ${fmtTime(nowMs())} ${ZONE})</span>. Nobody types a time.${c.last ? h` Last reading ${fmtLocal(c.last.at)}: ${valuesText(c, c.last)}.` : ''}${c.note ? h` <b>${c.note}.</b>` : ''}</p>
    </header>
    <div class="entry-grid">
      <div class="entry-fields f${fields.length + (c.fields.includes('reset') ? 1 : 0)}">${fields.map((f) => fieldCard(c, f, sh, hasMinMax))}${c.fields.includes('reset') ? resetCard(sh) : ''}</div>
      <div class="entry-pad">${keypad('decimal')}<p class="small muted pad-note">The pad types into the highlighted field. A keyboard works too.</p><div class="consequence" id="consequence" aria-live="polite"></div></div>
    </div>`;
  return sheetFrame({ cls: 'entry-sheet', body, context: h`<span class="ctx-line" id="entry-ctx"></span>`, actions: [rbtn({ act: 'sheet-cancel', label: 'Cancel', k: 'entry-cancel' }), rbtn({ act: 'reading-save', label: 'Save reading', ic: 'check', kind: 'primary', disabled: true, k: 'entry-save' })] });
}
function fieldCard(c, f, sh, hasMinMax) {
  const d = FIELD_DEF[f]; const key = d.lim || f;
  const lim = c.limits[key]; const pl = c.plausible[key];
  const label = f === 'tempC' && hasMinMax ? 'Temperature now' : d.label;
  const [lo, hi] = lim; const span = hi - lo;
  const smin = lo - span; const smax = hi + span;
  const pos = (v) => ((v - smin) / (smax - smin)) * 100;
  return h`<div class="fcard" data-field="${f}">
    <label class="fld-l" for="f-${f}">${label}</label>
    <div class="readout"><input id="f-${f}" class="num mono" inputmode="none" autocomplete="off" spellcheck="false" data-field="${f}" value="${sh.values[f] || ''}" aria-describedby="lim-${f} st-${f}"><span class="unit">${d.unit}</span></div>
    <div class="gauge" aria-hidden="true" data-min="${smin}" data-max="${smax}"><span class="g-band" style="left:${pos(lo)}%;width:${pos(hi) - pos(lo)}%"></span><span class="g-mark" hidden></span><span class="g-tick" style="left:${pos(lo)}%">${fmtFixed(lo, decimalsOf(lo))}</span><span class="g-tick" style="left:${pos(hi)}%">${fmtFixed(hi, decimalsOf(hi))}</span></div>
    <p class="limits" id="lim-${f}">Limits <b>${rangeText(lim, d.unit)}</b>${pl ? ` · plausible ${rangeText(pl, d.unit)}` : ''}</p>
    <p class="fstatus" id="st-${f}"></p>
    <div class="retype" id="rt-${f}" hidden><label class="fld-l" for="r-${f}"></label><div class="readout sm"><input id="r-${f}" class="num mono" inputmode="none" autocomplete="off" data-retype="${f}" value="${sh.retype[f] || ''}"><span class="unit">${d.unit}</span></div><p class="rstatus" id="rs-${f}"></p></div>
  </div>`;
}
function resetCard(sh) {
  return h`<div class="fcard reset-card">
    <p class="fld-l" id="reset-l">Min/max memory</p>
    <div class="segbig" role="radiogroup" aria-labelledby="reset-l">
      <button type="button" role="radio" aria-checked="${tf(sh.reset === true)}" data-act="reset-choice" data-arg="yes" data-k="reset-yes">${icon('check')}Reset after reading</button>
      <button type="button" role="radio" aria-checked="${tf(sh.reset === false)}" data-act="reset-choice" data-arg="no" data-k="reset-no">Not reset</button>
    </div>
    <p class="limits">Say whether you cleared the display's min/max after reading it. The next minimum and maximum count from then.</p>
  </div>`;
}

/* ---------- balance verification ---------- */
const balUnit = (id) => (/micro/i.test(EQUIPMENT[id].name) ? 'mg' : 'g');
function certText(c, w) { return balUnit(c.target) === 'g' ? `${mgToG(w.certifiedMg)} g` : `${w.certifiedMg} mg`; }
function evalWeight(c, i, text) {
  const w = c.weights[i];
  if (!String(text).trim()) return { state: 'empty' };
  const v = parseNum(text);
  if (Number.isNaN(v)) return { state: 'invalid' };
  const mg = balUnit(c.target) === 'g' ? v * 1000 : v;
  const errPct = ((mg - w.certifiedMg) / w.certifiedMg) * 100;
  const dp = decimalsOf(c.tolerancePct);
  const rounded = roundHalfAway(errPct, dp);
  const pass = Math.abs(rounded) <= c.tolerancePct;
  const implausible = Math.abs(errPct) > (c.plausiblePct ?? 5);
  return { v, mg, errPct, rounded, dp, pass, state: implausible ? 'implausible' : pass ? 'in' : 'out' };
}
function balanceConsequence(c) {
  return [
    `opens an Equipment Deviation for ${c.target}`,
    `suspends ${c.target} (Fitness Status Suspended): nobody can weigh on it until the Deviation returns it to service`,
    `puts a Hold on every Test that cited ${c.target} since its last passing Check${c.lastPass ? ` (${fmtLocalFull(c.lastPass).slice(0, 16)} ${ZONE})` : ''}${c.testsSinceLastPass != null ? `: ${c.testsSinceLastPass} Tests` : ''}`,
    `records the failed Check in the ${c.target} Equipment Logbook`,
  ];
}
function balanceSheet(sh) {
  const c = checkNow(CHECKS[sh.checkId]);
  const e = EQUIPMENT[c.target]; const cw = EQUIPMENT['CW-01']; const unit = balUnit(c.target);
  const body = h`<header class="sheet-head entry-head">
      <p class="overline">Verification · ${c.schedule} · signed Performed</p>
      <h2 id="sheet-title" tabindex="-1"><span class="mono">${c.target}</span> ${e.name} <span class="muted small">· ${e.room}</span></h2>
      <p class="sheet-sub">Check weights <b class="mono">CW-01</b> ${cw.name.replace('Check-weight set, ', '')}, certificate <span class="mono">${cw.certificate}</span> ${fitnessTag(cw.fitness)} · tolerance <b>±${c.tolerancePct} %</b> of certified mass · plausible within ±${c.plausiblePct ?? 5} %${c.lastPass ? h` · last pass <span class="mono">${fmtLocal(c.lastPass)}</span>` : ''} · time is the server's</p>
    </header>
    <div class="entry-grid">
      <div class="entry-fields">
        <table class="weigh">
          <thead><tr><th>Weight</th><th class="num">Certified mass</th><th>Balance reading</th><th class="num">Error</th><th>Result</th></tr></thead>
          <tbody>${c.weights.map((w, i) => h`<tr data-w="${i}"><td><b>${w.nominal}</b></td><td class="num mono">${certText(c, w)}</td>
            <td><div class="readout"><label class="sr" for="w-${i}">${w.nominal} weight reading in ${unit}</label><input id="w-${i}" class="num mono" inputmode="none" autocomplete="off" data-weight="${i}" value="${sh.readings[i] || ''}"><span class="unit">${unit}</span></div></td>
            <td class="num mono err-cell" id="e-${i}">—</td><td id="p-${i}" class="res-cell">—</td></tr>`)}</tbody>
        </table>
        ${c.weights.map((w, i) => h`<div class="retype" id="wr-${i}" hidden><label class="fld-l" for="wr-in-${i}"></label><div class="readout sm"><input id="wr-in-${i}" class="num mono" inputmode="none" autocomplete="off" data-wretype="${i}" value="${sh.retype[i] || ''}"><span class="unit">${unit}</span></div><p class="rstatus" id="wrs-${i}"></p></div>`)}
        <p class="rounding small muted">Error = (reading − certified) ÷ certified × 100, rounded to the limit's decimal places before comparing (USP General Notices 7.20).</p>
        <div class="consequence wide" id="consequence" aria-live="polite"></div>
      </div>
      <div class="entry-pad">${keypad('decimal')}<p class="small muted pad-note">The pad types into the highlighted field. A keyboard works too.</p></div>
    </div>`;
  return sheetFrame({ cls: 'entry-sheet balance-sheet', body, context: h`<span class="ctx-line" id="entry-ctx"></span>`, actions: [rbtn({ act: 'sheet-cancel', label: 'Cancel', k: 'entry-cancel' }), rbtn({ act: 'balance-save', label: 'Save and sign Performed', ic: 'nib', kind: 'primary', disabled: true, k: 'entry-save' })] });
}

/* ---------- read-only Check record, blocked or out-of-scope Checks ---------- */
function checkInfoSheet(sh) {
  const c = checkNow(CHECKS[sh.checkId]);
  const e = EQUIPMENT[c.target];
  const fit = e ? eqNow(c.target) : null;
  let main;
  if (c.status === 'Done') {
    main = h`<dl class="kv"><dt>Status</dt><dd>${checkTag('Done')}${c.outcome === 'fail' ? h` ${passTag(false, '', 'Failed')}` : c.outOfLimits ? h` <span class="tag bad">${icon('cross')}Out of limits</span>` : h` ${passTag(true, c.type === 'Reading' ? 'In limits' : 'Pass')}`}</dd>
      <dt>Values</dt><dd class="mono">${valuesText(c, c.values)}</dd><dt>Time</dt><dd class="mono">${fmtLocalFull(c.at)} · ${fmtUtcTime(c.at)}</dd><dt>By</dt><dd>${PEOPLE[c.by].name} (${PEOPLE[c.by].username})</dd>
      <dt>Record</dt><dd>${c.signed ? 'Signed Performed' : 'Audited, not signed'}${c.deviationId ? h` · ${devTag(devById(c.deviationId))}` : ''}</dd></dl>
      ${c.signature ? sigBlock(c.signature) : ''}`;
  } else if (c.status === 'Blocked') {
    main = h`<p>${checkTag('Blocked')}</p><p class="lead">${c.note}</p>${fit ? h`<p>${fitnessTag(fit.fitness)} ${fit.reason}</p>` : ''}`;
  } else {
    main = h`<p>${checkTag(c.status)}</p><p class="lead">${c.status === 'Not used today' ? 'This pH meter has a before-use Check. It is due only if someone uses PH-01 today.' : `Gravimetric Check every 3 months${c.dueDate ? `, due ${fmtDate(c.dueDate, true)}` : ''}.`}</p>
      ${c.note ? h`<p>${c.note}</p>` : ''}${fit ? h`<p>${fitnessTag(fit.fitness)} ${fit.reason || fitnessBasis(c.target)}</p>` : ''}
      <p class="small muted">Entering pH and pipette Checks is not part of this prototype.</p>`;
  }
  const body = h`<header class="sheet-head"><p class="overline">${c.type} · ${c.schedule}</p><h2 id="sheet-title" tabindex="-1"><span class="mono">${c.target}</span> ${checkName(c)}</h2></header><div class="info-body">${main}</div>`;
  return sheetFrame({ cls: 'info-sheet', body, context: h`<span class="ctx-line">Read-only.</span>`, actions: [rbtn({ act: 'sheet-cancel', label: 'Close', k: 'info-close' })] });
}

/* ---------- missed-reading alarm acknowledgement ---------- */
function alarmSheet(sh) {
  const a = L.missedChecks[0]; const room = ROOMS[a.target];
  const body = h`<header class="sheet-head"><p class="overline">${icon('bell')} Missed reading alarm · audited</p><h2 id="sheet-title" tabindex="-1">Acknowledge: no reading for <span class="mono">${a.target}</span> ${room.name} on ${fmtDate(a.day, true)}</h2>
      <p class="sheet-sub">Acknowledging records who saw the alarm and why the reading was missed. It does not create a reading for ${fmtDate(a.day)}: a reading always takes the server's time.</p></header>
    <div class="composer">
      <label class="fld-l" for="ack-text">What happened <small>required</small></label>
      <textarea id="ack-text" rows="3" placeholder="Why the reading was missed">${sh.text}</textarea>
      <div class="phrases">${['Reading forgotten at the end of the shift.', 'Room closed for maintenance that day.', 'Logger reading was checked instead; no paper record.'].map((p) => h`<button type="button" class="phrase" data-act="ack-phrase" data-arg="${p}">+ ${p}</button>`)}</div>
    </div>`;
  return sheetFrame({ cls: 'info-sheet', body, context: h`<span class="ctx-line">Recorded in the Audit Trail under your name.</span>`, actions: [rbtn({ act: 'sheet-cancel', label: 'Cancel', k: 'ack-cancel' }), rbtn({ act: 'alarm-save', label: 'Acknowledge', ic: 'check', kind: 'primary', disabled: sh.text.trim().length < 8, k: 'ack-save' })] });
}

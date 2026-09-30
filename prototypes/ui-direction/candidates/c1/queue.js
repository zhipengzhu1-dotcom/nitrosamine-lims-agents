/* queue.js: the Lab queue (#queue) and the assignment of a Test (#assign).
   Dense rows to read; the commit (Assign) always happens in the bench rail. */
(function () {
  'use strict';
  const { L, DB, S, $, $$, esc, ic, plural, fmt, now, LAB_DAY, OPEN_STATES, MAIN_PATH, dueStatus, stateSince, person, analysts, blocksText, deviation,
    stateTag, holdTag, devTag, riskTag, gxpTag, dueCell, audit, receipt, monogram, nameLine } = App.lib;
  const V = (App.views.queue = {});
  const Q = () => S.queue;
  const isManager = () => person(S.userId).roles.includes('Lab Manager');

  V.reset = () => { S.queue = { q: '', state: null, over: false, risk: false, holds: 'any', dev: 'any', gxp: 'any', method: 'any', customer: 'any', assignee: null, sel: null, cursor: null, assign: null }; };
  V.enter = (route) => {
    if (route === 'assign') { const id = L.focus.assignTestId; Q().sel = id; Q().cursor = id; Q().assign = { testId: id, choice: null, animate: false }; }
  };
  V.closeAssign = () => { if (S.queue && S.queue.assign) { S.queue.assign = null; if (S.route === 'assign') S.route = 'queue'; } };

  /* ---------- filtering ---------- */
  const sample = (t) => DB.samples[t.sampleId];
  const searchKey = (t) => t._s || (t._s = [t.id, t.sampleId, t.submissionId, sample(t).lot, sample(t).customerRef, t.methodNumber, ...t.deviationIds, DB.customers[t.customerId].name, DB.products[t.productId].name, DB.products[t.productId].code, t.assigneeId ? person(t.assigneeId).name : 'unassigned'].join(' ').toLowerCase());
  function passes(t, q, except) {
    if (except !== 'state' && q.state && t.state !== q.state) return false;
    if (except !== 'due' && (q.over || q.risk)) { const d = dueStatus(t); if (!((q.over && d === 'overdue') || (q.risk && d === 'risk'))) return false; }
    if (except !== 'holds' && q.holds !== 'any') {
      if (q.holds === 'with' && !t.holds.length) return false;
      if (q.holds === 'none' && t.holds.length) return false;
      if (q.holds.startsWith('kind:') && !t.holds.some((h) => h.kind === q.holds.slice(5))) return false;
    }
    if (except !== 'dev' && q.dev !== 'any') {
      if (q.dev === 'with' && !t.deviationIds.length) return false;
      if (q.dev === 'none' && t.deviationIds.length) return false;
      if (q.dev.startsWith('DEV') && !t.deviationIds.includes(q.dev)) return false;
    }
    if (except !== 'gxp' && q.gxp !== 'any' && t.gxp !== q.gxp) return false;
    if (except !== 'method' && q.method !== 'any' && t.methodId !== q.method) return false;
    if (except !== 'customer' && q.customer !== 'any' && t.customerId !== q.customer) return false;
    if (except !== 'assignee' && q.assignee) { if (q.assignee === 'none' ? !!t.assigneeId : t.assigneeId !== q.assignee) return false; }
    if (except !== 'q' && q.q) { const words = q.q.toLowerCase().split(/\s+/).filter(Boolean); const k = searchKey(t); if (!words.every((w) => k.includes(w))) return false; }
    return true;
  }
  const openTests = () => S.tests.filter((t) => OPEN_STATES.includes(t.state));
  // Earliest due first; Tests whose clock has not started (no due date before Ready) follow, oldest in state first.
  const byUrgency = (a, b) => (!a.dueDate || !b.dueDate ? (!a.dueDate) - (!b.dueDate) || stateSince(a).localeCompare(stateSince(b)) : a.dueDate.localeCompare(b.dueDate)) || (a.serviceLevel === b.serviceLevel ? 0 : a.serviceLevel === 'Expedited' ? -1 : 1) || a.id.localeCompare(b.id);
  const countBy = (list, except, fn) => list.filter((t) => passes(t, Q(), except) && fn(t)).length;
  const active = (id) => S.tests.filter((t) => t.assigneeId === id && (t.state === 'Assigned' || t.state === 'In Progress'));
  const anyFilter = () => { const q = Q(); return !!(q.q || q.state || q.over || q.risk || q.holds !== 'any' || q.dev !== 'any' || q.gxp !== 'any' || q.method !== 'any' || q.customer !== 'any' || q.assignee); };

  /* ---------- eligibility: the server's answer for the focus Test, the same rule for any other ---------- */
  function refusals(t, personId) {
    if (t.id === L.focus.assignTestId) { const e = L.focus.assignEligibility.find((x) => x.personId === personId); if (e) return e.reasons; }
    const m = DB.methods[t.methodId]; const pre = L.prerequisites; const reasons = [];
    if (!L.trainingRecords.some((r) => r.personId === personId && r.documentNumber === m.number && r.version === m.version)) reasons.push(`No Training Record on ${m.number} v${m.version} (Effective ${m.effectiveDate})`);
    if (!L.trainingRecords.some((r) => r.personId === personId && r.documentNumber === pre.documentNumber && r.version === pre.version)) reasons.push(`No Training Record on ${pre.documentNumber} v${pre.version}`);
    const au = L.authorisations.find((a) => a.personId === personId && a.meaning === 'Performed' && a.scope === m.number && a.lab === L.lab.id);
    if (!au) reasons.push(`No Performed Authorisation for ${m.number}`);
    else if (au.status === 'Suspended') reasons.push(`Performed Authorisation suspended (${au.suspendedBy})`);
    else if (au.status === 'Expired' || au.validUntil < LAB_DAY) reasons.push(`Performed Authorisation expired ${au.validUntil}`);
    return reasons;
  }

  /* ---------- render ---------- */
  V.render = (route, host) => {
    host.innerHTML = `
      <div class="queue">
        <aside class="wl" aria-labelledby="wl-h">
          <div class="wl__head"><h2 id="wl-h" class="h-sec">Workload</h2><p class="wl__lede">Tests per Analyst: <span class="wl__sw wl__sw--prog"></span>In Progress <span class="wl__sw wl__sw--asg"></span>Assigned. Choose one to filter.</p></div>
          <div class="wl__grid" id="wl-grid"></div>
        </aside>
        <section class="qmain" aria-labelledby="q-h">
          <h1 id="q-h" class="sr-only">Lab queue</h1>
          <div class="pipe" id="pipe" role="group" aria-label="Filter by Test state"></div>
          <div class="qbar">
            <label class="search"><span class="sr-only">Search any ID</span>${ic('search')}<input id="q-search" data-fk="q-search" type="search" placeholder="Search any ID" value="${esc(Q().q)}" autocomplete="off" spellcheck="false"><kbd aria-hidden="true">/</kbd></label>
            <div class="qfilters" id="qfilters"></div>
          </div>
          <div class="qmeta" id="qmeta"></div>
          <div class="qtable" id="qtable" data-scroll-key="qtable"></div>
        </section>
        <div id="assign-host"></div>
      </div>`;
    refresh();
    renderAssign();
  };
  function refresh() {
    App.keepState(() => { renderPipe(); renderFilters(); renderMeta(); renderTable(); renderWorkload(); });
  }

  function renderPipe() {
    const list = openTests();
    const total = countBy(list, 'state', () => true);
    const q = Q();
    const seg = (state, n) => `<button type="button" class="pipe__seg${q.state === state ? ' is-on' : ''}" data-act="q-state" data-arg="${esc(state)}" aria-pressed="${q.state === state}" data-fk="pipe-${esc(state)}"><span class="pipe__n num">${n}</span><span class="pipe__name">${esc(state)}</span></button>`;
    $('#pipe').innerHTML = `<button type="button" class="pipe__seg pipe__seg--all${!q.state ? ' is-on' : ''}" data-act="q-state" data-arg="" aria-pressed="${!q.state}" data-fk="pipe-all"><span class="pipe__n num">${total}</span><span class="pipe__name">All open</span></button>` +
      OPEN_STATES.map((s, i) => `${i ? `<span class="pipe__arrow" aria-hidden="true">${ic('chev')}</span>` : ''}${seg(s, countBy(list, 'state', (t) => t.state === s))}`).join('');
  }

  function renderFilters() {
    const list = openTests(); const q = Q();
    const over = countBy(list, 'due', (t) => dueStatus(t) === 'overdue');
    const risk = countBy(list, 'due', (t) => dueStatus(t) === 'risk');
    const opt = (v, label, cur) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(label)}</option>`;
    const kinds = [...new Set(list.flatMap((t) => t.holds.map((h) => h.kind)))].sort();
    const devIds = [...new Set(list.flatMap((t) => t.deviationIds))].sort().reverse();
    const holdsSel = `<label class="sel${q.holds !== 'any' ? ' is-on' : ''}"><span class="sr-only">Holds</span><select data-act-change="q-holds" data-fk="q-holds">
      ${opt('any', 'Any Holds', q.holds)}${opt('with', `With open Holds (${countBy(list, 'holds', (t) => t.holds.length > 0)})`, q.holds)}${opt('none', `No Holds (${countBy(list, 'holds', (t) => !t.holds.length)})`, q.holds)}
      <optgroup label="By kind">${kinds.map((k) => opt(`kind:${k}`, `${k} (${countBy(list, 'holds', (t) => t.holds.some((h) => h.kind === k))})`, q.holds)).join('')}</optgroup></select>${ic('down')}</label>`;
    const devSel = `<label class="sel${q.dev !== 'any' ? ' is-on' : ''}"><span class="sr-only">Deviations</span><select data-act-change="q-dev" data-fk="q-dev">
      ${opt('any', 'Any Deviation', q.dev)}${opt('with', `Linked to a Deviation (${countBy(list, 'dev', (t) => t.deviationIds.length > 0)})`, q.dev)}${opt('none', 'None linked', q.dev)}
      <optgroup label="By Deviation">${devIds.map((d) => { const x = deviation(d); return opt(d, `${d} ${x.kind}, ${x.risk} (${countBy(list, 'dev', (t) => t.deviationIds.includes(d))})`, q.dev); }).join('')}</optgroup></select>${ic('down')}</label>`;
    const gxpSel = `<label class="sel${q.gxp !== 'any' ? ' is-on' : ''}"><span class="sr-only">GxP Class</span><select data-act-change="q-gxp" data-fk="q-gxp">${opt('any', 'Any GxP Class', q.gxp)}${['GMP', 'non-GMP'].map((g) => opt(g, `${g} (${countBy(list, 'gxp', (t) => t.gxp === g)})`, q.gxp)).join('')}</select>${ic('down')}</label>`;
    const methodSel = `<label class="sel${q.method !== 'any' ? ' is-on' : ''}"><span class="sr-only">Method</span><select data-act-change="q-method" data-fk="q-method">${opt('any', 'Any Method', q.method)}${L.methods.map((m) => opt(m.id, `${m.number} v${m.version} ${m.title} (${countBy(list, 'method', (t) => t.methodId === m.id)})`, q.method)).join('')}</select>${ic('down')}</label>`;
    const custSel = `<label class="sel${q.customer !== 'any' ? ' is-on' : ''}"><span class="sr-only">Customer</span><select data-act-change="q-customer" data-fk="q-customer">${opt('any', 'Any Customer', q.customer)}${L.customers.map((c) => opt(c.id, `${c.name} (${countBy(list, 'customer', (t) => t.customerId === c.id)})`, q.customer)).join('')}</select>${ic('down')}</label>`;
    $('#qfilters').innerHTML = `
      <button type="button" class="chip chip--over${q.over ? ' is-on' : ''}" data-act="q-over" aria-pressed="${q.over}" data-fk="q-over">${ic('overdue')}<span>Overdue</span><span class="chip__n num">${over}</span></button>
      <button type="button" class="chip chip--risk${q.risk ? ' is-on' : ''}" data-act="q-risk" aria-pressed="${q.risk}" data-fk="q-risk" title="Due within 2 business days and not yet Submitted for Review">${ic('clock')}<span>At risk</span><span class="chip__n num">${risk}</span></button>
      ${holdsSel}${devSel}${gxpSel}${methodSel}${custSel}`;
    fitSelects();
  }
  // A native select is as wide as its longest option; size each one to the option it shows instead.
  let meter = null;
  function fitSelects() {
    meter = meter || document.createElement('canvas').getContext('2d');
    $$('#qfilters select').forEach((sel) => {
      const cs = getComputedStyle(sel);
      meter.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const text = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
      sel.style.width = `${Math.min(240, Math.ceil(meter.measureText(text).width) + 34)}px`;
    });
  }
  document.fonts && document.fonts.ready.then(() => { if ($('#qfilters')) fitSelects(); });

  function filtered() { return openTests().filter((t) => passes(t, Q())).sort(byUrgency); }

  function renderMeta() {
    const n = filtered().length; const total = openTests().length; const q = Q();
    const who = q.assignee === 'none' ? 'unassigned' : q.assignee ? `assigned to ${person(q.assignee).name}` : '';
    $('#qmeta').innerHTML = `<p><b class="num">${n}</b> of <span class="num">${total}</span> open Tests${who ? `, ${esc(who)}` : ''}, earliest due first. <span class="qmeta__rule">At risk: due within 2 business days and not yet Submitted for Review.</span></p>${anyFilter() ? `<button type="button" class="btn btn--quiet btn--small" data-act="q-clear" data-fk="q-clear">Clear filters</button>` : ''}`;
  }

  function renderTable() {
    const rows = filtered(); const q = Q();
    if (q.sel && !rows.some((t) => t.id === q.sel) && !(q.assign && q.assign.testId === q.sel)) q.sel = null;
    const cursor = rows.some((t) => t.id === q.cursor) ? q.cursor : q.sel && rows.some((t) => t.id === q.sel) ? q.sel : rows[0] && rows[0].id;
    const body = rows.map((t) => rowHTML(t, t.id === q.sel, t.id === cursor)).join('');
    $('#qtable').innerHTML = rows.length ? `
      <table class="q">
        <caption class="sr-only">Open Tests, earliest due first. Use the arrow keys to move and Enter to select.</caption>
        <colgroup><col class="c-test"><col class="c-cust"><col class="c-meth"><col class="c-class"><col class="c-state"><col class="c-due"><col class="c-who"><col class="c-flags"></colgroup>
        <thead><tr><th scope="col">Test and Sample</th><th scope="col">Customer, Product and Lot</th><th scope="col">Method</th><th scope="col">Class</th><th scope="col">State</th><th scope="col">Due</th><th scope="col">Assignee</th><th scope="col">Holds and Deviations</th></tr></thead>
        <tbody>${body}</tbody>
      </table>` : `<div class="empty"><p class="empty__title">No open Tests match these filters.</p><p>Widen the search or clear the filters to see all ${openTests().length}.</p><button type="button" class="btn" data-act="q-clear">Clear filters</button></div>`;
  }
  function rowHTML(t, sel, cursor) {
    const s = sample(t); const p = DB.products[t.productId]; const m = DB.methods[t.methodId]; const d = dueStatus(t);
    const who = t.assigneeId ? `<span class="clip">${esc(person(t.assigneeId).name)}</span>${t.reviewerId && t.state !== 'In Progress' ? `<span class="sub clip">Reviewer ${esc(person(t.reviewerId).name)}</span>` : ''}` : `<span class="unassigned">Unassigned</span>`;
    const devs = t.deviationIds.length ? devTag(t.deviationIds[0]) + (t.deviationIds.length > 1 ? `<span class="more">+${t.deviationIds.length - 1}</span>` : '') : '';
    const flags = holdTag(t.holds) + devs;
    return `
      <tr class="qr qr--${d}${sel ? ' is-sel' : ''}" data-id="${t.id}" tabindex="${cursor ? 0 : -1}" aria-selected="${sel}" data-fk="row-${t.id}">
        <td><span class="qr__id num">${t.id}</span><span class="sub num">${esc(t.sampleId)}</span></td>
        <td title="${esc(`${DB.customers[t.customerId].name}: ${p.name}, lot ${s.lot}`)}"><span class="clip">${esc(DB.customers[t.customerId].name)}</span><span class="sub clip">Lot <span class="num">${esc(s.lot)}</span>, ${esc(p.name)}</span></td>
        <td title="${esc(`${m.number} v${m.version}: ${m.title}`)}"><span class="clip num">${esc(m.number)} v${m.version}</span><span class="sub clip">${esc(m.title)}</span></td>
        <td>${gxpTag(t.gxp)}<span class="sub${t.serviceLevel === 'Expedited' ? ' sub--exp' : ''}">${esc(t.serviceLevel)}</span></td>
        <td>${stateTag(t)}</td>
        <td>${dueCell(t)}</td>
        <td>${who}</td>
        <td><span class="flags">${flags || '<span class="none">None</span>'}</span></td>
      </tr>${sel ? detailHTML(t) : ''}`;
  }
  function detailHTML(t) {
    const s = sample(t);
    const holds = t.holds.length ? `<ul class="dl-list">${t.holds.map((h) => `<li><span class="tag tag--hold">${ic('hold')}${esc(h.kind)}</span><p>${esc(h.reason)}</p><p class="sub">Blocks ${esc(blocksText(h.blocks))}. Open since ${fmt.stamp(h.openedAt)}${h.releasedBy ? `; released by the ${esc(h.releasedBy)}` : ''}${h.deviationId ? `; ${esc(h.deviationId)}` : ''}.</p></li>`).join('')}</ul>` : `<p class="none">No open Holds.</p>`;
    const devs = t.deviationIds.length ? `<ul class="dl-list">${t.deviationIds.map((id) => { const d = deviation(id); return `<li><span class="dev-line">${devTag(id)}${riskTag(d.risk)}<span class="dstate">${esc(d.state)}</span></span><p>${esc(d.kind)}: ${esc(d.title)}</p><p class="sub">Investigator ${esc(person(d.investigatorId).name)}, due ${fmt.day(d.dueDate)}.</p></li>`; }).join('')}</ul>` : `<p class="none">No linked Deviations.</p>`;
    const hist = `<ol class="hist">${t.history.map((h) => `<li><span class="hist__state">${esc(h.state)}</span><span class="sub num">${fmt.stamp(h.at)}${h.by ? `, ${esc(person(h.by).name)}` : ''}</span></li>`).join('')}</ol>`;
    return `<tr class="qd" aria-hidden="false"><td colspan="8"><div class="qd__grid">
      <section><h3 class="h-mini">Holds</h3>${holds}</section>
      <section><h3 class="h-mini">Deviations</h3>${devs}</section>
      <section><h3 class="h-mini">State history</h3>${hist}</section>
      <section><h3 class="h-mini">Sample</h3><p>${esc(s.id)}, Customer reference ${esc(s.customerRef)}</p><p class="sub">Stored ${esc(s.storage)}. Received ${fmt.stamp(s.receivedAt)}. Submission ${esc(t.submissionId)}.${s.stability ? ` Stability ${esc(s.stability.protocol)}, ${esc(s.stability.condition)}, ${esc(s.stability.timePoint)}.` : ''}${t.nonGmpReason ? ` Non-GMP: ${esc(t.nonGmpReason)}.` : ''}</p></section>
    </div></td></tr>`;
  }

  function renderWorkload() {
    const q = Q();
    const loads = analysts.map((p) => { const a = active(p.id); return { p, n: a.length, prog: a.filter((t) => t.state === 'In Progress').length }; });
    const max = Math.max(12, ...loads.map((x) => x.n));
    const un = openTests().filter((t) => !t.assigneeId).length;
    const unReady = openTests().filter((t) => !t.assigneeId && t.state === 'Ready').length;
    $('#wl-grid').innerHTML = `
      <button type="button" class="wl__tile wl__tile--un${q.assignee === 'none' ? ' is-on' : ''}" data-act="q-assignee" data-arg="none" aria-pressed="${q.assignee === 'none'}" data-fk="wl-none">
        <span class="wl__name">Unassigned</span><span class="wl__n num">${un}</span><span class="wl__sub">${unReady} Ready to assign</span>
      </button>` + loads.map(({ p, n, prog }) => `
      <button type="button" class="wl__tile${q.assignee === p.id ? ' is-on' : ''}" data-act="q-assignee" data-arg="${p.id}" aria-pressed="${q.assignee === p.id}" data-fk="wl-${p.id}" aria-label="${esc(p.name)}: ${n} active, ${prog} In Progress">
        <span class="wl__name">${esc(p.name)}</span>
        <span class="wl__bar" aria-hidden="true"><i class="wl__prog" style="width:${(prog / max) * 100}%"></i><i class="wl__asg" style="width:${((n - prog) / max) * 100}%"></i></span><span class="wl__n num">${n}</span>
      </button>`).join('');
  }

  /* ---------- the assignment sheet ---------- */
  function renderAssign() {
    const host = $('#assign-host'); if (!host) return;
    const a = Q().assign;
    if (!a) { host.innerHTML = ''; return; }
    const t = S.testIdx[a.testId]; const s = sample(t); const p = DB.products[t.productId]; const m = DB.methods[t.methodId]; const pre = L.prerequisites;
    const all = analysts.map((x) => ({ p: x, reasons: refusals(t, x.id), n: active(x.id).length, prog: active(x.id).filter((y) => y.state === 'In Progress').length }));
    const ok = all.filter((x) => !x.reasons.length).sort((x, y) => x.n - y.n || x.p.name.localeCompare(y.p.name));
    const no = all.filter((x) => x.reasons.length).sort((x, y) => x.p.name.localeCompare(y.p.name));
    const max = Math.max(12, ...all.map((x) => x.n));
    host.innerHTML = `
      <div class="scrim scrim--view" data-act="assign-cancel"></div>
      <section class="sheet sheet--assign${a.animate ? ' enter' : ''}" id="assign-sheet" role="dialog" aria-modal="true" aria-labelledby="as-title" aria-describedby="as-rule">
        <header class="sheet__head">
          <div class="as__title"><h2 id="as-title" class="h-screen">Assign <span class="num">${t.id}</span></h2><span class="as__state">${App.lib.track(t.state)}${esc(t.state)}</span>${gxpTag(t.gxp)}<span class="as__svc${t.serviceLevel === 'Expedited' ? ' sub--exp' : ''}">${esc(t.serviceLevel)}</span><span class="as__due">${App.lib.dueCell(t)}</span></div>
          <dl class="facts">
            <div><dt>Sample</dt><dd class="num">${esc(t.sampleId)}</dd></div>
            <div><dt>Customer</dt><dd>${esc(DB.customers[t.customerId].name)}</dd></div>
            <div><dt>Product and Lot</dt><dd>${esc(p.name)} <span class="num">${esc(p.code)}</span>, lot <span class="num">${esc(s.lot)}</span></dd></div>
            <div><dt>Method</dt><dd><span class="num">${esc(m.number)} v${m.version}</span> ${esc(m.title)}</dd></div>
          </dl>
          <p class="as__rule" id="as-rule">${ic('lock')}<span>Refused, with no override, unless the Analyst has Training Records on ${esc(m.number)} v${m.version} and ${esc(pre.documentNumber)} v${pre.version}, and a current Performed Authorisation for ${esc(m.number)} in Lab ${esc(L.lab.id)}.</span></p>
        </header>
        <div class="sheet__body as" data-scroll-key="assign-body">
          <fieldset class="as__ok">
            <legend class="h-sec">Can be assigned <span class="num">(${ok.length})</span><span class="as__hint">lightest workload first</span></legend>
            <div class="as__grid" role="radiogroup" aria-label="Eligible Analysts">
              ${ok.map((x) => `
              <label class="pick${a.choice === x.p.id ? ' is-on' : ''}">
                <input type="radio" name="assignee" value="${x.p.id}" class="pick__input" data-act-change="assign-pick" data-fk="pick-${x.p.id}"${a.choice === x.p.id ? ' checked' : ''}>
                <span class="pick__dot" aria-hidden="true"></span>
                <span class="pick__name">${nameLine(x.p)}</span>
                <span class="pick__n num">${x.n}<span class="pick__unit"> active</span></span>
                <span class="pick__bar" aria-hidden="true"><i class="wl__prog" style="width:${(x.prog / max) * 100}%"></i><i class="wl__asg" style="width:${((x.n - x.prog) / max) * 100}%"></i></span>
              </label>`).join('')}
            </div>
          </fieldset>
          <section class="as__no" aria-labelledby="as-no-h">
            <h3 id="as-no-h" class="h-sec">Refused <span class="num">(${no.length})</span><span class="as__hint">cannot be chosen</span></h3>
            <ul class="refused">
              ${no.map((x) => `<li class="refused__row"><span class="refused__head">${ic('noentry')}<span class="refused__name">${nameLine(x.p)}</span><span class="refused__n num">${x.n} active</span></span>${x.reasons.map((r) => `<span class="refused__why">${esc(r)}</span>`).join('')}</li>`).join('')}
            </ul>
          </section>
        </div>
      </section>`;
    if (a.animate) { const sh = $('#assign-sheet'); requestAnimationFrame(() => requestAnimationFrame(() => sh && sh.classList.remove('enter'))); a.animate = false; }
  }
  function openAssign(testId, animate = true) {
    Q().sel = testId; Q().cursor = testId;
    Q().assign = { testId, choice: null, animate, opener: document.activeElement };
    S.route = 'assign'; history.replaceState(null, '', '#assign');
    App.show();
    const first = $('#assign-sheet .pick__input'); if (first) first.focus({ preventScroll: true });
  }
  function closeAssign() {
    const a = Q().assign; if (!a) return;
    const sh = $('#assign-sheet');
    const finish = () => { Q().assign = null; S.route = 'queue'; history.replaceState(null, '', '#queue'); App.show(); const r = $(`tr[data-id="${a.testId}"]`); if (r) r.focus({ preventScroll: true }); };
    if (sh && !matchMedia('(prefers-reduced-motion: reduce)').matches) { sh.classList.add('leave'); const sc = $('.scrim--view'); if (sc) sc.classList.add('leave'); setTimeout(finish, 170); } else finish();
  }

  /* ---------- rail ---------- */
  V.rail = () => {
    const q = Q();
    if (q.assign) {
      const t = S.testIdx[q.assign.testId]; const c = q.assign.choice && person(q.assign.choice);
      return {
        context: `<span class="ctx__main">Assigning <span class="num">${t.id}</span>${c ? ` to <b>${esc(c.name)}</b>` : ''}</span><span class="ctx__sub">${c ? `${active(c.id).length} active now. Recorded in the audit trail; not signed.` : 'Choose an Analyst who can be assigned.'}</span>`,
        actions: [
          { act: 'assign-cancel', label: 'Cancel' },
          { act: 'assign-commit', label: c ? `Assign to ${c.name.split(' ')[0]}` : 'Assign', kind: 'primary', icon: 'check', disabled: !c, why: 'Choose an Analyst first.', fk: 'assign-go' },
        ],
      };
    }
    const t = q.sel && S.testIdx[q.sel];
    if (t) {
      const canAssign = t.state === 'Ready' && !t.assigneeId;
      const why = !isManager() ? 'Only a Lab Manager assigns Tests.' : canAssign ? '' : `${t.id} is ${t.state}${t.assigneeId ? `, assigned to ${person(t.assigneeId).name}` : ''}. Only Ready Tests can be assigned.`;
      const actions = [{ act: 'q-assign', arg: t.id, label: 'Assign…', kind: 'primary', icon: 'check', disabled: !!why, why, fk: 'rail-assign' }];
      if (t.id === L.focus.test.testId) actions.unshift({ act: 'q-open', label: 'Open workspace', icon: 'next' });
      return { context: `<span class="ctx__main"><span class="num">${t.id}</span> ${esc(t.state)}${t.assigneeId ? `, ${esc(person(t.assigneeId).name)}` : ', unassigned'}</span><span class="ctx__sub">${esc(DB.products[t.productId].name)}, ${esc(t.methodNumber)} v${t.methodVersion}, ${t.dueDate ? `due ${fmt.day(t.dueDate)}` : 'no due date until Ready'}${t.holds.length ? `, ${plural(t.holds.length, 'open Hold')}` : ''}</span>`, actions };
    }
    const ready = openTests().filter((x) => x.state === 'Ready' && !x.assigneeId).sort(byUrgency);
    const next = ready[0];
    return {
      context: next ? `<span class="ctx__main"><b class="num">${ready.length}</b> Ready to assign</span><span class="ctx__sub">Most urgent: <span class="num">${next.id}</span>, ${esc(next.serviceLevel)}, due ${fmt.day(next.dueDate)}</span>` : `<span class="ctx__main">Nothing waiting to be assigned</span>`,
      actions: next ? [{ act: 'q-assign-next', label: 'Assign next Ready Test', kind: 'primary', icon: 'check', disabled: !isManager(), why: 'Only a Lab Manager assigns Tests.' }] : [],
    };
  };
  V.onEscape = () => { if (Q().assign) { closeAssign(); return true; } if (Q().sel) { Q().sel = null; refresh(); App.renderRail(); return true; } return false; };
  V.modalRoots = () => (Q().assign ? [$('#assign-sheet'), $('#rail')] : null);

  /* ---------- actions ---------- */
  const set = (patch) => { Object.assign(Q(), patch); refresh(); App.renderRail(); };
  App.act['q-state'] = (el) => set({ state: Q().state === el.dataset.arg || !el.dataset.arg ? null : el.dataset.arg });
  App.act['q-over'] = () => set({ over: !Q().over });
  App.act['q-risk'] = () => set({ risk: !Q().risk });
  App.act['q-assignee'] = (el) => set({ assignee: Q().assignee === el.dataset.arg ? null : el.dataset.arg });
  App.act['q-clear'] = () => { const keep = { sel: Q().sel, cursor: Q().cursor }; V.reset(); Object.assign(Q(), keep); const s = $('#q-search'); if (s) s.value = ''; refresh(); App.renderRail(); };
  App.act['q-assign'] = (el) => openAssign(el.dataset.arg);
  App.act['q-assign-next'] = () => { const next = openTests().filter((x) => x.state === 'Ready' && !x.assigneeId).sort(byUrgency)[0]; if (next) openAssign(next.id); };
  App.act['q-open'] = () => App.go(App.views.test.routeNow());
  App.act['assign-cancel'] = () => closeAssign();
  App.act['assign-commit'] = () => {
    const a = Q().assign; const t = S.testIdx[a.testId]; const p = person(a.choice);
    if (!p || refusals(t, p.id).length || !isManager()) return;
    const at = now();
    t.state = 'Assigned'; t.assigneeId = p.id; t.history.push({ state: 'Assigned', at: at.toISOString(), by: S.userId }); delete t._s;
    audit(`Assigned ${t.id} to ${p.username}`);
    const sh = $('#assign-sheet');
    const finish = () => {
      Q().assign = null; Q().sel = t.id; Q().cursor = t.id;
      S.route = 'queue'; history.replaceState(null, '', '#queue');
      App.show();
      const r = $(`tr[data-id="${t.id}"]`); if (r) { r.focus({ preventScroll: true }); r.scrollIntoView({ block: 'nearest' }); }
      receipt({ title: `${t.id} assigned to ${p.name}`, body: `Recorded in the audit trail at ${fmt.hm(at)} EDT (${fmt.hmUtc(at)} UTC). Audited, not signed.`, ms: 9000 });
    };
    if (sh && !matchMedia('(prefers-reduced-motion: reduce)').matches) { sh.classList.add('leave'); const sc = $('.scrim--view'); if (sc) sc.classList.add('leave'); setTimeout(finish, 170); } else finish();
  };

  /* change and input events */
  document.addEventListener('change', (e) => {
    const k = e.target.dataset.actChange; if (!k) return;
    const map = { 'q-holds': 'holds', 'q-dev': 'dev', 'q-gxp': 'gxp', 'q-method': 'method', 'q-customer': 'customer' };
    if (map[k]) set({ [map[k]]: e.target.value });
    if (k === 'assign-pick') { Q().assign.choice = e.target.value; $$('#assign-sheet .pick').forEach((l) => l.classList.toggle('is-on', l.querySelector('input').checked)); App.renderRail(); }
  });
  let searchTimer = null;
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'q-search') return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { Q().q = e.target.value.trim(); Q().cursor = null; renderPipe(); renderFilters(); renderMeta(); renderTable(); App.renderRail(); }, 90);
  });

  /* row selection by pointer and keyboard (roving tabindex) */
  document.addEventListener('click', (e) => {
    const tr = e.target.closest('tr.qr'); if (!tr || e.target.closest('[data-act]')) return;
    selectRow(tr.dataset.id, true);
  });
  function selectRow(id, toggle) {
    const q = Q();
    q.sel = toggle && q.sel === id ? null : id; q.cursor = id;
    App.keepState(() => renderTable());
    const r = $(`tr[data-id="${id}"]`); if (r) r.focus({ preventScroll: true });
    App.renderRail();
  }
  document.addEventListener('keydown', (e) => {
    if (S.locked || S.sign) return;
    const inView = S.route === 'queue' || S.route === 'assign';
    if (!inView) return;
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !Q().assign) { e.preventDefault(); $('#q-search').focus(); return; }
    const tr = e.target.closest && e.target.closest('tr.qr'); if (!tr) return;
    const rows = $$('tr.qr');
    const i = rows.indexOf(tr);
    const move = (j) => { const r = rows[Math.max(0, Math.min(rows.length - 1, j))]; if (!r) return; rows.forEach((x) => x.tabIndex = -1); r.tabIndex = 0; Q().cursor = r.dataset.id; r.focus(); r.scrollIntoView({ block: 'nearest' }); };
    if (e.key === 'ArrowDown') { e.preventDefault(); move(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(rows.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRow(tr.dataset.id, true); }
    else if ((e.key === 'a' || e.key === 'A') && isManager()) { const t = S.testIdx[tr.dataset.id]; if (t.state === 'Ready' && !t.assigneeId) { e.preventDefault(); openAssign(t.id); } }
  });
})();

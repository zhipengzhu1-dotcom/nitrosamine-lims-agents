/* queue.js: the Lab queue. Dense to read (two-line rows, one table for 327 open Tests),
   glove-size where it acts (the pipeline segments, the Assign keys, the workload columns). */
(() => {
  'use strict';
  const LX = window.LX, { h, raw, icon } = LX, M = LX.M, T = LX.t, U = LX.U, S = LX.S;

  const q = (S.q = { states: new Set(), assignee: '', method: '', customer: '', gxp: '', hold: '', overdue: false, risk: false, closed: false, q: '', sortKey: 'due', sortDir: 1, selected: null });
  const openRows = M.rows.filter((r) => r.open);

  /* ---------- filtering ---------- */
  const matches = (r, f, skipState) => {
    if (!f.closed && !r.open) return false;
    if (!skipState && f.states.size && !f.states.has(r.state)) return false;
    if (f.assignee && (f.assignee === 'none' ? r.assignee : r.assignee?.id !== f.assignee)) return false;
    if (f.method && r.t.methodId !== f.method) return false;
    if (f.customer && r.t.customerId !== f.customer) return false;
    if (f.gxp && r.t.gxp !== f.gxp) return false;
    if (f.hold === 'any' ? !r.nHolds : f.hold === 'none' ? r.nHolds : f.hold && !r.holds.some((x) => x.kind === f.hold)) return false;
    if (f.overdue && r.due.kind !== 'overdue') return false;
    if (f.risk && r.due.kind !== 'today' && r.due.kind !== 'risk') return false;
    if (f.q) { const tokens = f.q.toLowerCase().split(/\s+/).filter(Boolean); if (!tokens.every((tk) => r.hay.includes(tk))) return false; }
    return true;
  };
  const dueKey = (r) => (r.t.dueDate && r.open ? Date.parse(r.t.dueDate) : Infinity);
  const CMP = {
    id: (a, b) => a.id.localeCompare(b.id),
    customer: (a, b) => a.customer.name.localeCompare(b.customer.name) || a.product.name.localeCompare(b.product.name),
    method: (a, b) => a.t.methodNumber.localeCompare(b.t.methodNumber) || a.t.methodVersion - b.t.methodVersion,
    gxp: (a, b) => a.t.gxp.localeCompare(b.t.gxp) || a.t.serviceLevel.localeCompare(b.t.serviceLevel),
    state: (a, b) => a.no - b.no,
    age: (a, b) => b.since - a.since,
    assignee: (a, b) => (a.assignee?.name ?? '￿').localeCompare(b.assignee?.name ?? '￿'),
    holds: (a, b) => b.nHolds - a.nHolds,
  };
  const sorted = (rows) => {
    const k = q.sortKey, d = q.sortDir;
    return rows.slice().sort((a, b) => {
      if (k === 'due') { const x = dueKey(a), y = dueKey(b); if (x === Infinity || y === Infinity) return x === y ? a.id.localeCompare(b.id) : x === Infinity ? 1 : -1; return (x - y) * d || a.id.localeCompare(b.id); }
      return CMP[k](a, b) * d || a.id.localeCompare(b.id);
    });
  };
  const anyFilter = () => q.states.size || q.assignee || q.method || q.customer || q.gxp || q.hold || q.overdue || q.risk || q.closed || q.q;

  /* ---------- frame ---------- */
  const optionsOf = (items, sel, all) => h`<option value="">${all}</option>${items.map(([v, l]) => h`<option value="${v}" ${v === sel ? raw('selected') : ''}>${l}</option>`)}`;
  const countBy = (fn) => { const m = new Map(); for (const r of openRows) { const k = fn(r); if (k != null) m.set(k, (m.get(k) ?? 0) + 1); } return m; };

  function frame() {
    const cAsg = countBy((r) => r.assignee?.id ?? 'none'); const cMeth = countBy((r) => r.t.methodId); const cCust = countBy((r) => r.t.customerId);
    const cHold = new Map(); for (const r of openRows) for (const x of new Set(r.holds.map((y) => y.kind))) cHold.set(x, (cHold.get(x) ?? 0) + 1);
    const nHeld = openRows.filter((r) => r.nHolds).length;
    return h`
    <section class="q" aria-label="Lab queue">
      <h1 class="sr-only">Lab queue</h1>
      <div class="q__pipe" id="q-pipe" role="group" aria-label="Filter by state"></div>
      <div class="q__filters" id="q-filters" role="search">
        <label class="search"><span class="sr-only">Search any ID</span>${icon('search')}<input id="q-search" type="search" placeholder="Search any ID" autocomplete="off" spellcheck="false" value="${q.q}"></label>
        <select class="field" id="f-assignee" aria-label="Assignee" data-f="assignee">${optionsOf([['none', `Unassigned (${cAsg.get('none') ?? 0})`], ...M.analysts.map((p) => [p.id, `${p.name} (${cAsg.get(p.id) ?? 0})`])], q.assignee, 'Any assignee')}</select>
        <select class="field" id="f-method" aria-label="Method" data-f="method">${optionsOf(L_methods().map((m) => [m.id, `${m.number} v${m.version} (${cMeth.get(m.id) ?? 0})`]), q.method, 'Any Method')}</select>
        <select class="field" id="f-customer" aria-label="Customer" data-f="customer">${optionsOf(window.LIMS.customers.map((c) => [c.id, `${c.name} (${cCust.get(c.id) ?? 0})`]), q.customer, 'Any Customer')}</select>
        <select class="field" id="f-gxp" aria-label="GxP Class" data-f="gxp">${optionsOf([['GMP', 'GMP'], ['non-GMP', 'non-GMP']], q.gxp, 'Any GxP Class')}</select>
        <select class="field" id="f-hold" aria-label="Holds" data-f="hold">${optionsOf([['any', `With Holds (${nHeld})`], ['none', 'Without Holds'], ...[...cHold].sort().map(([k, n]) => [k, `${k} (${n})`])], q.hold, 'Holds: any')}</select>
        <button class="btn tog" id="f-overdue" data-act="q-toggle" data-k="overdue" aria-pressed="${q.overdue}">${icon('alert')}Overdue <b class="num" id="n-overdue"></b></button>
        <button class="btn tog" id="f-risk" data-act="q-toggle" data-k="risk" aria-pressed="${q.risk}">${icon('clock')}At risk <b class="num" id="n-risk"></b></button>
        <button class="btn tog" id="f-closed" data-act="q-toggle" data-k="closed" aria-pressed="${q.closed}" title="Include Reported, Rejected, Cancelled and Invalidated Tests">Closed</button>
        <button class="btn btn--quiet" id="f-clear" data-act="q-clear" hidden>${icon('reset')}Clear filters</button>
      </div>
      <div class="q__load" id="q-load"></div>
      <div class="q__table" id="q-table" role="region" aria-label="Tests" tabindex="0">
        <table class="qt">
          <colgroup><col class="k-test"><col class="k-cust"><col class="k-meth"><col class="k-gxp"><col class="k-state"><col class="k-due"><col class="k-asg"><col class="k-hold"></colgroup>
          <thead><tr>
            ${th('id', 'Test and Sample')}${th('customer', 'Customer, Product and Lot')}${th('method', 'Method')}${th('gxp', 'GxP Class')}${th('state', 'State, time in it')}${th('due', 'Due date')}${th('assignee', 'Assignee')}${th('holds', 'Holds, Deviations')}
          </tr></thead>
          <tbody id="q-body"></tbody>
        </table>
      </div>
      <p class="sr-only" id="q-status" role="status" aria-live="polite"></p>
    </section>`;
  }
  const L_methods = () => window.LIMS.methods.slice().sort((a, b) => a.number.localeCompare(b.number));
  const th = (k, label) => h`<th scope="col" data-k="${k}" aria-sort="${q.sortKey === k ? (q.sortDir === 1 ? 'ascending' : 'descending') : 'none'}"><button data-act="q-sort" data-k="${k}">${label}${icon(q.sortKey === k && q.sortDir === -1 ? 'chev-u' : 'chev-d', 'ico--s th__ar')}</button></th>`;

  /* ---------- pipeline: counts per state (other filters applied, the state filter not) ---------- */
  function paintPipe() {
    const rows = M.rows.filter((r) => matches(r, q, true)); const per = new Map(M.OPEN_STATES.map((s) => [s, { n: 0, over: 0, held: 0 }]));
    let total = 0;
    for (const r of rows) { const e = per.get(r.state); if (!e) continue; e.n++; total++; if (r.due.kind === 'overdue') e.over++; if (r.nHolds) e.held++; }
    const next = M.nextReady(); const nReady = per.get('Ready').n; const allReady = M.rows.filter((r) => r.state === 'Ready').length;
    document.getElementById('q-pipe').innerHTML = String(h`
      <div class="segs">
        <button class="seg seg--all" data-act="q-state" data-state="" aria-pressed="${q.states.size === 0}" style="--n:0"><b class="seg__n num">${LX.int(total)}</b><span class="seg__l">${q.closed ? 'All shown' : 'All open'}</span></button>
        ${M.OPEN_STATES.map((s, i) => { const e = per.get(s); return h`
          <button class="seg" data-act="q-state" data-state="${s}" aria-pressed="${q.states.has(s)}" style="--n:${i + 1}" aria-label="${s}: ${e.n} Tests, ${e.over} overdue, ${e.held} with Holds">
            <span class="seg__top"><b class="seg__n num">${e.n}</b><span class="seg__m">${e.over ? h`<span class="mini mini--over">${icon('alert', 'ico--s')}${e.over}</span>` : ''}${e.held ? h`<span class="mini mini--held"><i class="mini__hatch"></i>${e.held}</span>` : ''}</span></span>
            <span class="seg__l">${s}</span>
          </button>`; })}
      </div>
      ${next ? h`<button class="key key--stack next" data-act="assign-open" data-id="${next.id}"><span>${icon('user')}Assign next Ready Test <span class="next__n num">${allReady}</span></span><small class="mono">${next.id}, ${next.t.serviceLevel}, due ${next.t.dueDate}</small></button>`
        : h`<div class="next next--none"><b>No Ready Test is waiting</b><small>Nothing to assign.</small></div>`}`);
    document.getElementById('n-overdue').textContent = openRows.filter((r) => r.due.kind === 'overdue').length;
    document.getElementById('n-risk').textContent = openRows.filter((r) => r.due.kind === 'today' || r.due.kind === 'risk').length;
  }

  /* ---------- workload of all 20 Analysts ---------- */
  function paintLoad() {
    const w = [...M.workload().values()].sort((a, b) => a.p.name.localeCompare(b.p.name)); const max = 16;
    const avg = w.reduce((s, x) => s + x.open, 0) / w.length;
    document.getElementById('q-load').innerHTML = String(h`
      <div class="load__cap"><b>Workload</b><span>Open Tests per Analyst, all ${w.length}. Tap one to filter.</span></div>
      <div class="load__cols" role="group" aria-label="Open Tests per Analyst, all ${w.length}" style="--avg:${(avg / max) * 100}%">
        ${w.map((x) => h`<button class="lcol" data-act="q-assignee" data-p="${x.p.id}" aria-pressed="${q.assignee === x.p.id}" aria-label="${x.p.name}: ${x.open} open Tests, ${x.overdue} overdue. Filter the queue to this Analyst." title="${x.p.name}: ${x.ip} In Progress, ${x.assigned} Assigned, ${x.overdue} overdue, ${x.review} with a Reviewer">
          <span class="lcol__n num">${x.open}</span>
          <span class="lcol__bar"><i class="lcol__as" style="height:${(x.assigned / max) * 100}%"></i><i class="lcol__ip" style="height:${(x.ip / max) * 100}%"></i>${x.overdue ? h`<i class="lcol__od" style="height:${(x.overdue / max) * 100}%"></i>` : ''}</span>
          <span class="lcol__i">${M.initials(x.p)}</span>
        </button>`)}
      </div>
      <div class="load__leg" aria-hidden="true"><span><i class="wbar__key wbar__key--ip"></i>In Progress</span><span><i class="wbar__key wbar__key--as"></i>Assigned</span><span><i class="wbar__key wbar__key--od"></i>Overdue</span><span><i class="load__avgkey"></i>Average ${avg.toFixed(1)}</span></div>`);
  }

  /* ---------- rows ---------- */
  const asgCell = (r) => {
    if (r.assignee) return h`<span class="l1 asg"><span class="av" style="--av:1.5rem" aria-hidden="true">${M.initials(r.assignee)}</span><span class="ell">${r.assignee.name}</span></span><span class="l2 muted">${(loadCache ??= M.workload()).get(r.assignee.id)?.open ?? ''} open</span>`;
    if (r.state === 'Ready') return h`<button class="btn btn--accent btn--row" data-act="assign-open" data-id="${r.id}">${icon('user')}Assign</button>`;
    return h`<span class="l1 muted">Unassigned</span><span class="l2 muted">${r.state === 'Requested' ? 'Awaiting Acceptance' : r.state === 'Accepted' ? 'Awaiting Sample receipt' : ''}</span>`;
  };
  let loadCache = null;
  const rowHtml = (r) => {
    const cls = `qr${r.due.kind === 'overdue' ? ' is-overdue' : ''}${r.nHolds ? ' is-held' : ''}${q.selected === r.id ? ' is-sel' : ''}${r.open ? '' : ' is-closed'}`;
    return h`<tr class="${cls}" data-id="${r.id}">
      <td class="c-test"><button class="cellbtn" data-act="peek" data-id="${r.id}" aria-label="${r.id}, open Test details"><span class="l1 mono">${r.id}</span><span class="l2 mono">${r.sample.id}${r.t.flags ? ` ${r.t.flags.join(' ')}` : ''}</span></button></td>
      <td class="c-cust"><span class="l1 ell" title="${r.customer.name}">${r.customer.name}</span><span class="l2 ell">${r.product.name} <span class="mono">${r.sample.lot}</span></span></td>
      <td class="c-meth"><span class="l1 mono">${r.t.methodNumber} v${r.t.methodVersion}</span><span class="l2 ell" title="${r.method.title}">${r.method.title}</span></td>
      <td class="c-gxp"><span class="l1">${U.gxp(r.t.gxp)}</span><span class="l2">${U.service(r.t.serviceLevel)}</span></td>
      <td class="c-state"><span class="l1 sname">${r.state}</span><span class="l2 st2">${U.notch(r.no, !r.no ? 'is-void' : r.state === 'Reported' ? 'is-done' : '')}<span>${r.open ? `for ${T.age(T.now() - r.since)}` : `since ${T.date(r.since)}`}</span></span></td>
      <td class="c-due"><span class="l1 mono">${r.t.dueDate && r.open ? r.t.dueDate : '—'}</span><span class="l2">${U.due(r.due)}</span></td>
      <td class="c-asg">${asgCell(r)}</td>
      <td class="c-hold">${r.nHolds ? h`<button class="cellbtn cellbtn--hold" data-act="pop-holds" data-id="${r.id}" aria-haspopup="dialog" aria-label="${r.nHolds} open Holds on ${r.id}: ${r.holds.map((x) => x.kind).join(', ')}. Show reasons."><span class="l1">${U.hold(r.nHolds)}${r.t.deviationIds.slice(0, 1).map(U.dev)}</span><span class="l2 ell">${r.holds[0].kind}${r.nHolds > 1 ? ` and ${r.nHolds - 1} more` : ''}</span></button>` : h`<span class="l1 muted">—</span>`}</td>
    </tr>`;
  };
  function paintTable() {
    loadCache = null;
    const rows = sorted(M.rows.filter((r) => matches(r, q, false)));
    const body = document.getElementById('q-body');
    if (!rows.length) {
      const closedHits = !q.closed && q.q ? M.rows.filter((r) => !r.open && matches(r, { ...q, closed: true }, false)).length : 0;
      body.innerHTML = String(h`<tr class="qr--empty"><td colspan="8"><div class="empty"><b>No Test matches these filters.</b>${closedHits ? h`<span>${LX.plural(closedHits, 'closed Test')} match${closedHits === 1 ? 'es' : ''} the search.</span><button class="btn" data-act="q-toggle" data-k="closed">Include closed Tests</button>` : h`<span>Loosen a filter, or clear them all.</span>`}<button class="btn btn--primary" data-act="q-clear">Clear filters</button></div></td></tr>`);
    } else body.innerHTML = rows.map((r) => String(rowHtml(r))).join('');
    document.getElementById('q-status').textContent = `${rows.length} ${rows.length === 1 ? 'Test' : 'Tests'} shown`;
    const cl = document.getElementById('f-clear'); cl.hidden = !anyFilter();
    for (const el of document.querySelectorAll('#q-filters select')) el.classList.toggle('is-set', !!el.value);
    for (const th of document.querySelectorAll('.qt th[data-k]')) {
      const on = th.dataset.k === q.sortKey; th.setAttribute('aria-sort', on ? (q.sortDir === 1 ? 'ascending' : 'descending') : 'none');
      th.querySelector('use').setAttribute('href', `#i-${on && q.sortDir === -1 ? 'chev-u' : 'chev-d'}`); th.classList.toggle('is-sorted', on);
    }
  }
  const update = (what = 'all') => { if (what !== 'table') paintPipe(); if (what === 'all' || what === 'load') paintLoad(); paintTable(); };

  /* ---------- public ---------- */
  LX.queue = {
    render(root) { root.innerHTML = String(frame()); update(); bind(root); },
    update,
    refreshRows() { if (document.getElementById('q-body')) update(); },
    flash(id) { const tr = document.querySelector(`#q-body tr[data-id="${id}"]`); if (!tr) return; tr.scrollIntoView({ block: 'nearest' }); tr.classList.add('is-flash'); setTimeout(() => tr.classList.remove('is-flash'), 1800); },
    select(id) { q.selected = id; document.querySelectorAll('#q-body tr.is-sel').forEach((t) => t.classList.remove('is-sel')); if (id) document.querySelector(`#q-body tr[data-id="${id}"]`)?.classList.add('is-sel'); },
    toggleState(s) { if (!s) q.states.clear(); else if (q.states.has(s)) q.states.delete(s); else q.states.add(s); update(); },
    toggle(k) { q[k] = !q[k]; const b = document.getElementById(`f-${k}`); b?.setAttribute('aria-pressed', String(q[k])); update(); },
    assignee(id) { q.assignee = q.assignee === id ? '' : id; document.getElementById('f-assignee').value = q.assignee; update(); },
    sort(k) { if (q.sortKey === k) q.sortDir *= -1; else { q.sortKey = k; q.sortDir = 1; } paintTable(); },
    clear() { Object.assign(q, { states: new Set(), assignee: '', method: '', customer: '', gxp: '', hold: '', overdue: false, risk: false, closed: false, q: '' }); LX.queue.render(document.getElementById('main')); },
    holdsPopover(trigger, id) {
      const r = M.rowById.get(id);
      LX.pop.open(trigger, h`<div class="pop__head"><span>${r.id}: ${LX.plural(r.nHolds, 'open Hold')}</span><button class="iconbtn" data-act="pop-close" aria-label="Close">${icon('x')}</button></div>
        ${r.holds.map((hd) => h`<div class="pop__item"><div class="hcard__h">${U.hold(1)}<b>${hd.kind}</b>${hd.deviationId ? U.dev(hd.deviationId) : ''}</div><p>${hd.reason}</p><dl class="pop__kv"><dt>Blocks</dt><dd>${M.blocksText(hd.blocks)}</dd><dt>Opened</dt><dd class="mono">${T.stamp(new Date(hd.openedAt))}</dd><dt>Released</dt><dd>${M.holdReleaser(hd)}</dd>${hd.deviationId ? (() => { const d = M.deviation.get(hd.deviationId); return h`<dt>Deviation</dt><dd>${d.kind}, Risk Level ${d.risk}, ${d.state}</dd>`; })() : ''}</dl></div>`)}`, { label: `Holds on ${r.id}` });
    },
  };

  function bind(root) {
    const search = document.getElementById('q-search'); let raf = 0;
    search.addEventListener('input', () => { q.q = search.value; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => update()); });
    search.addEventListener('keydown', (e) => { if (e.key === 'Escape' && search.value) { search.value = ''; q.q = ''; update(); e.stopPropagation(); } });
    document.getElementById('q-filters').addEventListener('change', (e) => { const f = e.target.dataset?.f; if (f) { q[f] = e.target.value; update(); } });
    const body = document.getElementById('q-body');
    body.addEventListener('click', (e) => { if (e.target.closest('button, a, input, select')) return; const tr = e.target.closest('tr[data-id]'); if (tr) LX.actions.peek(tr.querySelector('.cellbtn'), e); });
    body.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return; const b = e.target.closest('.cellbtn[data-act="peek"]'); if (!b) return;
      const tr = b.closest('tr'); const nx = e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling; const nb = nx?.querySelector('.cellbtn[data-act="peek"]');
      if (nb) { nb.focus(); e.preventDefault(); }
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && S.route && document.getElementById('q-search') && !/input|textarea|select/i.test(document.activeElement?.tagName) && !S.layer.length && !document.querySelector('#lock-root .lock')) { e.preventDefault(); document.getElementById('q-search').focus(); }
  });
})();

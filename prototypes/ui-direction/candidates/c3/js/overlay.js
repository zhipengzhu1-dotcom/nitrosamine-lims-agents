/* overlay.js: sheets, popovers and toasts, plus the Act sheets of the queue and the workspace
   (Test details, Assignment, Upload, Flag). Sign and reading entry live in sign.js and checks.js. */
(() => {
  'use strict';
  const LX = window.LX, { h, raw, icon } = LX, M = LX.M, T = LX.t, U = LX.U, S = LX.S, L = window.LIMS;

  /* ---------- toasts ---------- */
  LX.toast = ({ title, detail = '', ms = 5200, action = null, kind = 'ok' }) => {
    const root = document.getElementById('toasts'); const el = document.createElement('div');
    el.className = 'toast';
    /* sit above whatever holds the next key, so a toast never covers an action */
    const anchor = document.querySelector('.ov.is-in .ov__foot:last-of-type, .ov.is-in .sg__keys') ?? document.getElementById('dock');
    root.style.bottom = `${anchor ? Math.max(24, innerHeight - anchor.getBoundingClientRect().top + 12) : 24}px`;
    el.innerHTML = String(h`${icon(kind === 'info' ? 'info' : 'ok', 'ico--l')}<div><span>${title}</span>${detail ? h`<small>${detail}</small>` : ''}</div>${action ? h`<button data-act="${action.act}" ${action.attrs ? raw(action.attrs) : ''}>${action.label}</button>` : ''}`);
    root.appendChild(el); requestAnimationFrame(() => el.classList.add('is-in'));
    const kill = () => { el.classList.remove('is-in'); el.classList.add('is-out'); setTimeout(() => el.remove(), 180); };
    const t = setTimeout(kill, ms); el.addEventListener('click', (e) => { if (e.target.closest('button')) { clearTimeout(t); kill(); } });
    while (root.children.length > 3) root.firstElementChild.remove();
  };

  /* ---------- popovers: scale in from their trigger ---------- */
  const popRoot = () => document.getElementById('pop-root');
  LX.pop = {
    el: null, trigger: null,
    open(trigger, html, { label = 'Details' } = {}) {
      LX.pop.close(true);
      const el = document.createElement('div'); el.className = 'pop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', label); el.tabIndex = -1;
      el.innerHTML = String(html); popRoot().appendChild(el);
      const tr = trigger.getBoundingClientRect(); const pw = el.offsetWidth, ph = el.offsetHeight; const vw = innerWidth, vh = innerHeight;
      let left = Math.min(Math.max(8, tr.left), vw - pw - 8); let top = tr.bottom + 6; let oy = 0;
      if (top + ph > vh - 8) { top = Math.max(8, tr.top - ph - 6); oy = ph; }
      el.style.left = `${left}px`; el.style.top = `${top}px`; el.style.setProperty('--ox', `${Math.max(0, tr.left + tr.width / 2 - left)}px ${oy}px`);
      requestAnimationFrame(() => el.classList.add('is-in'));
      LX.pop.el = el; LX.pop.trigger = trigger; trigger.setAttribute('aria-expanded', 'true'); el.focus({ preventScroll: true });
    },
    close(quiet = false) {
      const el = LX.pop.el; if (!el) return; const tr = LX.pop.trigger;
      LX.pop.el = null; LX.pop.trigger = null; el.remove();
      if (tr) { tr.removeAttribute('aria-expanded'); if (!quiet && document.contains(tr)) tr.focus({ preventScroll: true }); }
    },
  };
  document.addEventListener('pointerdown', (e) => { if (LX.pop.el && !e.target.closest('.pop') && !e.target.closest('[aria-expanded="true"]')) LX.pop.close(true); }, true);
  addEventListener('resize', () => LX.pop.close(true));

  /* ---------- overlay stack ---------- */
  const layer = () => document.getElementById('layer');
  const O = (LX.overlay = {
    kinds: {},
    register(kind, def) { O.kinds[kind] = def; },
    top: () => S.layer[S.layer.length - 1],
    has: (kind) => S.layer.some((o) => o.kind === kind),
    open(kind, props = {}, st = null) {
      const def = O.kinds[kind]; const opener = document.activeElement;
      LX.pop.close(true);
      const inst = { kind, props, st: st ?? def.init?.(props) ?? {}, opener, def, el: null };
      const wrap = document.createElement('div'); wrap.className = `ov ov--${def.layout ?? 'sheet'} ov--${kind}`; wrap.dataset.ov = kind;
      wrap.innerHTML = String(h`<div class="ov__scrim" ${def.strict ? '' : raw('data-act="ov-scrim"')}></div><section class="ov__panel" role="dialog" ${def.modal ? raw('aria-modal="true"') : ''} aria-labelledby="ov-${kind}-h" tabindex="-1"></section>`);
      layer().appendChild(wrap); inst.el = wrap; S.layer.push(inst);
      O.paint(inst, true); O.sync();
      requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('is-in')));
      return inst;
    },
    /* re-render the panel, keeping focus and scroll positions */
    paint(inst, first = false) {
      const panel = inst.el.querySelector('.ov__panel'); const fk = !first && panel.contains(document.activeElement) ? document.activeElement.dataset.fk : null;
      const scrolls = {}; panel.querySelectorAll('[data-scroll]').forEach((s) => { scrolls[s.dataset.scroll] = s.scrollTop; });
      panel.innerHTML = String(inst.def.render(inst.props, inst.st, inst));
      panel.querySelectorAll('[data-scroll]').forEach((s) => { if (scrolls[s.dataset.scroll] != null) s.scrollTop = scrolls[s.dataset.scroll]; });
      inst.def.mount?.(panel, inst.st, inst.props, inst);
      if (fk) panel.querySelector(`[data-fk="${fk}"]`)?.focus({ preventScroll: true });
      else if ((first && !panel.contains(document.activeElement)) || (!first && document.activeElement === document.body)) (panel.querySelector('[data-first]') ?? panel).focus({ preventScroll: true });
    },
    update(kind = null) { const inst = kind ? S.layer.findLast((o) => o.kind === kind) : O.top(); if (inst) O.paint(inst); },
    sync() {
      const any = S.layer.length > 0;
      document.getElementById('main').inert = any; document.querySelector('.tabs')?.toggleAttribute('inert', any);
      document.body.classList.toggle('has-overlay', any);
    },
    close(kind = null, { restore = true, immediate = false } = {}) {
      const i = kind ? S.layer.findLastIndex((o) => o.kind === kind) : S.layer.length - 1; if (i < 0) return;
      const inst = S.layer.splice(i, 1)[0]; inst.def.unmount?.(inst.st, inst.props, inst);
      const wrap = inst.el; wrap.classList.remove('is-in'); wrap.classList.add('is-out');
      const gone = () => wrap.remove(); if (immediate || matchMedia('(prefers-reduced-motion: reduce)').matches) gone(); else setTimeout(gone, 160);
      O.sync();
      if (restore && !S.layer.length) { const op = inst.opener; if (op && document.contains(op) && LX.visible(op)) op.focus({ preventScroll: true }); else document.getElementById('main').focus({ preventScroll: true }); }
      return inst;
    },
    closeAll(opts = {}) { while (S.layer.length) O.close(null, { restore: false, immediate: true, ...opts }); O.sync(); },
    /* set the work aside as a draft of whoever is signed in; anything typed in credentials is never kept */
    suspend() {
      const snap = S.layer.map((o) => ({ kind: o.kind, props: o.props, st: o.def.snapshot ? o.def.snapshot(o.st, o) : o.st })).filter((o) => O.kinds[o.kind].keepDraft !== false);
      O.closeAll(); return snap;
    },
    resume(snap) { for (const o of snap) O.open(o.kind, o.props, o.st); },
  });

  document.addEventListener('keydown', (e) => {
    const top = O.top();
    if (e.key === 'Escape') {
      if (LX.pop.el) { LX.pop.close(); e.preventDefault(); return; }
      if (top && !S.lock && !document.querySelector('#lock-root .lock')) { LX.closeTop(); e.preventDefault(); }
      return;
    }
    if (e.key === 'Tab' && top && !document.querySelector('#lock-root .lock')) {
      const panel = top.el.querySelector('.ov__panel');
      const barCtl = LX.$$(LX.FOCUSABLE, document.getElementById('bar')).filter((el) => !el.closest('.tabs') && LX.visible(el));
      const inner = LX.$$(LX.FOCUSABLE, panel).filter(LX.visible); const all = [...barCtl, ...inner];
      if (!all.length) return; const i = all.indexOf(document.activeElement);
      if (e.shiftKey && (i <= 0 || document.activeElement === panel)) { all[all.length - 1].focus(); e.preventDefault(); }
      else if (!e.shiftKey && i === all.length - 1) { all[0].focus(); e.preventDefault(); }
    }
  });

  /* radio groups made of big buttons: one tab stop, arrows move and choose (as native radios do) */
  LX.radioKeys = (group) => group?.addEventListener('keydown', (e) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (step == null && e.key !== 'Home' && e.key !== 'End') return;
    const items = LX.$$('[role="radio"]:not([disabled])', group); const i = items.indexOf(document.activeElement); if (i < 0) return;
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + step + items.length) % items.length;
    e.preventDefault(); items[n].focus({ preventScroll: false }); items[n].click();
  });

  /* =====================================================================================
     Test details drawer (reading gear made bigger: still a sheet, still one column)
     ===================================================================================== */
  const facts = (r) => h`
    <dl class="kv">
      <dt>Sample</dt><dd><span class="mono">${r.sample.id}</span>, stored ${r.sample.storage}</dd>
      <dt>Submission</dt><dd class="mono">${r.t.submissionId}</dd>
      <dt>Customer</dt><dd>${r.customer.name}</dd>
      <dt>Product, Lot</dt><dd>${r.product.name} <span class="muted mono">${r.product.code}</span>, Lot <span class="mono">${r.sample.lot}</span></dd>
      <dt>Method</dt><dd><span class="mono">${r.t.methodNumber} v${r.t.methodVersion}</span>, ${r.method.title}</dd>
      <dt>GxP Class</dt><dd>${U.gxp(r.t.gxp)}${r.t.nonGmpReason ? h` <span class="muted">${r.t.nonGmpReason}, signed reason at acceptance</span>` : ''}</dd>
      <dt>Service level</dt><dd>${U.service(r.t.serviceLevel)}, ${r.t.tatBusinessDays} business days</dd>
      <dt>Assignee</dt><dd>${r.assignee ? U.name(r.assignee) : h`<span class="muted">Not assigned</span>`}</dd>
      ${r.t.retestOf ? h`<dt>Retest of</dt><dd class="mono">${r.t.retestOf}</dd>` : ''}
      ${r.t.source === 'Stability Pull' ? h`<dt>Source</dt><dd>Stability Pull</dd>` : ''}
    </dl>`;
  LX.holdCards = (r) => r.holds.map((hd) => h`
    <div class="hcard">
      <div class="hcard__h">${U.hold(1)}<b>${hd.kind}</b>${hd.deviationId ? U.dev(hd.deviationId) : ''}</div>
      <p>${hd.reason}</p>
      <dl class="pop__kv"><dt>Blocks</dt><dd>${M.blocksText(hd.blocks)}</dd><dt>Opened</dt><dd class="mono">${T.stamp(new Date(hd.openedAt))}</dd><dt>Released</dt><dd>${M.holdReleaser(hd)}</dd></dl>
    </div>`);
  LX.devCards = (ids) => ids.map((id) => { const d = M.deviation.get(id); if (!d) return ''; const inv = M.person.get(d.investigatorId); return h`
    <div class="hcard hcard--dev">
      <div class="hcard__h">${U.dev(id)}<b>${d.kind}</b><span class="chip chip--dead">${d.state}</span></div>
      <p>${d.title}</p>
      <dl class="pop__kv"><dt>Risk Level</dt><dd>${U.risk(d.risk)} ${d.risk}</dd><dt>Investigator</dt><dd>${inv.name}</dd><dt>Due</dt><dd class="mono">${d.dueDate}</dd></dl>
    </div>`; });

  O.register('peek', {
    layout: 'sheet', keepDraft: false,
    render: ({ id }) => {
      const r = M.rowById.get(id);
      return h`
      <header class="ov__head"><div><p class="ov__kicker">Test</p><h2 id="ov-peek-h" class="ov__title mono">${r.id}</h2></div>
        <button class="iconbtn" data-act="ov-close" aria-label="Close Test details">${icon('x')}</button></header>
      <div class="ov__body" data-scroll="peek">
        <div class="peek__strip">${U.state(r.state, { large: true })}<span class="muted">for ${T.age(T.now() - r.since)}</span></div>
        <div class="peek__strip">${U.due(r.due)}${r.due.date ? h`<span class="mono">${r.due.date}</span>` : ''}${r.nHolds ? U.hold(r.nHolds) : h`<span class="hold hold--none">${icon('check', 'ico--s')}No open Holds</span>`}</div>
        ${facts(r)}
        <h3 class="ov__sub">Timeline</h3>
        <ol class="tl">${r.t.history.map((e, i, a) => h`<li class="${i === a.length - 1 ? 'is-now' : ''}"><span class="tl__s">${e.state}</span><span class="mono">${T.stamp(new Date(e.at))}</span><span class="muted">${e.by ? M.person.get(e.by).name : 'System'}</span></li>`)}</ol>
        ${r.nHolds ? h`<h3 class="ov__sub">Holds</h3>${LX.holdCards(r)}` : ''}
        ${r.t.deviationIds.length ? h`<h3 class="ov__sub">Deviations</h3>${LX.devCards(r.t.deviationIds)}` : ''}
      </div>
      <footer class="ov__foot">
        ${r.state === 'Ready' ? h`<button class="key" data-act="assign-open" data-id="${r.id}">${icon('user')}Assign this Test</button>` : ''}
        ${r.id === M.focusRow.id ? h`<button class="key key--ghost" data-act="switch-to" data-user="praman" data-then="test">${icon('swap')}Open at the bench as Priya Raman</button>` : ''}
        <button class="key key--ghost" data-act="ov-close">Close</button>
      </footer>`;
    },
  });

  /* =====================================================================================
     Assignment: all 20 Analysts; refused ones say why and cannot be chosen
     ===================================================================================== */
  const wbar = (w) => h`<span class="wbar" role="img" aria-label="${w.open} open Tests: ${w.ip} In Progress, ${w.assigned} Assigned"><i class="wbar__ip" style="width:${(w.ip / 16) * 100}%"></i><i class="wbar__as" style="width:${(w.assigned / 16) * 100}%"></i></span>`;
  O.register('assign', {
    layout: 'sheet', keepDraft: true,
    init: () => ({ picked: null, done: null }),
    canClose: () => true,
    mount: (panel) => LX.radioKeys(panel.querySelector('[role="radiogroup"]')),
    render: ({ id }, st) => {
      const r = M.rowById.get(id); const rows = M.eligibility(r);
      const ok = rows.filter((x) => !x.reasons.length).sort((a, b) => a.load.open - b.load.open || a.p.name.localeCompare(b.p.name));
      const no = rows.filter((x) => x.reasons.length).sort((a, b) => a.p.name.localeCompare(b.p.name));
      const pick = st.picked ? rows.find((x) => x.p.id === st.picked) : null;
      const next = M.nextReady();
      const done = st.done;
      return h`
      <header class="ov__head"><div><p class="ov__kicker">Assign to an Analyst</p><h2 id="ov-assign-h" class="ov__title"><span class="mono">${r.id}</span> ${U.gxp(r.t.gxp)} ${U.service(r.t.serviceLevel)}</h2></div>
        <button class="iconbtn" data-act="ov-close" aria-label="Close assignment">${icon('x')}</button></header>
      <div class="asg">
        <aside class="asg__side">
          <dl class="kv kv--tight">
            <dt>Sample</dt><dd class="mono">${r.sample.id}</dd>
            <dt>Customer</dt><dd>${r.customer.name}</dd>
            <dt>Product, Lot</dt><dd>${r.product.name}, <span class="mono">${r.sample.lot}</span></dd>
            <dt>Method</dt><dd><span class="mono">${r.t.methodNumber} v${r.t.methodVersion}</span><br>${r.method.title}</dd>
            <dt>Ready since</dt><dd class="mono">${T.stamp(r.since)}</dd>
            <dt>Due</dt><dd><span class="mono">${r.t.dueDate}</span> ${U.due(r.due)}</dd>
          </dl>
          <div class="rules" ${done ? raw('hidden') : ''}>
            <p class="rules__h">${icon('lock')}The server refuses an Analyst without</p>
            <ul><li>a Training Record on <span class="mono">${r.t.methodNumber} v${r.t.methodVersion}</span></li><li>Training Records on its prerequisite Documents (<span class="mono">${L.prerequisites.documentNumber} v${L.prerequisites.version}</span>)</li><li>a current Performed Authorisation for the Method in Lab ${L.lab.id}</li></ul>
            <p class="rules__f">There is no override. Assignment is audited, not signed.</p>
          </div>
          <div class="asg__act">
            ${done ? h`
              <div class="done" role="status">
                <p class="done__h">${icon('ok', 'ico--l')}Assigned to ${done.name}</p>
                <p>Recorded in the Audit Trail.</p>
                <p class="mono done__t">${done.utc}<br>${done.local}</p>
                <p class="muted">${done.who} assigned ${r.id} to ${done.user}, Lab ${L.lab.id}. The Test is now Assigned.</p>
              </div>
              ${next ? h`<button class="key" data-act="assign-next" data-id="${next.id}">Assign next: <span class="mono">${next.id}</span></button>` : ''}
              <button class="key key--ghost" data-act="ov-close" data-first>Back to the queue</button>`
            : h`
              ${pick ? h`<p class="asg__pick" aria-live="polite">${U.name(pick.p)} has <b>${pick.load.open}</b> open. After this: <b>${pick.load.open + 1}</b>.</p>` : h`<p class="asg__pick muted" aria-live="polite">Choose an Analyst from the list.</p>`}
              <button class="key" data-act="assign-confirm" ${pick ? '' : raw('aria-disabled="true"')}>${pick ? h`${icon('user')}Assign to ${pick.p.name}` : 'Choose an Analyst'}</button>
              <button class="key key--ghost" data-act="ov-close">Cancel</button>`}
          </div>
        </aside>
        <div class="asg__lists" data-scroll="asg">
          <section aria-labelledby="asg-ok"><h3 id="asg-ok" class="asg__h">Can take this Test <span class="asg__n">${ok.length}</span><span class="asg__leg"><i class="wbar__key wbar__key--ip"></i>In Progress <i class="wbar__key wbar__key--as"></i>Assigned</span></h3>
            <div role="radiogroup" aria-label="Analysts who can take ${r.id}" class="asg__ul">
              ${ok.map((x, i) => h`<button class="an ${st.picked === x.p.id ? 'is-picked' : ''}" role="radio" aria-checked="${st.picked === x.p.id}" tabindex="${st.picked ? (st.picked === x.p.id ? 0 : -1) : (i === 0 ? 0 : -1)}" data-act="assign-pick" data-p="${x.p.id}" data-fk="p-${x.p.id}" ${done ? raw('disabled') : ''}>
                <span class="an__radio" aria-hidden="true"></span>
                <span class="an__n">${x.p.name}${x.p.nativeName ? h` ${U.native(x.p)}` : ''}</span>
                ${wbar(x.load)}<span class="an__c"><b>${x.load.open}</b> open</span>${x.load.overdue ? h`<span class="an__o" title="${x.load.overdue} overdue">${icon('alert', 'ico--s')}${x.load.overdue}</span>` : ''}
              </button>`)}
            </div></section>
          <section aria-labelledby="asg-no"><h3 id="asg-no" class="asg__h asg__h--no">Refused <span class="asg__n">${no.length}</span><span class="asg__leg">cannot be chosen</span></h3>
            <ul class="asg__ul asg__ul--no">
              ${no.map((x) => h`<li class="an an--no"><span class="an__ban">${icon('ban')}</span><div><div class="an__hd"><b class="an__n">${x.p.name}${x.p.nativeName ? h` ${U.native(x.p)}` : ''}</b><span class="an__c muted"><b>${x.load.open}</b> open</span></div><ul class="an__why">${x.reasons.map((s) => h`<li>${s}</li>`)}</ul></div></li>`)}
            </ul></section>
        </div>
      </div>`;
    },
  });

  /* =====================================================================================
     Upload the TargetLynx export (simulated: the data already holds the parse)
     ===================================================================================== */
  const IMP = M.focus.import; const KB = (b) => `${(b / 1024).toFixed(1)} KB`;
  const STEPS = ['Uploading the export and its PDF', `Parsing with ${IMP.parser}`, `Cross-checking the PDF against the TXT (${LX.int(IMP.pdf.crossCheck.cellsCompared)} cells)`, `Finding the injections of ${M.focus.testId}`];
  O.register('upload', {
    layout: 'sheet', strict: true, keepDraft: false,
    init: () => ({ picked: false, step: -1 }),
    canClose: (st) => st.step < 0 || st.step >= STEPS.length,
    render: (p, st) => {
      const busy = st.step >= 0; const done = st.step >= STEPS.length;
      return h`
      <header class="ov__head"><div><p class="ov__kicker">${M.focus.testId}</p><h2 id="ov-upload-h" class="ov__title">Upload the TargetLynx export</h2></div>
        <button class="iconbtn" data-act="ov-close" ${busy && !done ? raw('aria-disabled="true"') : ''} aria-label="Close upload">${icon('x')}</button></header>
      <div class="ov__body">
        <p class="lead">Run <span class="mono">${M.focus.run.id}</span> on ${M.focus.run.instrument} finished at ${T.stamp(new Date(M.focus.run.acquiredTo))}. Pick its export. The TXT becomes <b>draft values</b>; the PDF is kept and cross-checked against it.</p>
        <h3 class="ov__sub">LCMS-02 export folder</h3>
        <button class="file ${st.picked ? 'is-picked' : ''}" data-act="upload-pick" role="checkbox" aria-checked="${st.picked}" data-first ${busy ? raw('disabled') : ''}>
          <span class="file__box" aria-hidden="true">${icon('check')}</span>
          <span class="file__body">
            <span class="file__row">${icon('file')}<b class="mono">${IMP.file}</b><span class="chip chip--info">TargetLynx TXT</span><span class="muted">${KB(IMP.bytes)}</span></span>
            <span class="file__row">${icon('file')}<b class="mono">${IMP.pdf.file}</b><span class="chip chip--dead">PDF cross-check</span></span>
            <span class="muted file__meta">Last altered 2026-09-30 09:50 EDT, Dataset <span class="mono">${IMP.dataset}</span></span>
          </span>
        </button>
        ${busy ? h`<ol class="steps" aria-live="polite">${STEPS.map((s, i) => h`<li class="${i < st.step ? 'is-done' : i === st.step ? 'is-now' : ''}">${U.lamp(i < st.step ? 'on' : i === st.step ? 'wait' : 'off')}<span>${s}</span></li>`)}</ol>` : ''}
        ${done ? h`<p class="lead" role="status"><b>${IMP.rowsForThisTest} draft values found</b> for ${M.focus.testId} of ${M.focus.run.injections} injections in the Run. Opening them now.</p>` : ''}
      </div>
      <footer class="ov__foot">
        <button class="key" data-act="upload-go" ${st.picked && !busy ? '' : raw('aria-disabled="true"')}>${icon('upload')}${busy ? 'Working…' : st.picked ? 'Upload and parse' : 'Pick the export first'}</button>
        <button class="key key--ghost" data-act="ov-close" ${busy && !done ? raw('aria-disabled="true"') : ''}>Cancel</button>
      </footer>`;
    },
  });

  /* =====================================================================================
     Handle the flag: accept with a comment, or request a Reinjection
     ===================================================================================== */
  const PHRASES = ['Checked the peak in MassLynx: the integration is correct.', 'Compared with the other injections of this Preparation.', 'The ratio deviates on one injection only; the other three agree.'];
  LX.PHRASES = PHRASES;
  O.register('flag', {
    layout: 'sheet', keepDraft: true,
    init: () => ({ mode: 'accept', comment: '' }),
    render: (p, st) => {
      const f = M.flags()[0]; const inj = f.injection;
      return h`
      <header class="ov__head"><div><p class="ov__kicker">Flag on the draft</p><h2 id="ov-flag-h" class="ov__title">${f.analyte}: ${f.kind}</h2></div>
        <button class="iconbtn" data-act="ov-close" aria-label="Close">${icon('x')}</button></header>
      <div class="ov__body">
        <div class="flagfact"><span>${icon('flag')}</span><div>
          <p><b>Injection <span class="mono">${inj}</span></b>, Preparation ${f.prep} (<span class="mono">${M.focus.testId}-P${f.prep}</span>), injection 2</p>
          <p>Peak Ratio <b class="mono">${f.found.toFixed(3)}</b>, window <span class="mono">${f.window[0].toFixed(3)} to ${f.window[1].toFixed(3)}</span> (${f.detail.replace(/^Peak Ratio [\d.]+ vs /, '')}).</p></div></div>
        <div class="choice" role="radiogroup" aria-label="How to handle this flag">
          <button class="choice__i ${st.mode === 'accept' ? 'is-on' : ''}" role="radio" aria-checked="${st.mode === 'accept'}" tabindex="${st.mode === 'accept' ? 0 : -1}" data-act="flag-mode" data-mode="accept" data-fk="m-accept" data-first><span class="choice__r" aria-hidden="true"></span><span><b>Accept with a comment</b><small>The value stays a draft until you sign Performed. Your comment goes to the Reviewer.</small></span></button>
          <button class="choice__i ${st.mode === 'reinject' ? 'is-on' : ''}" role="radio" aria-checked="${st.mode === 'reinject'}" tabindex="${st.mode === 'reinject' ? 0 : -1}" data-act="flag-mode" data-mode="reinject" data-fk="m-reinject"><span class="choice__r" aria-hidden="true"></span><span><b>Request a Reinjection</b><small>Injects Preparation ${f.prep} again. This Test waits, In Progress, for the new export.</small></span></button>
        </div>
        ${st.mode === 'accept' ? h`
          <label class="flabel" for="flag-c">Comment</label>
          <div class="phr" role="group" aria-label="Quick comments">${PHRASES.map((s, i) => h`<button class="btn" data-act="flag-phrase" data-i="${i}">${s}</button>`)}</div>
          <textarea id="flag-c" class="area" rows="3" placeholder="Why the value can stand. At least 10 characters." data-fk="comment">${st.comment}</textarea>` : h`
          <p class="lead">Asks the instrument operator to inject <span class="mono">${MPREP(f)}</span> again. The flagged injection stays as it is in the audit trail.</p>`}
      </div>
      <footer class="ov__foot">
        <button class="key" data-act="flag-confirm" ${st.mode === 'reinject' || st.comment.trim().length >= 10 ? '' : raw('aria-disabled="true"')}>${st.mode === 'accept' ? 'Accept the flag' : 'Request the Reinjection'}</button>
        <button class="key key--ghost" data-act="ov-close">Cancel</button>
      </footer>`;
    },
    mount(panel, st) {
      LX.radioKeys(panel.querySelector('[role="radiogroup"]'));
      const ta = panel.querySelector('#flag-c'); if (!ta) return;
      ta.addEventListener('input', () => { st.comment = ta.value; const b = panel.querySelector('[data-act="flag-confirm"]'); const ok = ta.value.trim().length >= 10; if (ok) b.removeAttribute('aria-disabled'); else b.setAttribute('aria-disabled', 'true'); });
    },
  });
  const MPREP = (f) => `${f.injection} (Preparation ${f.prep}, injection 2)`;
})();

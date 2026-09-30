/* checks.js: today's Checks at the bench. A board of 19 tiles, and an entry sheet built for gloves:
   an on-screen number pad, limits and units beside every field, retype-to-confirm for anything
   outside its limits, and the consequence stated before anything failing is saved. */
(() => {
  'use strict';
  const LX = window.LX, { h, raw, icon } = LX, M = LX.M, T = LX.t, U = LX.U, S = LX.S, L = window.LIMS, O = LX.overlay;
  const ck = (S.ck = { filter: null });

  /* ---------- vocabulary ---------- */
  const UNIT = { tempC: '°C', tempMinC: '°C', tempMaxC: '°C', rhPct: '%', resistivityMOhmCm: 'MΩ·cm', tocPpb: 'ppb' };
  const LABEL = { tempC: 'Temperature', tempMinC: 'Minimum since reset', tempMaxC: 'Maximum since reset', rhPct: 'Relative humidity', resistivityMOhmCm: 'Resistivity', tocPpb: 'Total organic carbon' };
  const ST = {
    Done: ['go', 'ok'], Due: ['info', 'circle'], 'Due soon': ['watch', 'clock'], Overdue: ['stop', 'alert'], Blocked: ['stop', 'lock'], 'Not used today': ['dead', 'minus-circle'],
  };
  const stChip = (s) => h`<span class="chip chip--${ST[s][0]}">${icon(ST[s][1])}${s}</span>`;
  const fmt = (v, dp = null) => (v == null ? '' : String(dp == null ? v : Number(v).toFixed(dp)).replace('-', '−'));
  const asNum = (s) => { const t = String(s ?? '').replace('−', '-').trim(); if (t === '' || t === '-' || t === '.' || t === '-.') return null; const v = Number(t); return Number.isFinite(v) ? v : null; };
  const who = (id) => M.person.get(id);

  const what = (c) => {
    if (c.group === 'rooms') return c.fields.includes('tempMinC') ? 'Temperature, minimum, maximum, humidity' : 'Temperature and humidity';
    if (c.group === 'storage') return 'Temperature now, minimum and maximum';
    if (c.target === 'DIW-01') return 'Resistivity and total organic carbon';
    if (c.group === 'balances') return `${c.weights.map((w) => w.nominal).join(' and ')} check weights`;
    if (c.target === 'PH-01') return `Buffers at pH ${c.buffers.map((b) => b.toFixed(2)).join(', ')}`;
    return 'Gravimetric verification, every 3 months';
  };
  const unitOf = (k) => UNIT[k] ?? '';
  /* what was recorded, one labelled row per value */
  const valueRows = (c) => {
    const v = c.values; if (!v) return [];
    if (c.weights) return c.weights.map((w, i) => { const pct = ((v.readingsMg[i] - w.certifiedMg) / w.certifiedMg) * 100; const pass = Math.abs(pct) <= c.tolerancePct; return [`${w.nominal} check weight`, `${fmt(v.readingsMg[i])} mg, error ${pct >= 0 ? '+' : '\u2212'}${Math.abs(pct).toFixed(4)} %`, pass]; });
    const rows = fieldsOf(c).map((f) => [f.label, `${fmt(v[f.key])} ${f.unit}`, null]);
    if (v.reset != null) rows.push(['Minimum and maximum', v.reset ? 'reset after this reading' : 'not reset', null]);
    return rows;
  };
  const valueList = (c) => h`<dl class="kv">${valueRows(c).map(([k, val, pass]) => h`<dt>${k}</dt><dd class="mono">${val}${pass == null ? '' : pass ? h` <span class="chip chip--go">${icon('check')}Pass</span>` : h` <span class="chip chip--stop">${icon('x')}Fail</span>`}</dd>`)}</dl>`;
  const devIdsIn = (...t) => [...new Set(t.join(' ').match(/DEV-\d\d-\d{4}/g) ?? [])];

  /* ---------- fields of an entry ---------- */
  function fieldsOf(c) {
    if (c.weights) return c.weights.map((w, i) => ({ key: `w${i}`, kind: 'weight', label: `${w.nominal} check weight`, unit: 'mg', cert: w.certifiedMg, tol: c.tolerancePct, pl: c.plausiblePct ?? 5 }));
    const mm = c.fields.includes('tempMinC');
    return c.fields.filter((f) => f !== 'reset').map((f) => { const base = f.startsWith('temp') ? 'tempC' : f; return { key: f, kind: 'reading', label: f === 'tempC' && mm ? 'Temperature now' : LABEL[f], unit: unitOf(f), lim: c.limits[base], pl: c.plausible[base] }; });
  }
  function evalField(f, raw) {
    const v = asNum(raw); if (v == null) return { s: 'empty' };
    if (f.kind === 'weight') { const err = v - f.cert; const pct = (err / f.cert) * 100; const a = Math.abs(pct); return { s: a > f.pl ? 'implausible' : a > f.tol ? 'outside' : 'ok', v, err, pct }; }
    return { s: v < f.pl[0] || v > f.pl[1] ? 'implausible' : v < f.lim[0] || v > f.lim[1] ? 'outside' : 'ok', v };
  }
  const isBad = (e) => e.s === 'outside' || e.s === 'implausible';
  const consKind = (c) => (c.group === 'balances' ? 'balance' : c.group === 'storage' || M.room.get(c.target)?.storage ? 'storage' : c.group === 'rooms' ? 'room' : 'water');

  /* ---------- the board ---------- */
  const tname = (c) => {
    if (c.targetKind === 'Room') return c.name;
    if (c.compartment) return c.compartment;
    return M.equipment.get(c.target).name.replace(/, \d-place$/, '').replace(/^Type 1 water dispenser$/, 'DI water dispenser').replace(/^Benchtop pH meter$/, 'pH meter').replace(/^(.+ \u00B5L) single-channel$/, 'Pipette $1');
  };
  function tile(c) {
    const [tone] = ST[c.status];
    const fit = c.targetKind === 'Equipment' ? M.fitness(c.target) : null; const off = fit && fit.status !== 'In use';
    const done = c.status === 'Done';
    const missed = M.alarm.target === c.target && M.alarm.state === 'awaiting' && c.status === 'Due';
    const first = (id) => M.firstName(who(id));
    const shortVals = () => { const v = c.values; if (c.weights) return 'Pass'; if (v.tempMinC != null) return `${fmt(v.tempC, 1)} °C, ${fmt(v.tempMinC, 1)} to ${fmt(v.tempMaxC, 1)}`; return c.fields.filter((f) => f !== 'reset').map((f) => `${fmt(v[f])} ${unitOf(f)}`.trim()).join(', '); };
    const doneLine = done && c.values ? shortVals() : '';
    const doneBy = done ? `${first(c.by)} ${T.hm(new Date(c.at))}` : '';
    return h`<button class="tc tc--${tone} ${c.status === 'Blocked' ? 'tc--blocked' : ''}" data-act="ck-open" data-id="${c.id}" aria-label="${c.target} ${c.name}: ${c.status}">
      <span class="tc__edge" aria-hidden="true"></span>
      <span class="tc__st">${stChip(c.status)}</span>
      <span class="tc__b">
        <span class="tc__t" title="${c.name}"><b class="mono">${c.target}</b> ${tname(c)}</span>
        <span class="tc__s ell">${what(c)}</span>
        ${doneLine ? h`<span class="tc__v tc__done"><span class="mono ell" title="${doneLine}">${doneLine}</span><span class="muted">${doneBy}</span></span>` : ''}
        ${c.status === 'Due' && c.last ? h`<span class="tc__v muted ell mono">Last ${fmt(c.last.tempC, 1)} °C, min ${fmt(c.last.tempMinC, 1)}, max ${fmt(c.last.tempMaxC, 1)}</span>` : ''}
        ${c.status === 'Due' && c.lastPass ? h`<span class="tc__v muted">Last pass ${T.date(new Date(c.lastPass))} ${T.hm(new Date(c.lastPass))}, ${c.testsSinceLastPass} Tests since</span>` : ''}
        ${c.status === 'Due soon' ? h`<span class="tc__v muted">Due <span class="mono">${c.dueDate}</span></span>` : ''}
        ${missed ? h`<span class="tc__v why">${icon('bell', 'ico--s')}Missed yesterday: no reading on ${M.alarm.day}</span>` : ''}
        ${off ? h`<span class="tc__v tc__fit">${U.fit(fit.status)}<span class="why">${fit.reason}</span></span>` : ''}
        ${off && /refused/.test(c.note ?? '') ? h`<span class="tc__v why">New placements refused</span>` : ''}
        ${c.note && !off ? h`<span class="tc__v why">${c.note}</span>` : ''}
      </span>
    </button>`;
  }
  function board() {
    const counts = Object.fromEntries(M.CHECK_STATUSES.map((s) => [s, M.checks.filter((c) => c.status === s).length]));
    const next = M.nextCheck();
    return h`<section class="ck" aria-label="Today's Checks">
      <header class="ck__head">
        <div class="ck__ttl"><h1 class="ck__title">Today’s Checks</h1><p class="ck__date">Wednesday ${M.today}, Lab ${L.lab.id}. <b>${counts.Done} of ${M.checks.length} done.</b></p></div>
        <div class="ck__leg" role="group" aria-label="Filter by status">
          ${M.CHECK_STATUSES.map((s) => h`<button class="btn tog tog--${ST[s][0]}" data-act="ck-filter" data-s="${s}" aria-pressed="${ck.filter === s}">${icon(ST[s][1])}${s} <b class="num">${counts[s]}</b></button>`)}
          ${ck.filter ? h`<button class="btn btn--quiet" data-act="ck-filter" data-s="">${icon('reset')}Show all</button>` : ''}
        </div>
        ${next ? h`<button class="key key--stack next" data-act="ck-open" data-id="${next.id}"><span>${icon('pencil')}Next Check</span><small><span class="mono">${next.target}</span> ${next.name}</small></button>` : ''}
      </header>
      ${alarm()}
      <div class="ck__board">${M.GROUPS.map(([g, label]) => {
        const items = M.checks.filter((c) => c.group === g); const shown = items.filter((c) => !ck.filter || c.status === ck.filter);
        return h`<section class="ckc" aria-labelledby="ckc-${g}"><header class="ckc__h"><h2 id="ckc-${g}">${label}</h2><span class="muted">${items.filter((c) => c.status === 'Done').length} of ${items.length} done</span></header>
          <div class="ckc__l">${shown.length ? shown.map(tile) : h`<p class="ckc__none">No ${ck.filter} Check here.</p>`}</div></section>`;
      })}</div>
    </section>`;
  }
  function alarm() {
    const a = M.alarm; const r = M.room.get(a.target); const to = a.raisedTo.map((id) => who(id).name);
    if (a.state === 'awaiting') return h`<section class="alarm" aria-labelledby="al-h">
      <span class="alarm__ic">${icon('bell', 'ico--l')}</span>
      <div class="alarm__t"><h2 id="al-h">Missed reading: ${r.name} (<span class="mono">${a.target}</span>), ${a.day}</h2>
        <p>Nobody recorded temperature and humidity for ${a.day}. The alarm went to ${to.join(' and ')}. <b>Awaiting acknowledgement.</b></p></div>
      <button class="key key--danger" data-act="ck-ack">${icon('check')}Acknowledge the alarm</button></section>`;
    return h`<section class="alarm alarm--ack" aria-labelledby="al-h">
      <span class="alarm__ic">${icon('ok', 'ico--l')}</span>
      <div class="alarm__t"><h2 id="al-h">Missed reading acknowledged: ${r.name} (<span class="mono">${a.target}</span>), ${a.day}</h2>
        <p>${who(a.by).name} at ${T.hm(new Date(a.at))} ${T.zone(new Date(a.at))}. Recorded in the Audit Trail. Today’s ${a.target} reading is still due.</p></div></section>`;
  }

  /* ---------- entry sheet ---------- */
  const PAD = [['7', '8', '9'], ['4', '5', '6'], ['1', '2', '3'], ['±', '0', '.']];
  const padKey = (k) => h`<button class="pk" data-pad="${k}" aria-label="${k === '±' ? 'Plus or minus' : k === '.' ? 'Decimal point' : k}">${k}</button>`;
  const cite = (c) => (c.lastPass ? `Tests that cited ${c.target} since its last passing Check (${T.stamp(new Date(c.lastPass))})` : `Tests that cited ${c.target} since its last passing Check`);

  function ruler(c, f, e) {
    if (f.kind === 'weight') {
      const d = f.tol * 3; const v = e.s === 'empty' ? null : e.pct;
      return U.rulerWindow({ d0: -d, d1: d, b0: -f.tol, b1: f.tol, markers: v == null ? [] : [{ v, kind: 'cur', out: isBad(e) }], label: `Error ${v == null ? 'not typed yet' : fmt(v.toFixed(4)) + ' percent'}; acceptance window plus or minus ${f.tol} percent`, ticks: true, tick: (x) => `${x > 0 ? '+' : '−'}${Math.abs(x)} %` });
    }
    const [b0, b1] = f.lim; const span = b1 - b0;
    const d0 = Math.max(b0 - span * 0.7, f.pl[0]), d1 = Math.min(b1 + span * 0.7, f.pl[1]);
    const mk = [];
    if (e.s !== 'empty') mk.push({ v: e.v, kind: 'cur', out: isBad(e) });
    return U.rulerWindow({ d0, d1, b0, b1, markers: mk, label: `${f.label} ${e.s === 'empty' ? 'not typed yet' : e.v}; limit ${b0} to ${b1} ${f.unit}`, ticks: true });
  }
  function derived(c, f, e) {
    if (e.s === 'empty') return h`<span class="muted">Type the ${f.kind === 'weight' ? 'balance display' : 'value'}.</span>`;
    if (f.kind === 'weight') {
      const sign = e.err >= 0 ? '+' : '−';
      return h`<span class="ef__err mono">Error ${sign}${Math.abs(e.pct).toFixed(4)} % <span class="muted">(${sign}${Math.abs(e.err).toFixed(Math.abs(e.err) < 1 ? 4 : 1)} mg)</span></span>${e.s === 'ok' ? h`<span class="chip chip--go">${icon('check')}Pass</span>` : e.s === 'outside' ? h`<span class="chip chip--stop">${icon('x')}Fail: outside ±${f.tol} %</span>` : h`<span class="chip chip--stop">${icon('alert')}Implausible: beyond ±${f.pl} %</span>`}`;
    }
    return e.s === 'ok' ? h`<span class="chip chip--go">${icon('check')}In limits</span>`
      : e.s === 'outside' ? h`<span class="chip chip--stop">${icon('x')}Outside limits</span>`
        : h`<span class="chip chip--stop">${icon('alert')}Implausible: outside ${f.pl.map((x) => fmt(x)).join(' to ')} ${f.unit}</span>`;
  }
  const limText = (f) => (f.kind === 'weight'
    ? h`Certified <b class="mono">${f.cert}</b> mg. Limit ±${f.tol} %. Implausible beyond ±${f.pl} %.`
    : h`Limit <b class="mono">${f.lim.map((x) => fmt(x)).join(' to ')}</b> ${f.unit}. Implausible outside <span class="mono">${f.pl.map((x) => fmt(x)).join(' to ')}</span>.`);

  function consequences(c) {
    const k = consKind(c); const id = c.target;
    if (k === 'balance') return [['flag', h`Opens an <b>Equipment Deviation</b> for ${id}.`], ['pause', h`Suspends <b>${id}</b>. It cannot be cited until QA closes the Deviation and a Check passes.`], ['lock', c.testsSinceLastPass ? h`Puts a <b>Hold</b> on <b>${c.testsSinceLastPass} Tests</b>: ${cite(c)}.` : h`Puts a <b>Hold</b> on every Test that cited ${id} since its last passing Check. None is recorded yet.`]];
    if (k === 'storage') return [['flag', h`Opens an <b>Excursion Deviation</b> for ${id}.`], ['ban', h`Refuses <b>new placements</b> into ${id}. Removals stay possible.`]];
    if (k === 'room') return [['flag', h`Opens a <b>Room Deviation</b> for ${id}.`]];
    return [['flag', h`Opens an <b>Equipment Deviation</b> for ${id}.`]];
  }

  function entryBody(c, st) {
    const fs = fieldsOf(c); const hasReset = c.fields?.includes('reset');
    return h`
    <div class="ent">
      <div class="ent__main" data-scroll="ent">
        ${(() => { const fit = c.targetKind === 'Equipment' ? M.fitness(c.target) : null; return fit && fit.status !== 'In use' ? h`<div class="ent__fit">${U.fit(fit.status)}<span><b>${fit.reason}</b>${c.note ? h`<br>${c.note}` : ''}</span></div>` : ''; })()}
        <p class="ent__note">${icon('clock', 'ico--s')}<span>The time is <b>server time</b> when you save. Nobody types a time. Now <b class="mono" id="ent-now"></b>.</span></p>
        ${fs.map((f) => h`<div class="ef" data-key="${f.key}">
          <div class="ef__top"><label class="ef__l" for="in-${f.key}">${f.label}</label><span class="ef__lim">${limText(f)}</span></div>
          <div class="ef__row">
            <div class="ef__inwrap"><input id="in-${f.key}" class="ef__in" inputmode="none" autocomplete="off" spellcheck="false" data-key="${f.key}" data-kind="val" value="${st.vals[f.key] ?? ''}" ${f.key === fs[0].key ? 'data-first' : ''}><span class="ef__unit">${f.unit}</span></div>
            <div class="ef__vis"><div class="ef__der" data-der="${f.key}"></div><div class="ef__ruler" data-ruler="${f.key}"></div></div>
          </div>
          <div class="ef__conf" data-conf="${f.key}" hidden></div>
        </div>`)}
        ${c.group === 'storage' || c.fields?.includes('tempMinC') ? h`<p class="ent__order" data-order role="alert" hidden>${icon('alert', 'ico--s')}Minimum, current and maximum are out of order. Check the display.</p>` : ''}
        ${hasReset ? h`<button class="tgl ${st.reset ? 'is-on' : ''}" role="switch" aria-checked="${st.reset}" data-act="ent-reset"><span class="tgl__sw" aria-hidden="true"></span><span><b>Reset minimum and maximum after this reading</b><small>The next reading starts fresh.</small></span></button>` : ''}
        <section class="conseq" data-conseq hidden aria-live="polite"><h3>${icon('alert')}If you save this, the LIMS will</h3><ul>${consequences(c).map(([i, t]) => h`<li>${icon(i)}<span>${t}</span></li>`)}</ul></section>
      </div>
      <aside class="ent__pad" aria-label="Number pad">
        <p class="pad__for" data-padfor>Typing</p>
        <div class="pad"><div class="pad__d">${PAD.flat().map(padKey)}</div><div class="pad__f"><button class="pk pk--fn" data-pad="back" aria-label="Delete last digit">${icon('backspace')}</button><button class="pk pk--fn" data-pad="clear">Clear</button><button class="pk pk--next" data-pad="next">Next</button></div></div>
        <p class="pad__hint">A keyboard works too.</p>
      </aside>
    </div>`;
  }

  O.register('entry', {
    layout: 'sheet', keepDraft: true, wide: true,
    init: (p) => ({ vals: p.preset ? { ...p.preset } : {}, conf: {}, reset: true, active: null, done: null, sigDone: null }),
    snapshot: (st) => ({ ...st }),
    canClose: (st) => true,
    render: (p, st) => {
      const c = M.checkById.get(p.id);
      if (st.done) return doneView(c, st);
      if (p.mode === 'detail') return detailView(c);
      const bal = c.group === 'balances'; const meaning = 'Performed';
      return h`
      <header class="ov__head"><div><p class="ov__kicker">${bal ? 'Verification. Signed Performed.' : 'Reading. Audited, not signed.'} ${c.schedule}.</p>
        <h2 id="ov-entry-h" class="ov__title"><span class="mono">${c.target}</span> ${c.name}${c.compartment ? '' : ''}</h2></div>
        <button class="iconbtn" data-act="ov-close" aria-label="Close without saving">${icon('x')}</button></header>
      ${entryBody(c, st)}
      <footer class="ov__foot ov__foot--ilk">
        <div class="ilk-inline" data-ilk></div>
        <button class="key key--ghost" data-act="ov-close">Cancel</button>
        <button class="key" data-act="ent-save" id="ent-save" aria-disabled="true">${bal ? `Sign ${meaning} and save` : 'Save reading'}</button>
      </footer>`;
    },
    mount(panel, st, p) {
      const c = M.checkById.get(p.id); if (st.done || p.mode === 'detail') return;
      const fs = fieldsOf(c); const inputs = () => LX.$$('.ef__in', panel);
      const clock = () => { const el = panel.querySelector('#ent-now'); if (el) el.textContent = `${T.hms(T.now())} ${T.zone(T.now())}`; };
      clock(); const tick = setInterval(() => { if (!document.contains(panel)) clearInterval(tick); else clock(); }, 1000);
      const sanitize = (s) => { let v = s.replace('−', '-').replace(/[^0-9.\-]/g, ''); v = (v[0] === '-' ? '-' : '') + v.replace(/-/g, ''); const i = v.indexOf('.'); if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, ''); return v.slice(0, 12); };
      panel.addEventListener('input', (e) => { const el = e.target.closest('.ef__in'); if (!el) return; const v = sanitize(el.value); if (v !== el.value) el.value = v; (el.dataset.kind === 'conf' ? st.conf : st.vals)[el.dataset.key] = v; refresh(); });
      panel.addEventListener('focusin', (e) => { const el = e.target.closest('.ef__in'); if (el) { st.active = `${el.dataset.key}:${el.dataset.kind}`; markActive(); } });
      panel.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest('.ef__in')) { e.preventDefault(); next(); } });
      panel.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pad]'); if (!b) return; press(b.dataset.pad);
      });
      const activeEl = () => { const [k, kind] = (st.active ?? `${fs[0].key}:val`).split(':'); return panel.querySelector(`.ef__in[data-key="${k}"][data-kind="${kind}"]`); };
      function markActive() {
        panel.querySelectorAll('.ef').forEach((x) => x.classList.remove('is-active'));
        const el = activeEl(); if (!el) return; el.closest('.ef').classList.add('is-active');
        const f = fs.find((x) => x.key === el.dataset.key); panel.querySelector('[data-padfor]').innerHTML = String(h`<span>Typing <b>${el.dataset.kind === 'conf' ? 'again: ' : ''}${f.label}</b> in ${f.unit}</span>`);
      }
      function press(k) {
        const el = activeEl(); if (!el) return; let v = el.value;
        if (k === 'back') v = v.slice(0, -1);
        else if (k === 'clear') v = '';
        else if (k === '±') v = v.startsWith('-') ? v.slice(1) : `-${v}`;
        else if (k === '.') { if (v.includes('.')) return; v = v === '' || v === '-' ? `${v}0.` : `${v}.`; }
        else if (k === 'next') return next();
        else { if (v === '0') v = ''; else if (v === '-0') v = '-'; v = (v + k).slice(0, 12); }
        el.value = v; (el.dataset.kind === 'conf' ? st.conf : st.vals)[el.dataset.key] = v; refresh(); el.focus({ preventScroll: true });
      }
      function order() { return inputs().map((el) => el); }
      function next() {
        const list = order(); const el = activeEl(); const i = list.indexOf(el); const n = list[i + 1];
        if (n) { n.focus({ preventScroll: true }); n.scrollIntoView({ block: 'nearest' }); } else { const s = panel.querySelector('#ent-save'); s.focus({ preventScroll: true }); }
      }
      function refresh() {
        const evs = fs.map((f) => [f, evalField(f, st.vals[f.key])]);
        let bad = false, missing = false, unconfirmed = false, orderBad = false;
        for (const [f, e] of evs) {
          panel.querySelector(`[data-der="${f.key}"]`).innerHTML = String(derived(c, f, e));
          panel.querySelector(`[data-ruler="${f.key}"]`).innerHTML = String(ruler(c, f, e));
          const box = panel.querySelector(`[data-conf="${f.key}"]`); const need = isBad(e);
          if (need && box.hidden) {
            box.hidden = false; box.innerHTML = String(h`<div class="ef__cl"><label for="cf-${f.key}" class="ef__l">Type it again to confirm</label><span class="ef__why">${e.s === 'implausible' ? 'This is outside what is plausible. Read the display again before you confirm.' : `It is outside its limit. Type the same ${f.kind === 'weight' ? 'weighing' : 'value'} a second time so a typo cannot save it.`}</span></div>
              <div class="ef__inwrap ef__inwrap--conf"><input id="cf-${f.key}" class="ef__in ef__in--conf" inputmode="none" autocomplete="off" spellcheck="false" data-key="${f.key}" data-kind="conf" value="${st.conf[f.key] ?? ''}"><span class="ef__unit">${f.unit}</span></div><span class="ef__cs" data-cs="${f.key}"></span>`);
          } else if (!need && !box.hidden) { box.hidden = true; box.innerHTML = ''; delete st.conf[f.key]; }
          if (need) {
            bad = true; const same = asNum(st.conf[f.key]) != null && asNum(st.conf[f.key]) === e.v; const cs = panel.querySelector(`[data-cs="${f.key}"]`);
            if (!same) unconfirmed = true;
            if (cs) cs.innerHTML = String(st.conf[f.key] ? (same ? h`<span class="chip chip--go">${icon('check')}Matches</span>` : h`<span class="chip chip--stop">${icon('x')}Does not match</span>`) : h`<span class="chip chip--dead">Waiting for the second entry</span>`);
          }
          if (e.s === 'empty') missing = true;
        }
        if (fs.some((f) => f.key === 'tempMinC')) { const v = (k) => asNum(st.vals[k]); const [a, b, d] = [v('tempMinC'), v('tempC'), v('tempMaxC')]; orderBad = a != null && b != null && d != null && (a > b || b > d); panel.querySelector('[data-order]').hidden = !orderBad; }
        panel.querySelector('[data-conseq]').hidden = !bad;
        const ready = !missing && !unconfirmed && !orderBad;
        const save = panel.querySelector('#ent-save'); save.setAttribute('aria-disabled', ready ? 'false' : 'true'); save.classList.toggle('key--danger', bad);
        save.textContent = c.group === 'balances' ? (bad ? 'Sign Performed and save the failing Check' : 'Sign Performed and save') : (bad ? 'Save the failing reading' : 'Save reading');
        const ilk = [
          { kind: missing ? 'off' : 'on', label: c.group === 'balances' ? 'Both weighings typed' : 'Every value typed' },
          ...(bad ? [{ kind: unconfirmed ? 'wait' : 'on', label: 'Values outside limits typed a second time' }] : []),
          ...(orderBad ? [{ kind: 'fault', label: 'Minimum, current, maximum in order' }] : []),
          ...(c.group === 'balances' ? [{ kind: 'off', label: 'Signature comes next', id: 'sig' }] : []),
        ];
        panel.querySelector('[data-ilk]').innerHTML = String(U.interlocks(ilk));
        st.ready = ready; st.bad = bad;
      }
      refresh(); markActive();
      // start where the work is: the second entry for a failing value, otherwise the first empty field
      const startEl = (() => { const conf = panel.querySelector('.ef__in--conf'); if (st.active) return activeEl(); if (conf && !conf.value) return conf; return inputs().find((x) => !x.value) ?? inputs()[0]; })();
      startEl?.focus({ preventScroll: true }); markActive(); startEl?.scrollIntoView({ block: 'nearest' });
    },
  });

  /* ---------- read-only views ---------- */
  function detailView(c) {
    const fit = c.targetKind === 'Equipment' ? M.fitness(c.target) : null; const off = fit && fit.status !== 'In use';
    let body;
    if (c.status === 'Done') {
      body = h`<p class="lead">${c.weights ? 'Signed Performed and saved.' : 'Saved.'} Recorded at <b class="mono">${T.stampS(new Date(c.at))}</b> by ${who(c.by).name}.</p>
        ${valueList(c)}
        ${c.weights ? U.sig({ personId: c.by, meaning: 'Performed', at: c.at, version: 1, hash: LX.sha256(JSON.stringify({ id: c.id, ...c.values })) }) : h`<p class="callout">${icon('info')}<span>Audited, not signed. Changing a saved reading is a <b>Critical Data Change</b>: it stays a proposal until a second person approves it.</span></p>`}`;
    } else if (c.status === 'Blocked') body = h`<p class="lead">${U.fit(fit.status)} <b>${fit.reason}</b></p><p>${c.note}</p><p class="callout">${icon('lock')}<span>A Suspended balance cannot be cited by any Test. It returns to service only through its Deviation.</span></p>${LX.devCards(devIdsIn(fit.reason, c.note))}`;
    else if (c.status === 'Overdue') body = h`<p class="lead">${U.fit(fit.status)} <b>${fit.reason}</b></p><p>${c.note}</p><p class="callout">${icon('info')}<span>The quarterly gravimetric entry is not part of this prototype.</span></p>`;
    else if (c.status === 'Due soon') body = h`<p class="lead">Quarterly gravimetric Check due <b class="mono">${c.dueDate}</b>. ${U.fit(fit.status)} until then.</p><p class="callout">${icon('info')}<span>The quarterly gravimetric entry is not part of this prototype.</span></p>`;
    else body = h`<p class="lead">Nothing to do. The pH meter is checked before its first use each day, and nobody used it today.</p>`;
    return h`<header class="ov__head"><div><p class="ov__kicker">${stChip(c.status)} ${c.type}, ${c.schedule}</p><h2 id="ov-entry-h" class="ov__title"><span class="mono">${c.target}</span> ${c.name}</h2></div>
      <button class="iconbtn" data-act="ov-close" data-first aria-label="Close">${icon('x')}</button></header>
      <div class="ov__body">${body}</div><footer class="ov__foot"><button class="key key--ghost" data-act="ov-close">Close</button></footer>`;
  }
  function doneView(c, st) {
    const r = st.done; const at = new Date(r.at);
    return h`<header class="ov__head"><div><p class="ov__kicker">${c.group === 'balances' ? 'Signed Performed and saved' : 'Saved'}</p><h2 id="ov-entry-h" class="ov__title"><span class="mono">${c.target}</span> ${c.name}</h2></div>
      <button class="iconbtn" data-act="ov-close" data-first aria-label="Close">${icon('x')}</button></header>
      <div class="ov__body">
        <p class="lead done__h">${icon('ok', 'ico--l')}Recorded at <b class="mono">${T.stampS(at)}</b> (server time). In the Audit Trail.</p>
        ${valueList(c)}
        <dl class="kv"><dt>Recorded by</dt><dd>${who(r.by).name}</dd></dl>
        ${r.sig ? U.sig(r.sig, { animate: false }) : ''}
        ${r.effects.length ? h`<section class="conseq conseq--done"><h3>${icon('alert')}What the LIMS did</h3><ul>${r.effects.map(([i, t]) => h`<li>${icon(i)}<span>${t}</span></li>`)}</ul></section>` : ''}
      </div>
      <footer class="ov__foot"><button class="key" data-act="ov-close" data-first>Back to today’s Checks</button></footer>`;
  }

  /* ---------- saving: readings are audited; verifications are signed first ---------- */
  function finalize(c, st, sig) {
    const me = S.session.person; const at = sig ? new Date(sig.at) : T.now(); const fs = fieldsOf(c);
    const vals = {}; for (const f of fs) vals[f.key] = asNum(st.vals[f.key]);
    if (c.weights) c.values = { readingsMg: fs.map((f) => vals[f.key]) };
    else { c.values = {}; for (const f of fs) c.values[f.key] = vals[f.key]; if (c.fields.includes('reset')) c.values.reset = st.reset; }
    c.at = at.toISOString(); c.by = me.id; c.status = 'Done'; c.signed = !!sig;
    const effects = [];
    if (st.bad) {
      const k = consKind(c); const id = c.target;
      const kind = k === 'storage' ? 'Excursion' : k === 'room' ? 'Room' : 'Equipment';
      const worst = fs.map((f) => [f, evalField(f, st.vals[f.key])]).filter(([, e]) => isBad(e))[0];
      const title = k === 'balance' ? `${id} failed daily verification: ${worst[0].label} read ${worst[1].pct >= 0 ? '+' : '−'}${Math.abs(worst[1].pct).toFixed(3)} % (limit ±${worst[0].tol} %)`
        : `${id} ${worst[0].label.toLowerCase()} ${fmt(worst[1].v)} ${worst[0].unit} (limit ${worst[0].lim.map((x) => fmt(x)).join(' to ')})`;
      const dev = M.openDeviation({ kind, risk: k === 'room' ? 'Minor' : 'Major', title, by: me, at });
      effects.push(['flag', h`${U.dev(dev.id)} <b>${kind} Deviation</b> opened, Risk Level ${dev.risk}, ${dev.state}.`]);
      if (k === 'balance') {
        const e = M.equipment.get(id); e.fitness = 'Suspended'; e.reason = `Failed daily Check on ${T.date(at)} (${dev.id})`;
        c.status = 'Blocked'; c.note = `Suspended: failed Check ${T.date(at)} (${dev.id}). Returns to service only through the Deviation.`;
        const n = M.holdTestsCiting(id, c.testsSinceLastPass ?? 0, dev, at);
        effects.push(['pause', h`<b>${id}</b> is Suspended (Fitness Status). Reason: ${e.reason}.`], ['lock', n ? h`<b>${n} Tests</b> have a Hold. Find them in the Lab queue under Holds: Equipment Deviation.` : h`No Test cited ${id} since its last passing Check, so no Hold was needed.`]);
      } else if (k === 'storage') {
        const e = M.equipment.get(id); if (e) { e.fitness = 'Suspended'; e.reason = `Excursion since ${T.date(at)} ${T.hm(at)} (${dev.id})`; }
        c.note = `Open Excursion ${dev.id}: new placements refused`; effects.push(['ban', h`<b>${id}</b> refuses new placements. Removals stay possible.`]);
      } else c.note = `Open ${kind} Deviation ${dev.id}`;
    }
    return { at: at.toISOString(), by: me.id, effects, sig };
  }
  LX.checks = {
    render(root) { root.innerHTML = String(board()); },
    repaint() { const m = document.getElementById('main'); if (S.route === 'checks' || S.route === 'check-fail') m.innerHTML = String(board()); },
    open(id, preset) {
      const c = M.checkById.get(id); if (!c) return;
      const entry = c.status === 'Due' && (c.fields || c.weights);
      O.open('entry', { id, mode: entry ? 'entry' : 'detail', preset: preset ?? null });
    },
    /* the signature landed: record the Check, apply what a failure does, show the result on the sheet */
    onSigned(sig, props) {
      const inst = S.layer.find((o) => o.kind === 'entry'); if (!inst) return; const c = M.checkById.get(inst.props.id);
      inst.st.done = finalize(c, inst.st, sig); O.update('entry');
    },
  };
  LX.recordFor = (c, st) => {
    const fs = fieldsOf(c); const evs = fs.map((f) => [f, evalField(f, st.vals[f.key])]); const bad = evs.some(([, e]) => isBad(e));
    const content = { check: c.id, target: c.target, readingsMg: evs.map(([, e]) => e.v), errorPct: evs.map(([, e]) => +e.pct.toFixed(4)), result: bad ? 'fail' : 'pass' };
    return {
      kind: 'Check', id: c.id, title: `Check ${c.id}: daily verification of ${c.target}`, version: 1, hash: LX.sha256(JSON.stringify(content)), meaning: 'Performed',
      lines: [...evs.map(([f, e]) => [f.label, `${fmt(e.v)} mg, error ${e.pct >= 0 ? '+' : '−'}${Math.abs(e.pct).toFixed(4)} %, ${isBad(e) ? 'fail' : 'pass'}`]), ['Result', bad ? `Fails. ${consequences(c).length} things happen when you sign` : 'Passes. The balance is cleared for use today']],
      after: bad ? h`After you sign: ${c.target} is Suspended, an Equipment Deviation opens, and ${c.testsSinceLastPass ? `${c.testsSinceLastPass} Tests get` : 'every Test that cited it gets'} a Hold.` : h`After you sign: ${c.target} is cleared for use today.`,
      done: bad ? h`Signed. The failing Check is recorded and the consequences are applied.` : h`Signed. ${c.target} is cleared for use today.`, doneKey: 'Back to the Check',
    };
  };

  /* ---------- actions ---------- */
  const A = LX.actions;
  A['ck-open'] = (el) => LX.checks.open(el.dataset.id);
  A['ck-filter'] = (el) => { ck.filter = el.dataset.s && ck.filter !== el.dataset.s ? el.dataset.s : null; LX.checks.repaint(); document.querySelector(`[data-act="ck-filter"][data-s="${el.dataset.s}"]`)?.focus({ preventScroll: true }); };
  A['ck-ack'] = () => { Object.assign(M.alarm, { state: 'acknowledged', by: S.session.person.id, at: T.now().toISOString() }); LX.checks.repaint(); LX.toast({ title: 'Alarm acknowledged', detail: `${M.room.get(M.alarm.target).name}. Recorded in the Audit Trail.` }); };
  A['ent-reset'] = (el) => { const inst = O.top(); if (!inst) return; inst.st.reset = !inst.st.reset; el.classList.toggle('is-on', inst.st.reset); el.setAttribute('aria-checked', String(inst.st.reset)); };
  A['ent-save'] = (el) => {
    const inst = O.top(); if (!inst || inst.kind !== 'entry') return; const st = inst.st; const c = M.checkById.get(inst.props.id);
    if (el.getAttribute('aria-disabled') === 'true') {
      const panel = inst.el.querySelector('.ov__panel'); const bad = panel.querySelector('.ef__in--conf:not([value=""])') ?? [...panel.querySelectorAll('.ef__in--conf')].find((x) => !x.value);
      const first = bad ?? [...panel.querySelectorAll('.ef__in[data-kind="val"]')].find((x) => !x.value);
      first?.focus({ preventScroll: true }); first?.scrollIntoView({ block: 'nearest' }); panel.querySelector('[data-ilk]')?.classList.remove('is-nudge'); void panel.offsetWidth; panel.querySelector('[data-ilk]')?.classList.add('is-nudge'); return;
    }
    if (c.group === 'balances') { O.open('sign', { record: LX.recordFor(c, st), ctx: 'check', id: c.id }); return; }
    st.done = finalize(c, st, null); O.update('entry');
    LX.toast({ title: st.bad ? 'Failing reading saved' : 'Reading saved', detail: `${c.target}. Recorded at server time. In the Audit Trail.` });
  };
})();

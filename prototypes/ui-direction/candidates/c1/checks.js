/* checks.js: today's Checks at the bench (#checks) and the failing BAL-04 verification (#check-fail).
   Glove-first entry: big fields, limits beside every field, an on-screen keypad next to the rail,
   retype-to-confirm for any out-of-limit or implausible value, and the consequence stated before saving. */
(function () {
  'use strict';
  const { L, DB, S, $, $$, esc, ic, plural, fmt, now, person, fitTag, sigBlock, audit, openDeviation, receipt, sha256, canon, deviation, fitnessOf, ZONE } = App.lib;
  const V = (App.views.checks = {});
  const C = () => S.checks;
  const CHECKS = L.checksToday;
  const byId = Object.fromEntries(CHECKS.map((c) => [c.id, c]));
  const MISSED = L.missedChecks[0];
  const ALARM = 'ALARM';

  /* the balance's own display unit, so the Analyst types exactly what the balance shows */
  const BAL = { 'BAL-01': { unit: 'mg', dp: 4, perMg: 1 }, 'BAL-02': { unit: 'mg', dp: 3, perMg: 1 }, 'BAL-03': { unit: 'g', dp: 5, perMg: 1000 }, 'BAL-04': { unit: 'g', dp: 4, perMg: 1000 }, 'BAL-05': { unit: 'g', dp: 2, perMg: 1000 } };
  const FIELD = {
    tempC: { label: 'Temperature', unit: '°C', dp: 1, key: 'tempC' },
    tempMinC: { label: 'Minimum since reset', unit: '°C', dp: 1, key: 'tempC' },
    tempMaxC: { label: 'Maximum since reset', unit: '°C', dp: 1, key: 'tempC' },
    rhPct: { label: 'Humidity', unit: '% RH', dp: 0, key: 'rhPct' },
    resistivityMOhmCm: { label: 'Resistivity', unit: 'MΩ·cm', dp: 1, key: 'resistivityMOhmCm' },
    tocPpb: { label: 'TOC', unit: 'ppb', dp: 0, key: 'tocPpb' },
  };
  const ORDER = ['Overdue', 'Due', 'Due soon', 'Blocked', 'Done', 'Not used today'];
  const STATUS = { Done: ['ok', 'check'], Due: ['due', 'todo'], 'Due soon': ['warn', 'clock'], Overdue: ['bad', 'overdue'], Blocked: ['bad', 'noentry'], 'Not used today': ['idle', 'dash'] };

  V.reset = () => { S.checks = { sel: 'CHK-RD-102', entries: {}, saved: {}, alarm: { ack: null, note: '' }, kb: null, next: null }; };
  V.enter = (route) => {
    if (route === 'check-fail') {
      const f = L.focus.checkFail; const c = byId[f.checkId]; const u = BAL[c.target];
      C().sel = f.checkId;
      C().entries[f.checkId] = { v: Object.fromEntries(f.typed.readingsMg.map((mg, i) => [`w${i}`, (mg / u.perMg).toFixed(u.dp)])), c: {} };
      C().kb = 'cf-confirm-w1';
    }
  };
  V.afterEnter = (route) => { if (route === 'check-fail') { const el = $('[data-fk="cf-confirm-w1"]'); if (el) el.focus({ preventScroll: true }); } };

  const kindOf = (c) => (c.type === 'Verification' && c.weights ? 'balance' : c.type === 'Verification' ? 'info' : c.fields.includes('resistivityMOhmCm') ? 'water' : c.targetKind === 'Room' ? 'room' : 'unit');
  const statusOf = (c) => (C().saved[c.id] ? 'Done' : c.status);
  const targetName = (c) => (c.targetKind === 'Room' ? DB.rooms[c.target].name : DB.equipment[c.target].name);
  const shortName = (c) => (c.targetKind === 'Room' ? DB.rooms[c.target].name : c.compartment ? c.compartment : DB.equipment[c.target].kind);
  const what = (c) => { const k = kindOf(c); return k === 'room' ? (DB.rooms[c.target].storage ? 'Storage room reading' : 'Room reading') : k === 'unit' ? 'Storage unit reading' : k === 'water' ? 'DI water reading' : k === 'balance' ? 'Balance verification' : c.buffers ? 'pH meter calibration' : 'Gravimetric Check'; };
  const num = (s) => { if (s == null) return NaN; const t = String(s).replace(/−/g, '-').trim(); return t === '' || t === '-' || t === '.' ? NaN : Number(t); };
  const fmtN = (x, dp) => (x < 0 ? `−${Math.abs(x).toFixed(dp)}` : x.toFixed(dp));
  const range = (r, dp, unit) => `${fmtN(r[0], dp)} to ${fmtN(r[1], dp)} ${unit}`;

  /* ---------- evaluation ---------- */
  function evalReading(c, f, raw) {
    if (raw == null || String(raw).trim() === '') return { st: 'empty' };
    const x = num(raw); if (!Number.isFinite(x)) return { st: 'invalid' };
    const m = FIELD[f]; const lim = c.limits[m.key]; const pl = c.plausible && c.plausible[m.key];
    if (pl && (x < pl[0] || x > pl[1])) return { st: 'implausible', x, lim, pl };
    if (lim && (x < lim[0] || x > lim[1])) return { st: 'out', x, lim, pl };
    return { st: 'ok', x, lim, pl };
  }
  function evalWeight(c, i, raw) {
    if (raw == null || String(raw).trim() === '') return { st: 'empty' };
    const x = num(raw); if (!Number.isFinite(x)) return { st: 'invalid' };
    const u = BAL[c.target]; const cert = c.weights[i].certifiedMg / u.perMg; const tol = c.tolerancePct;
    const err = ((x - cert) / cert) * 100;
    const st = Math.abs(err) > (c.plausiblePct || 5) ? 'implausible' : Math.abs(err) > tol + 1e-9 ? 'out' : 'ok';
    return { st, x, err, cert, lo: cert * (1 - tol / 100), hi: cert * (1 + tol / 100) };
  }
  const entry = (id) => C().entries[id] || (C().entries[id] = { v: {}, c: {}, reset: true });
  function assess(c) {
    // Returns every field's evaluation, which need a retype, and whether saving is allowed.
    const e = entry(c.id); const k = kindOf(c);
    const fields = k === 'balance' ? c.weights.map((w, i) => ({ f: `w${i}`, label: `${w.nominal} weight`, ev: evalWeight(c, i, e.v[`w${i}`]) })) : c.fields.filter((f) => f !== 'reset').map((f) => ({ f, label: FIELD[f].label, ev: evalReading(c, f, e.v[f]) }));
    const flagged = fields.filter((x) => x.ev.st === 'out' || x.ev.st === 'implausible');
    flagged.forEach((x) => { const cv = e.c[x.f]; x.confirm = cv == null || String(cv).trim() === '' ? 'empty' : num(cv) === x.ev.x ? 'match' : 'mismatch'; });
    const errors = [];
    if (k === 'unit' || (k === 'room' && c.fields.includes('tempMinC'))) {
      const v = (f) => fields.find((x) => x.f === f).ev.x;
      if (Number.isFinite(v('tempMinC')) && Number.isFinite(v('tempC')) && v('tempMinC') > v('tempC')) errors.push('The minimum since reset cannot be above the temperature now. Check the display.');
      if (Number.isFinite(v('tempMaxC')) && Number.isFinite(v('tempC')) && v('tempMaxC') < v('tempC')) errors.push('The maximum since reset cannot be below the temperature now. Check the display.');
    }
    const missing = fields.filter((x) => x.ev.st === 'empty' || x.ev.st === 'invalid');
    const unconfirmed = flagged.filter((x) => x.confirm !== 'match');
    return { fields, flagged, errors, missing, unconfirmed, fail: flagged.length > 0, ok: !missing.length && !unconfirmed.length && !errors.length };
  }
  function consequence(c) {
    const k = kindOf(c); const t = c.target;
    if (k === 'balance') {
      const cf = L.focus.checkFail.checkId === c.id ? L.focus.checkFail.consequence : null;
      const n = cf ? cf.holdsOnTests : c.testsSinceLastPass; const since = cf ? cf.since : c.lastPass;
      return { title: 'Saving this failed Check will', items: [`open an Equipment Deviation for ${t}`, `suspend ${t}: its Fitness Status becomes Suspended until the Deviation returns it to service`, n != null ? `put Holds on the ${n} Tests that cited ${t} since its last passing Check${since ? ` (${fmt.stamp(since)} ${ZONE})` : ''}` : `put Holds on every Test that cited ${t} since its last passing Check`], dev: { kind: 'Equipment', risk: 'Major' } };
    }
    if (k === 'unit' || (k === 'room' && DB.rooms[t] && DB.rooms[t].storage)) {
      const last = c.last ? ` It is presumed to have lasted since the last in-limit reading (${fmt.stamp(c.last.at)} ${ZONE}).` : ' It is presumed to have lasted since the last in-limit reading.';
      return { title: 'Saving this reading will', items: [`open an Excursion Deviation for ${t}.${last}`, `refuse new placements into ${t}; removals stay allowed`], dev: { kind: 'Excursion', risk: 'Major' } };
    }
    if (k === 'water') return { title: 'Saving this reading will', items: [`open an Equipment Deviation for ${t}`, `suspend ${t}, so it cannot be cited in a Preparation until a passing reading`], dev: { kind: 'Equipment', risk: 'Major' } };
    return { title: 'Saving this reading will', items: [`open a Room Deviation for ${t} (${DB.rooms[t].name})`], dev: { kind: 'Room', risk: 'Minor' } };
  }

  /* ---------- render ---------- */
  V.render = (route, host) => {
    host.innerHTML = `
      <div class="chk">
        <nav class="chk__list" aria-labelledby="cl-h" data-scroll-key="chk-list">
          <div class="chk__head"><h1 id="cl-h" class="h-screen">Checks today</h1><p class="chk__count"><b class="num">${CHECKS.filter((c) => statusOf(c) === 'Done').length}</b> of <span class="num">${CHECKS.length}</span> done, ${fmt.day(L.meta.labDay)}</p></div>
          <div id="chk-items">${listHTML()}</div>
        </nav>
        <section class="chk__panel" id="chk-panel" aria-live="off" data-scroll-key="chk-panel">${panelHTML()}</section>
      </div>`;
  };
  const renderAll = () => App.keepState(() => { const a = $('#chk-items'); if (a) a.innerHTML = listHTML(); const b = $('#chk-panel'); if (b) b.innerHTML = panelHTML(); const n = $('.chk__count b'); if (n) n.textContent = CHECKS.filter((c) => statusOf(c) === 'Done').length; });
  const renderPanel = () => App.keepState(() => { const b = $('#chk-panel'); if (b) b.innerHTML = panelHTML(); });

  function statusTag(st, extra = '') { const [tone, g] = STATUS[st]; return `<span class="cst cst--${tone}">${ic(g)}<span>${esc(st)}</span>${extra}</span>`; }
  const headTag = (c) => (C().saved[c.id] && C().saved[c.id].fail ? `<span class="cst cst--bad">${ic('fail')}<span>Done, failed</span></span>` : statusTag(statusOf(c)));
  function listHTML() {
    const sel = C().sel; const a = C().alarm;
    const alarm = MISSED ? `
      <button type="button" class="citem citem--alarm${sel === ALARM ? ' is-sel' : ''}${a.ack ? ' is-acked' : ''}" data-act="chk-sel" data-arg="${ALARM}" aria-current="${sel === ALARM}" data-fk="ci-alarm">
        <span class="citem__glyph">${ic('bell')}</span>
        <span class="citem__text"><span class="citem__title">Missed reading, ${esc(MISSED.target)}</span><span class="citem__sub">${esc(DB.rooms[MISSED.target].name)}, ${fmt.day(MISSED.day)}. ${a.ack ? 'Acknowledged' : 'Alarm awaiting acknowledgement'}</span></span>
        ${a.ack ? statusTag('Done') : `<span class="cst cst--alarm">${ic('bell')}<span>Alarm</span></span>`}
      </button>` : '';
    const groups = ORDER.map((st) => {
      const items = CHECKS.filter((c) => statusOf(c) === st);
      if (!items.length) return '';
      return `<h2 class="cgroup"><span>${esc(st)}</span><span class="num">${items.length}</span></h2>` + items.map((c) => {
        const saved = C().saved[c.id];
        const sub = saved ? `${saved.fail ? 'Failed' : 'Passed'}, ${esc(person(saved.by).name)} ${fmt.hm(saved.at)}` : c.status === 'Done' ? `${esc(person(c.by).name)}, ${fmt.hm(c.at)}` : c.dueDate ? `Due ${fmt.day(c.dueDate)}` : esc(c.schedule);
        const outcome = saved && saved.fail ? `<span class="cst__out">, failed</span>` : '';
        const failed = saved && saved.fail;
        return `<button type="button" class="citem${sel === c.id ? ' is-sel' : ''}${st === 'Done' || st === 'Not used today' ? ' citem--quiet' : ''}" data-act="chk-sel" data-arg="${c.id}" aria-current="${sel === c.id}" data-fk="ci-${c.id}">
          <span class="citem__glyph citem__glyph--${failed ? 'bad' : STATUS[st][0]}">${ic(failed ? 'fail' : STATUS[st][1])}</span>
          <span class="citem__text"><span class="citem__title"><span class="num">${esc(c.target)}</span> ${esc(shortName(c))}</span><span class="citem__sub">${esc(what(c))}. ${sub}</span></span>
          ${failed ? `<span class="cst cst--bad">${ic('fail')}<span>Failed</span></span>` : statusTag(st, outcome)}
        </button>`;
      }).join('');
    }).join('');
    return alarm + groups;
  }

  function panelHead(c, extra = '') {
    const eq = c.targetKind === 'Equipment' ? fitnessOf(c.target) : null;
    return `
      <header class="cp__head">
        <div class="cp__title"><h2 class="h-screen"><span class="num">${esc(c.target)}</span> ${esc(targetName(c))}</h2>${headTag(c)}</div>
        <p class="cp__sub">${esc(what(c))}${c.compartment ? `, ${esc(c.compartment.toLowerCase())}` : ''}, ${esc(c.schedule.charAt(0).toLowerCase() + c.schedule.slice(1))}. ${eq ? `Room ${esc(eq.room)}. ` : ''}Check Plan <span class="num">${esc(c.planId)}</span>.</p>
        ${eq ? `<p class="cp__fit">Fitness Status ${fitTag(eq.fitness, eq.reason || (eq.nextDue ? `next scheduled Check ${fmt.day(eq.nextDue)}` : ''))}</p>` : ''}
        ${extra}
      </header>`;
  }
  function panelHTML() {
    const sel = C().sel;
    if (sel === ALARM) return alarmHTML();
    const c = byId[sel]; if (!c) return '';
    const st = statusOf(c); const k = kindOf(c);
    if (C().saved[c.id]) return savedHTML(c);
    if (st === 'Done') return doneHTML(c);
    if (st === 'Blocked') return panelHead(c) + `<div class="cp__body"><p class="blocked">${ic('noentry')}<span><b>No entry today.</b> ${esc(c.note)}</span></p><p class="sub">Linked Deviation: ${deviation('DEV-26-0091') ? `${esc('DEV-26-0091')}, ${esc(deviation('DEV-26-0091').state)}` : ''}.</p></div>`;
    if (k === 'info') return panelHead(c) + `<div class="cp__body">${c.note ? `<p class="blocked blocked--warn">${ic(c.status === 'Overdue' ? 'overdue' : 'clock')}<span>${esc(c.note)}</span></p>` : ''}<p>${c.buffers ? `Before-use calibration with buffers ${c.buffers.map((b) => b.toFixed(2)).join(', ')}. Only needed on a day PH-01 is used.` : `Gravimetric Check every 3 months${c.dueDate ? `, due ${fmt.day(c.dueDate)}` : ''}.`}</p><p class="sub">${c.buffers ? 'Marked Not used today.' : 'Pipette gravimetric Checks run from their own worksheet, which this prototype does not include.'}</p></div>`;
    return entryHTML(c);
  }

  function field(c, f, label, ev, raw, extra = {}) {
    const fk = `cf-${f}`;
    const unit = extra.unit; const lim = extra.limitText;
    const tone = ev.st === 'ok' ? 'ok' : ev.st === 'out' ? 'bad' : ev.st === 'implausible' ? 'bad' : ev.st === 'invalid' ? 'bad' : 'idle';
    const msg = ev.st === 'ok' ? `${ic('check')}${extra.okText || 'Within limits'}` : ev.st === 'out' ? `${ic('fail')}${extra.outText || 'Outside limits'}` : ev.st === 'implausible' ? `${ic('dev')}Not plausible: outside ${extra.plText}. Check the display.` : ev.st === 'invalid' ? `${ic('fail')}Not a number` : `${ic('todo')}Waiting for a value`;
    return `
      <div class="nf nf--${tone}">
        <label class="nf__label" for="${fk}">${esc(label)}</label>
        <div class="nf__box"><input id="${fk}" data-fk="${fk}" class="nf__input num" data-num="${esc(c.id)}" data-field="${f}" value="${esc(raw || '')}" inputmode="none" autocomplete="off" spellcheck="false" aria-describedby="${fk}-lim ${fk}-st"><span class="nf__unit" aria-hidden="true">${esc(unit)}</span></div>
        <p class="nf__lim" id="${fk}-lim">${lim}</p>
        <p class="nf__st" id="${fk}-st">${msg}</p>
      </div>`;
  }
  function entryHTML(c) {
    const e = entry(c.id); const k = kindOf(c); const a = assess(c);
    let fields = '';
    if (k === 'balance') {
      const u = BAL[c.target];
      fields = `<table class="wtab"><caption class="sr-only">Weighings against certified check weights</caption>
        <thead><tr><th scope="col">Weight</th><th scope="col" class="n">Certified value</th><th scope="col">Reading, as the balance shows it</th><th scope="col" class="n">Error</th><th scope="col">Result</th></tr></thead><tbody>
        ${c.weights.map((w, i) => {
          const ev = a.fields[i].ev; const f = `w${i}`; const fk = `cf-${f}`;
          const res = ev.st === 'empty' || ev.st === 'invalid' ? '<span class="none">—</span>' : ev.st === 'ok' ? `<span class="pf pf--ok pf--word">${ic('check')}Pass</span>` : ev.st === 'implausible' ? `<span class="pf pf--bad pf--word">${ic('dev')}Not plausible</span>` : `<span class="pf pf--bad pf--word">${ic('fail')}Fail</span>`;
          const certTxt = (w.certifiedMg / u.perMg).toFixed(u.dp + 1);
          return `<tr class="wtab__row${ev.st === 'out' || ev.st === 'implausible' ? ' is-bad' : ''}">
            <th scope="row" class="num">${esc(w.nominal)}</th>
            <td class="n num">${certTxt} ${u.unit}<span class="sub">accept ${fmtN((w.certifiedMg / u.perMg) * (1 - c.tolerancePct / 100), u.dp)} to ${fmtN((w.certifiedMg / u.perMg) * (1 + c.tolerancePct / 100), u.dp)}</span></td>
            <td><div class="nf__box nf__box--table"><label class="sr-only" for="${fk}">${esc(w.nominal)} weight reading in ${u.unit}</label><input id="${fk}" data-fk="${fk}" class="nf__input num" data-num="${esc(c.id)}" data-field="${f}" value="${esc(e.v[f] || '')}" inputmode="none" autocomplete="off" spellcheck="false"><span class="nf__unit" aria-hidden="true">${u.unit}</span></div></td>
            <td class="n num err${ev.st === 'out' || ev.st === 'implausible' ? ' err--bad' : ''}">${Number.isFinite(ev.err) ? `${ev.err >= 0 ? '+' : '−'}${Math.abs(ev.err).toFixed(4)} %` : '—'}</td>
            <td>${res}</td></tr>`;
        }).join('')}</tbody></table>
        <p class="wtab__rule">Tolerance ±${c.tolerancePct} % of the certified value. Check weights CW-01, OIML E2, certificate ${esc(DB.equipment['CW-01'].certificate)}.${c.lastPass ? ` Last passing Check ${fmt.stamp(c.lastPass)} ${ZONE}.` : ''}</p>`;
    } else {
      fields = `<div class="nfs">${a.fields.map(({ f, label, ev }) => {
        const m = FIELD[f]; const lim = c.limits[m.key]; const pl = c.plausible && c.plausible[m.key];
        return field(c, f, label, ev, e.v[f], { unit: m.unit, limitText: lim ? `Limits ${range(lim, m.dp, m.unit)}` : '', plText: pl ? range(pl, m.dp, m.unit) : '' });
      }).join('')}</div>
      ${c.fields.includes('reset') ? `<label class="toggle"><input type="checkbox" class="toggle__input" data-act-change="chk-reset" data-fk="cf-reset"${e.reset ? ' checked' : ''}><span class="toggle__track" aria-hidden="true"><span class="toggle__thumb"></span></span><span class="toggle__text"><b>Reset the min and max memory after saving</b><span class="sub">Do this after you have read them, so tomorrow shows only tomorrow.</span></span></label>` : ''}`;
    }
    const last = c.last ? `<p class="cp__last">Last reading ${fmt.stamp(c.last.at)} ${ZONE}: <span class="num">${fmtN(c.last.tempC, 1)} °C</span>, min <span class="num">${fmtN(c.last.tempMinC, 1)}</span>, max <span class="num">${fmtN(c.last.tempMaxC, 1)} °C</span>.</p>` : '';
    const note = c.note && kindOf(c) !== 'balance' ? `<p class="cp__note">${ic('dev')}${esc(c.note)}</p>` : '';
    const missedHere = MISSED && MISSED.target === c.target && !C().alarm.ack ? `<p class="cp__note">${ic('bell')}No reading was saved on ${fmt.day(MISSED.day)}. The alarm is at the top of the list.</p>` : '';
    const cons = a.fail ? consequence(c) : null;
    const confirmBlock = a.flagged.length ? `
      <div class="confirm">
        <div class="conseq" role="note">
          <p class="conseq__h">${ic('dev')}${esc(cons.title)}:</p>
          <ul>${cons.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        </div>
        ${a.flagged.map((x) => {
          const fk = `cf-confirm-${x.f}`; const unit = k === 'balance' ? BAL[c.target].unit : FIELD[x.f].unit;
          const st = x.confirm === 'match' ? `<p class="nf__st nf__st--ok">${ic('check')}Confirmed: both entries match.</p>` : x.confirm === 'mismatch' ? `<p class="nf__st nf__st--bad">${ic('fail')}Does not match the first entry. Check the display and correct whichever is wrong.</p>` : `<p class="nf__st">${ic('todo')}Waiting for the second entry.</p>`;
          return `<div class="nf nf--confirm${x.confirm === 'match' ? ' nf--ok' : x.confirm === 'mismatch' ? ' nf--bad' : ''}">
            <label class="nf__label" for="${fk}">Confirm: read the ${esc(x.label.toLowerCase())} again and type it a second time</label>
            <div class="nf__box"><input id="${fk}" data-fk="${fk}" class="nf__input num" data-num="${esc(c.id)}" data-confirm="${x.f}" value="${esc(entry(c.id).c[x.f] || '')}" inputmode="none" autocomplete="off" spellcheck="false"><span class="nf__unit" aria-hidden="true">${esc(unit)}</span></div>
            ${st}</div>`;
        }).join('')}
      </div>` : '';
    const errors = a.errors.map((m) => `<p class="form-error" role="alert">${ic('fail')}<span>${esc(m)}</span></p>`).join('');
    return `${panelHead(c, last + note + missedHere)}
      <div class="cp__grid">
        <div class="cp__form">
          <p class="cp__time">${ic('clock')}The server stamps the time when you save. Nobody types a time.</p>
          ${fields}${errors}${confirmBlock}
        </div>
        ${keypadHTML()}
      </div>`;
  }
  function keypadHTML() {
    const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '−', '0', '.'];
    return `<div class="keypad" role="group" aria-label="Number keypad for gloved entry">
      ${keys.map((k) => `<button type="button" class="key num" tabindex="-1" data-key="${k === '−' ? '-' : k}" aria-label="${k === '−' ? 'Change sign' : k === '.' ? 'Decimal point' : k}">${k === '−' ? '±' : k}</button>`).join('')}
      <button type="button" class="key key--fn" tabindex="-1" data-key="back" aria-label="Delete the last character">${ic('back', 'ic--lg')}</button>
      <button type="button" class="key key--fn key--next" tabindex="-1" data-key="next" aria-label="Next field">Next ${ic('next')}</button>
    </div>`;
  }

  function weighTable(c, readingsMg) {
    const u = BAL[c.target];
    const rows = c.weights.map((w, i) => {
      const r = readingsMg[i] / u.perMg; const cert = w.certifiedMg / u.perMg; const err = ((r - cert) / cert) * 100; const pass = Math.abs(err) <= c.tolerancePct + 1e-9;
      return `<tr class="${pass ? '' : 'wtab__row is-bad'}"><th scope="row" class="num">${esc(w.nominal)}</th><td class="n num">${cert.toFixed(u.dp + 1)} ${u.unit}</td><td class="n num v ink">${r.toFixed(u.dp)} ${u.unit}</td><td class="n num err${pass ? '' : ' err--bad'}">${err >= 0 ? '+' : '−'}${Math.abs(err).toFixed(4)} %</td><td>${pass ? `<span class="pf pf--ok pf--word">${ic('check')}Pass</span>` : `<span class="pf pf--bad pf--word">${ic('fail')}Fail</span>`}</td></tr>`;
    }).join('');
    return `<table class="wtab wtab--ro"><caption class="sr-only">Recorded weighings</caption><thead><tr><th scope="col">Weight</th><th scope="col" class="n">Certified</th><th scope="col" class="n">Reading</th><th scope="col" class="n">Error</th><th scope="col">Result</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  function doneHTML(c) {
    const k = kindOf(c);
    let body = '';
    if (k === 'balance') {
      body = weighTable(c, c.values.readingsMg);
      const p = person(c.by);
      body += sigBlock({ meaning: 'Performed', statement: L.signatureMeanings.Performed, name: p.name, nativeName: p.nativeName, username: p.username, role: 'Analyst', utc: `${fmt.isoUtc(c.at)} UTC`, local: `${fmt.isoLocal(c.at)} ${ZONE} (${App.lib.IANA})`, record: `Daily verification of ${c.target}`, version: 1, sha256: sha256(canon({ check: c.id, readingsMg: c.values.readingsMg, at: c.at, by: c.by })) });
    } else {
      body = `<dl class="kv kv--done">${Object.entries(c.values).filter(([f]) => f !== 'reset').map(([f, v]) => `<div><dt>${esc(FIELD[f].label)}</dt><dd class="num v ink">${fmtN(v, FIELD[f].dp)} ${esc(FIELD[f].unit)}</dd></div>`).join('')}${c.values.reset ? '<div><dt>Min and max</dt><dd>Reset after reading</dd></div>' : ''}</dl>`;
    }
    return panelHead(c) + `<div class="cp__body"><p class="doneline">${ic('check')}<span>Done by ${esc(person(c.by).name)} at ${fmt.hm(c.at)} ${ZONE} (${fmt.hmUtc(c.at)} UTC), server time. ${c.signed ? 'Signed Performed.' : 'Recorded in the audit trail; readings are not signed.'}</span></p>${body}</div>`;
  }
  function savedHTML(c) {
    const s = C().saved[c.id]; const k = kindOf(c);
    const rows = s.fields.map((x) => `<div><dt>${esc(x.label)}</dt><dd class="num v ink">${esc(x.text)}</dd>${x.note ? `<dd class="kv__note kv__note--${x.ok ? 'ok' : 'bad'}">${esc(x.note)}</dd>` : ''}</div>`).join('');
    return panelHead(c) + `<div class="cp__body">
      <p class="doneline${s.fail ? ' doneline--bad' : ''}">${ic(s.fail ? 'fail' : 'check')}<span>${s.fail ? 'Saved as failed' : 'Saved'} by ${esc(person(s.by).name)} at ${fmt.hm(s.at)} ${ZONE} (${fmt.hmUtc(s.at)} UTC), server time. ${s.sig ? 'Signed Performed.' : 'Recorded in the audit trail; readings are not signed.'}</span></p>
      ${s.table ? s.table : `<dl class="kv kv--done">${rows}</dl>`}
      ${s.dev ? `<div class="conseq conseq--done"><p class="conseq__h">${ic('dev')}What happened on saving</p><ul>${s.effects.map((x) => `<li>${x}</li>`).join('')}</ul></div>` : ''}
      ${s.sig ? sigBlock(s.sig) : ''}
    </div>`;
  }

  function alarmHTML() {
    const a = C().alarm; const raised = MISSED.raisedTo.map((id) => person(id).name);
    const mine = MISSED.raisedTo.includes(S.userId);
    return `
      <header class="cp__head">
        <div class="cp__title"><h2 class="h-screen">${ic('bell', 'ic--lg')}Missed reading alarm</h2>${a.ack ? statusTag('Done') : `<span class="cst cst--alarm">${ic('bell')}<span>${esc(MISSED.alarm)}</span></span>`}</div>
        <p class="cp__sub"><span class="num">${esc(MISSED.target)}</span> ${esc(DB.rooms[MISSED.target].name)} had no reading on ${fmt.day(MISSED.day)}. Check Plan <span class="num">${esc(MISSED.checkPlanId)}</span>.</p>
      </header>
      <div class="cp__body">
        <p>Raised to ${esc(raised.join(' and '))}. Acknowledging records who saw it and what happened; it does not replace the missing reading.</p>
        ${a.ack ? `<p class="doneline">${ic('check')}<span>Acknowledged by ${esc(person(a.ack.by).name)} at ${fmt.hm(a.ack.at)} ${ZONE}. Recorded in the audit trail.</span></p><blockquote class="quote">${esc(a.ack.note)}</blockquote>` : mine ? `
        <div class="field field--area"><label for="alarm-note">What happened <span class="req">(required)</span></label><textarea id="alarm-note" data-fk="alarm-note" rows="3" aria-describedby="alarm-hint">${esc(a.note)}</textarea><p class="field__hint" id="alarm-hint">At least 10 characters. Then acknowledge in the rail.</p></div>` : `<p class="blocked blocked--warn">${ic('lock')}<span>Only ${esc(raised.join(' or '))} can acknowledge this alarm.</span></p>`}
        <p class="sub">Today's reading for ${esc(MISSED.target)} is still due. It is in the list under Due.</p>
      </div>`;
  }

  /* ---------- rail ---------- */
  V.rail = () => {
    const sel = C().sel; const nextDue = nextDueId(sel);
    const nextAct = nextDue ? [{ act: 'chk-sel', arg: nextDue, label: `Next: ${byId[nextDue].target}`, icon: 'next', kind: 'secondary' }] : [];
    if (sel === ALARM) {
      const a = C().alarm; const mine = MISSED.raisedTo.includes(S.userId);
      if (a.ack) return { context: `<span class="ctx__main">Alarm acknowledged</span><span class="ctx__sub">Recorded in the audit trail</span>`, actions: nextAct };
      const ok = a.note.trim().length >= 10;
      return { context: `<span class="ctx__main">Missed reading, ${esc(MISSED.target)}, ${fmt.day(MISSED.day)}</span><span class="ctx__sub">Audited, not signed</span>`, actions: mine ? [{ act: 'alarm-ack', label: 'Acknowledge alarm', kind: 'primary', icon: 'check', disabled: !ok, why: 'Write at least 10 characters about what happened.', fk: 'alarm-go' }] : [] };
    }
    const c = byId[sel]; if (!c) return { context: '', actions: [] };
    const st = statusOf(c); const k = kindOf(c);
    if (C().saved[c.id] || st === 'Done') return { context: `<span class="ctx__main"><span class="num">${esc(c.target)}</span> done</span><span class="ctx__sub">${nextDue ? `${plural(CHECKS.filter((x) => statusOf(x) === 'Due').length, 'Check')} still due` : 'Nothing else due'}</span>`, actions: nextAct };
    if (st === 'Blocked' || k === 'info') return { context: `<span class="ctx__main"><span class="num">${esc(c.target)}</span> ${esc(st.toLowerCase())}</span><span class="ctx__sub">No entry here</span>`, actions: nextAct };
    const a = assess(c);
    const why = a.missing.length ? `Enter ${a.missing.map((x) => x.label.toLowerCase()).join(' and ')}.` : a.errors.length ? a.errors[0] : a.unconfirmed.length ? `Type the ${a.unconfirmed.map((x) => x.label.toLowerCase()).join(' and ')} a second time to confirm.` : '';
    if (k === 'balance') {
      const nFail = a.flagged.length;
      return { context: `<span class="ctx__main"><span class="num">${esc(c.target)}</span> daily verification${nFail ? `: <b class="ctx__bad">${plural(nFail, 'weighing')} ${nFail === 1 ? 'fails' : 'fail'}</b>` : ''}</span><span class="ctx__sub">${nFail ? 'Confirm, then sign. Saving opens a Deviation.' : 'Signed Performed. Time set by the server.'}</span>`, actions: [{ act: 'chk-sign', label: nFail ? 'Sign failed Check…' : 'Sign Performed…', kind: nFail ? 'danger' : 'primary', icon: 'sig', disabled: !a.ok, why, fk: 'chk-go' }] };
    }
    return { context: `<span class="ctx__main"><span class="num">${esc(c.target)}</span> ${esc(what(c).toLowerCase())}${a.fail ? `: <b class="ctx__bad">out of limits</b>` : ''}</span><span class="ctx__sub">${a.fail ? 'Confirm, then save. Saving opens a Deviation.' : 'Audited, not signed. Time set by the server.'}</span>`, actions: [{ act: 'chk-save', label: a.fail ? 'Save failing reading' : 'Save reading', kind: a.fail ? 'danger' : 'primary', icon: 'check', disabled: !a.ok, why, fk: 'chk-go' }] };
  };
  function nextDueId(after) {
    const due = CHECKS.filter((c) => statusOf(c) === 'Due' && c.id !== after);
    return due.length ? due[0].id : null;
  }
  V.onEscape = () => false;

  /* ---------- saving ---------- */
  function commit(c, sig) {
    const a = assess(c); const k = kindOf(c); const e = entry(c.id); const at = now().toISOString();
    const fields = a.fields.map((x) => {
      const unit = k === 'balance' ? BAL[c.target].unit : FIELD[x.f].unit;
      const dp = k === 'balance' ? BAL[c.target].dp : FIELD[x.f].dp;
      return { label: x.label, text: `${fmtN(x.ev.x, dp)} ${unit}`, ok: x.ev.st === 'ok', note: k === 'balance' ? '' : x.ev.st === 'ok' ? 'Within limits' : x.ev.st === 'implausible' ? 'Not plausible, confirmed twice' : 'Outside limits, confirmed twice' };
    });
    if (e.reset !== undefined && c.fields && c.fields.includes('reset')) fields.push({ label: 'Min and max', text: e.reset ? 'Reset after reading' : 'Not reset' });
    const saved = { at, by: S.userId, fields, fail: a.fail, sig: sig || null, dev: null, effects: [], table: k === 'balance' ? weighTable(c, a.fields.map((x) => x.ev.x * BAL[c.target].perMg)) : '' };
    if (a.fail) {
      const cons = consequence(c);
      const worst = a.flagged[0];
      const title = k === 'balance' ? `${c.target} failed daily verification: ${worst.label.replace(' weight', '')} weight read ${worst.ev.err >= 0 ? '+' : '−'}${Math.abs(worst.ev.err).toFixed(4)} % (limit ±${c.tolerancePct} %)` : `${c.target} ${worst.label.toLowerCase()} ${fmtN(worst.ev.x, FIELD[worst.f].dp)} ${FIELD[worst.f].unit} at the ${fmt.dm(at)} reading (limits ${range(worst.ev.lim, FIELD[worst.f].dp, FIELD[worst.f].unit)})`;
      const dev = openDeviation({ kind: cons.dev.kind, risk: cons.dev.risk, title, links: [c.id] });
      saved.dev = dev.id;
      saved.effects.push(`Opened <b>${esc(dev.id)}</b>, ${esc(dev.kind)} Deviation, Risk Level ${esc(dev.risk)}, Open.`);
      if (k === 'balance' || k === 'water') {
        const eq = DB.equipment[c.target];
        S.fitness[c.target] = { ...eq, fitness: 'Suspended', reason: `Failed Check on ${fmt.dm(at)} (${dev.id})` };
        saved.effects.push(`${esc(c.target)} is now <b>Suspended</b>: failed Check on ${fmt.dm(at)} (${esc(dev.id)}).`);
      }
      if (k === 'balance') { const n = L.focus.checkFail.checkId === c.id ? L.focus.checkFail.consequence.holdsOnTests : c.testsSinceLastPass; saved.effects.push(`Holds placed on ${n != null ? `the ${n}` : 'every'} Test${n === 1 ? '' : 's'} that cited ${esc(c.target)} since its last passing Check.`); }
      if (k === 'unit' || (k === 'room' && DB.rooms[c.target] && DB.rooms[c.target].storage)) {
        if (DB.equipment[c.target]) S.fitness[c.target] = { ...DB.equipment[c.target], fitness: 'Suspended', blocks: 'new placements', reason: `Excursion since the last in-limit reading (${dev.id})` };
        saved.effects.push(`${esc(c.target)} refuses new placements until ${esc(dev.id)} allows them. Removals stay allowed.`);
      }
    }
    C().saved[c.id] = saved;
    audit(`${c.id} saved${a.fail ? ' as failed' : ''}${sig ? ', signed Performed' : ''}`);
    renderAll(); App.renderRail();
    const nx = nextDueId(c.id);
    receipt({ title: a.fail ? `${c.target} saved as failed` : `${c.target} ${k === 'balance' ? 'verification' : 'reading'} saved`, body: `${fmt.hm(at)} ${ZONE}, server time.${saved.dev ? ` ${esc(saved.dev)} opened.` : ''}${nx ? ` Next due: ${esc(byId[nx].target)}.` : ''}`, tone: a.fail ? 'bad' : 'ok', icon: a.fail ? 'dev' : 'check' });
  }

  /* ---------- actions ---------- */
  App.act['chk-sel'] = (el) => {
    C().sel = el.dataset.arg; C().kb = null;
    renderAll(); App.renderRail();
    const first = $('#chk-panel .nf__input') || $('#alarm-note');
    if (first && matchMedia('(pointer: fine)').matches) first.focus({ preventScroll: true });
    const p = $('#chk-panel'); if (p) p.scrollTop = 0;
    if (S.route === 'check-fail') { S.route = 'checks'; history.replaceState(null, '', '#checks'); App.renderTop(); }
  };
  App.act['chk-save'] = () => { const c = byId[C().sel]; if (c && assess(c).ok) commit(c, null); };
  App.act['chk-sign'] = () => {
    const c = byId[C().sel]; if (!c || !assess(c).ok) return;
    const a = assess(c); const u = BAL[c.target];
    const content = { check: c.id, plan: c.planId, target: c.target, readings: a.fields.map((x) => ({ weight: x.label, value: x.ev.x, unit: u.unit, errorPct: +x.ev.err.toFixed(4), pass: x.ev.st === 'ok' })), outcome: a.fail ? 'Fail' : 'Pass', by: S.userId };
    const hash = sha256(canon(content));
    const cons = a.fail ? consequence(c) : null;
    App.openSign({
      meaning: 'Performed', role: 'Analyst', title: `Sign the ${c.target} daily verification as Performed`,
      record: `Daily verification of ${c.target}, ${fmt.day(L.meta.labDay)}`, version: 1, sha256: hash,
      contents: `<ul class="replist">${a.fields.map((x) => `<li><span class="an">${esc(x.label)}</span><span class="v draft num">${x.ev.x.toFixed(u.dp)} ${u.unit}</span><span class="${x.ev.st === 'ok' ? 'pf pf--ok' : 'pf pf--bad'} pf--word">${ic(x.ev.st === 'ok' ? 'check' : 'fail')}${x.ev.err >= 0 ? '+' : '−'}${Math.abs(x.ev.err).toFixed(4)} %, ${x.ev.st === 'ok' ? 'pass' : 'fail'}</span></li>`).join('')}</ul><p class="manifest__line">${ic(a.fail ? 'fail' : 'check')}Outcome: <b>${a.fail ? 'Fail' : 'Pass'}</b> against ±${c.tolerancePct} %. Failing values typed twice and matched.</p>`,
      effects: a.fail ? `<ul class="effects__list effects__list--bad">${cons.items.map((x) => `<li>${esc(x.charAt(0).toUpperCase() + x.slice(1))}.</li>`).join('')}</ul>` : `<ul class="effects__list"><li>${esc(c.target)} stays In use for today.</li><li>The server records the time; the signature can never be withdrawn.</li></ul>`,
      danger: a.fail, signLabel: a.fail ? 'Sign failed Check as Performed' : null,
      onSigned: (sig) => commit(c, sig),
    });
  };
  App.act['alarm-ack'] = () => {
    const a = C().alarm; if (a.note.trim().length < 10) return;
    a.ack = { by: S.userId, at: now().toISOString(), note: a.note.trim() };
    audit(`Missed reading alarm ${MISSED.checkPlanId} ${MISSED.day} acknowledged`);
    renderAll(); App.renderRail();
    receipt({ title: 'Alarm acknowledged', body: `Recorded in the audit trail at ${fmt.hm(a.ack.at)} ${ZONE}. Today's ${esc(MISSED.target)} reading is still due.` });
  };

  /* typing: physical keyboard or the keypad */
  function onValue(input) {
    const c = byId[input.dataset.num]; if (!c) return;
    const e = entry(c.id);
    if (input.dataset.field) {
      const before = e.v[input.dataset.field];
      e.v[input.dataset.field] = input.value;
      if (before !== input.value) delete e.c[input.dataset.field];
    } else if (input.dataset.confirm) e.c[input.dataset.confirm] = input.value;
    C().kb = input.dataset.fk;
    renderPanel(); App.renderRail();
  }
  document.addEventListener('input', (e) => {
    if (e.target.matches && e.target.matches('.nf__input')) { e.target.value = e.target.value.replace(/[^0-9.\-−]/g, ''); onValue(e.target); }
    if (e.target.id === 'alarm-note') { C().alarm.note = e.target.value; App.renderRail(); }
  });
  document.addEventListener('focusin', (e) => {
    if (!(e.target.matches && e.target.matches('.nf__input'))) return;
    C().kb = e.target.dataset.fk;
    const el = e.target; setTimeout(() => { if (document.activeElement === el) el.setSelectionRange(el.value.length, el.value.length); }, 0);
  });
  document.addEventListener('change', (e) => { if (e.target.dataset.actChange === 'chk-reset') { entry(C().sel).reset = e.target.checked; } });
  document.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('.key')) e.preventDefault(); });
  document.addEventListener('click', (e) => {
    const key = e.target.closest && e.target.closest('.key'); if (!key) return;
    const inputs = $$('#chk-panel .nf__input');
    let input = (C().kb && $(`[data-fk="${C().kb}"]`)) || inputs.find((x) => !x.value) || inputs[0];
    if (!input) return;
    const k = key.dataset.key;
    if (k === 'next') { const i = inputs.indexOf(input); const nx = inputs[i + 1] || inputs[0]; C().kb = nx.dataset.fk; nx.focus(); nx.setSelectionRange(nx.value.length, nx.value.length); return; }
    // Like a calculator: the keypad always works at the end of the value, wherever a glove touched the field.
    input.focus();
    const v = input.value;
    if (k === 'back') input.value = v.slice(0, -1);
    else if (k === '-') input.value = v.startsWith('-') ? v.slice(1) : '-' + v;
    else if (k === '.') { if (v.includes('.')) return; input.value = (v === '' || v === '-' ? v + '0' : v) + '.'; }
    else input.value = v + k;
    input.setSelectionRange(input.value.length, input.value.length);
    onValue(input);
  });
})();

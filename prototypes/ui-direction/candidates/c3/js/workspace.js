/* workspace.js: the Test at the bench. Before the import (#test) and after it (#imported).
   Pencil until signed: imported numbers are graphite and dashed; signing turns them to ink. */
(() => {
  'use strict';
  const LX = window.LX, { h, raw, icon } = LX, M = LX.M, T = LX.t, U = LX.U, S = LX.S, F = M.focus;
  const ws = (S.ws = { imported: false, flag: null, ck: [false, false], sig: null, hashOpen: false, open: { prep: false, run: false, checks: false, inj: false } });
  const row = () => M.focusRow;
  const CHECKLIST = F.performedChecklist;
  const flags = () => M.flags();
  const flagOk = () => !flags().length || ws.flag?.mode === 'accept';
  const ready = () => flagOk() && ws.ck.every(Boolean);

  /* ---------- header: which Test, in what state, on which record ---------- */
  function header() {
    const r = row(); const p = r.assignee;
    return h`<header class="ws__head">
      <div class="wh__a">
        <h1 class="wh__id mono">${r.id}</h1>
        ${U.state(r.state, { large: true })}<span class="muted wh__age">for ${T.age(T.now() - r.since)}</span>
        <span class="wh__gap"></span>
        ${U.gxp(r.t.gxp)}${U.service(r.t.serviceLevel)}
        <span class="wh__due">Due <b class="mono">${r.t.dueDate}</b>${U.due(r.due)}</span>
        ${r.nHolds ? U.hold(r.nHolds) : h`<span class="hold hold--none">${icon('check', 'ico--s')}No open Holds</span>`}
        ${r.t.deviationIds.length ? r.t.deviationIds.map(U.dev) : h`<span class="hold hold--none">${icon('check', 'ico--s')}No linked Deviations</span>`}
        ${U.seal({ version: F.recordVersion, hash: F.contentSha256, signed: !!ws.sig })}
      </div>
      <dl class="wh__b">
        <div><dt>Sample</dt><dd class="mono">${r.sample.id}</dd></div>
        <div><dt>Customer</dt><dd>${r.customer.name}</dd></div>
        <div><dt>Product, Lot</dt><dd>${r.product.name} <span class="mono">${r.product.code}</span>, <span class="mono">${r.sample.lot}</span></dd></div>
        <div><dt>Method</dt><dd><span class="mono">${r.t.methodNumber} v${r.t.methodVersion}</span> ${r.method.title}</dd></div>
        <div><dt>Notebook Entry</dt><dd class="mono">${F.notebookEntry}</dd></div>
        <div><dt>Analyst</dt><dd>${p.name} <span class="muted">(signed in)</span></dd></div>
      </dl>
    </header>`;
  }

  /* ---------- Preparations ---------- */
  const eqCell = (id) => { const f = M.fitness(id); return h`<span class="l1"><b class="mono">${id}</b>${U.fit(f.status)}</span><span class="l2 ${f.status === 'In use' ? 'muted' : 'why'}">${f.status === 'In use' ? `next Check ${f.e.nextDue}` : f.reason}</span>`; };
  const solById = (id) => F.run.solutions.find((s) => s.id === id);
  const daysLeft = (d) => T.dayDiff(M.today, d);
  const solCell = (id) => { const s = solById(id); return h`<span class="l1"><b class="mono">${id}</b>${U.fit(s.fitness)}</span><span class="l2 ${s.fitness === 'In use' ? 'muted' : 'why'}">expires ${s.expires}</span>`; };
  const who = (id) => M.person.get(id);
  const stamp = (iso) => T.stamp(new Date(iso));
  function prepPanel() {
    return h`<section class="pan" aria-labelledby="pan-prep">
      <header class="pan__h"><h2 id="pan-prep">Preparations</h2><span class="pan__c">${F.preparations.length}</span>
        <span class="chip chip--go">${icon('ok')}Weighed, entered and Verified</span></header>
      <div class="pan__scroll"><table class="pt">
        <thead><tr><th>Preparation</th><th>Weight</th><th>Volume</th><th>Balance</th><th>Pipette</th><th>DI water</th><th>Diluent Solution</th><th>Entered by</th><th>Verified by</th></tr></thead>
        <tbody>${F.preparations.map((p) => h`<tr>
          <td><span class="l1"><b>Preparation ${p.n}</b></span><span class="l2 mono muted">${p.id}</span></td>
          <td><span class="l1 mono big">${LX.num(p.weightMg, 2)} <small>mg</small></span></td>
          <td><span class="l1 mono big">${LX.num(p.volumeMl, 1)} <small>mL</small></span></td>
          <td>${eqCell(p.balance)}</td><td>${p.pipettes.map(eqCell)}</td><td>${eqCell(p.diWater)}</td><td>${solCell(p.diluent)}</td>
          <td><span class="l1">${who(p.enteredBy).name}</span><span class="l2 mono muted">${stamp(p.enteredAt)}</span></td>
          <td><span class="l1">${icon('seal', 'ico--s')} ${who(p.verifiedBy).name}</span><span class="l2 mono muted">${stamp(p.verifiedAt)}</span></td>
        </tr>`)}</tbody></table></div>
    </section>`;
  }

  /* ---------- the Run ---------- */
  function runPanel() {
    const R = F.run; const ins = M.fitness(R.instrument); const col = R.column;
    return h`<section class="pan" aria-labelledby="pan-run">
      <header class="pan__h"><h2 id="pan-run">Run <span class="mono">${R.id}</span></h2>
        <span class="chip chip--go">${icon('ok')}Instrument, column and Solutions In use</span></header>
      <div class="runfacts">
        <div class="rf"><span class="rf__k">Instrument</span><span class="rf__v"><b class="mono">${R.instrument}</b> ${ins.e.name}</span><span class="rf__s">${U.fit(ins.status)}<span class="muted">next Check ${ins.e.nextDue}</span></span></div>
        <div class="rf"><span class="rf__k">Column</span><span class="rf__v"><b class="mono">${col.pack}</b> ${col.material.replace(/ column$/, '')}</span><span class="rf__s">${U.fit(col.fitness)}<span class="muted">Pack in use for this Run</span></span></div>
        <div class="rf"><span class="rf__k">Acquired</span><span class="rf__v mono">${T.date(new Date(R.acquiredFrom))} ${T.hm(new Date(R.acquiredFrom))} to ${T.hm(new Date(R.acquiredTo))} ${T.zone(new Date(R.acquiredTo))}</span><span class="rf__s"><span class="muted">${R.injections} injections for ${R.testsInRun} Tests</span></span></div>
      </div>
      <div class="pan__scroll"><table class="pt pt--sol">
        <thead><tr><th>Solution</th><th>What it is</th><th>Made</th><th>Expires</th><th>Fitness Status, reason</th></tr></thead>
        <tbody>${R.solutions.map((s) => h`<tr><td class="mono nw"><b>${s.id}</b></td><td>${s.what}</td><td class="mono nw">${s.madeOn}</td><td class="mono nw">${s.expires}</td><td class="nw">${U.fit(s.fitness)} <span class="${s.fitness === 'In use' ? 'muted' : 'why'}">${daysLeft(s.expires)} d left</span></td></tr>`)}</tbody></table></div>
    </section>`;
  }

  /* ---------- before the import: the work path ---------- */
  function workPath() {
    const steps = [
      ['on', 'Preparations weighed and Verified', `${F.preparations.length} Preparations, Verified by ${who(F.preparations[0].verifiedBy).name}`],
      ['on', 'Run acquired', `${F.run.id} on ${F.run.instrument}, finished ${T.hm(new Date(F.run.acquiredTo))} ${T.zone(new Date(F.run.acquiredTo))}`],
      ['wait', 'Import the TargetLynx export', 'Next. The numbers arrive as drafts.'],
      ['off', 'Handle each flag', 'Accept with a comment, or request a Reinjection.'],
      ['off', 'Sign Performed', 'Your Electronic Signature makes the drafts your Results.'],
    ];
    return h`<section class="pan wp" aria-labelledby="pan-wp">
      <header class="pan__h"><h2 id="pan-wp">Where this Test is</h2></header>
      <ol class="wp__l">${steps.map(([k, t, d], i) => h`<li class="wp__i wp__i--${k}">${U.lamp(k)}<div><b>${i + 1}. ${t}</b><span>${d}</span></div></li>`)}</ol>
      <p class="callout callout--pencil">${icon('pencil')}<span>Imported numbers are <b>drafts</b> until you sign Performed.</span></p>
    </section>`;
  }

  /* ---------- after the import ---------- */
  const IMP = F.import;
  function identity() {
    const up = new Date(IMP.uploadedAt);
    return h`<section class="idn" aria-label="Imported file">
      <div class="idn__r"><span class="idn__k">${icon('file')}File</span><b class="mono" title="${LX.int(IMP.bytes)} bytes">${IMP.file}</b>
        <span class="idn__k">SHA-256</span><span class="mono">${ws.hashOpen ? U.hash(IMP.sha256) : h`<b>${IMP.sha256.slice(0, 12)}</b>\u2026`}</span><button class="btn btn--quiet btn--sm" data-act="ws-hash" aria-expanded="${ws.hashOpen}">${ws.hashOpen ? 'Hide' : 'Show all 64'}</button>
        <span class="idn__k">Parser</span><span class="mono">${IMP.parser}</span>
        <span class="idn__up muted">Uploaded by ${who(IMP.uploadedBy).name} ${T.hm(up)} ${T.zone(up)}</span></div>
      <div class="idn__r"><span class="idn__k">Dataset</span><span class="mono ell idn__ds" title="${IMP.dataset}">${IMP.dataset}</span>
        <span class="idn__k">PDF</span><span class="mono">${IMP.pdf.file}</span><span class="mono muted">${IMP.pdf.sha256.slice(0, 8)}</span>
        <span class="chip chip--go">${icon('ok')}Cross-check: ${LX.int(IMP.pdf.crossCheck.cellsCompared)} cells, ${IMP.pdf.crossCheck.mismatches} mismatches</span></div>
    </section>`;
  }
  const injTxt = (i) => (typeof i.pguL === 'number' ? i.pguL.toFixed(3) : i.pguL === 'Below RL' ? '< LOQ' : 'n.d.');
  function matrix() {
    const signed = !!ws.sig; const c = signed ? '' : 'draft';
    const P = F.preparations;
    return h`<div class="mx__wrap"><table class="mx ${signed ? 'is-signed' : 'is-draft'}" aria-label="${signed ? 'Results' : 'Draft values'}, per analyte">
      <thead><tr>
        <th scope="col" class="mx__a">Analyte<small>illustrative limit, ppm</small></th>
        ${P.map((p) => h`<th scope="col">Preparation ${p.n} Result<small>${LX.num(p.weightMg, 2)} mg in ${LX.num(p.volumeMl, 1)} mL. Injections in pg/µL</small></th>`)}
        <th scope="col">Reportable Result<small>mean of the Preparations, ppm</small></th>
        <th scope="col" class="mx__r">Against LOQ and limit<small>LOQ ${M.ppm(F.results[0].loqPpm)} ppm. Log scale</small></th>
        <th scope="col" class="mx__p">% of limit</th>
      </tr></thead>
      <tbody>${F.results.map((r) => {
        const rep = r.reportablePpm != null ? M.ppm(r.reportablePpm) : r.reportableDisplay; const num = r.reportablePpm != null;
        const kind = num ? 'value' : r.reportableDisplay === '< LOQ' ? 'loq' : 'nd';
        const flagged = r.flags.length > 0;
        return h`<tr class="${flagged ? 'has-flag' : ''}">
          <th scope="row" class="mx__a"><span class="l1"><b>${r.analyte}</b></span><span class="l2 mono muted">${M.ppm(r.limitPpm)}</span></th>
          ${r.perPrep.map((pp) => { const i1 = M.inj(r.analyte, pp.prep, 1), i2 = M.inj(r.analyte, pp.prep, 2); return h`<td class="${c ? 'draft-cell' : ''}">
            <span class="l1 mono val ${c}">${pp.ppm != null ? M.ppm(pp.ppm) : pp.display}</span>
            <span class="l2 mono injs">${[i1, i2].map((i) => { const fl = r.flags.some((f) => f.injection === i.name); return h`<span class="inj ${fl ? 'is-flag' : ''} ${c}" ${fl ? raw(`title="Flag: Peak Ratio ${i.peakRatio}, outside the window ${r.flags[0].window.join(' to ')}"`) : ''}>${fl ? icon('flag', 'ico--s') : ''}${injTxt(i)}</span>`; })}</span></td>`; })}
          <td class="${c ? 'draft-cell' : ''}"><span class="l1 mono val val--rep ${c}">${rep}</span><span class="l2 muted">${num ? 'ppm' : ''}</span></td>
          <td class="mx__r">${U.rulerLimit({ v: r.reportablePpm, loq: r.loqPpm, limit: r.limitPpm, kind, label: `${r.analyte} Reportable Result ${rep}${num ? ' ppm, ' + r.pctOfLimit + ' percent of the illustrative limit ' + M.ppm(r.limitPpm) + ' ppm' : ''}` })}</td>
          <td class="mx__p mono">${r.pctOfLimit != null ? `${r.pctOfLimit.toFixed(1)} %` : '—'}</td>
        </tr>`; })}</tbody></table></div>`;
  }
  const banner = () => (ws.sig
    ? U.sig(ws.sig, { animate: ws.justSigned, wide: true })
    : h`<div class="draftbar">${icon('pencil', 'ico--l')}<span><b>Draft values.</b> Parsed from the export. They are not your Results until you sign Performed.</span>${U.seal({ version: F.recordVersion, hash: F.contentSha256, signed: false })}</div>`);

  function flagCard() {
    const fl = flags(); if (!fl.length) return '';
    const f = fl[0]; const st = ws.flag;
    if (!st) return h`<section class="fcard fcard--open" aria-labelledby="fc-h">
      <header><span class="fcard__ic">${icon('flag', 'ico--l')}</span><div><h2 id="fc-h">1 flag to handle</h2><p>Handle it before you can sign.</p></div></header>
      <p class="fcard__d"><b>${f.analyte}: ${f.kind}</b>. Injection <span class="mono">${f.injection}</span>, Preparation ${f.prep}. Peak Ratio <b class="mono">${f.found.toFixed(3)}</b>, window <span class="mono">${f.window[0].toFixed(3)} to ${f.window[1].toFixed(3)}</span>.</p>
      <div class="fcard__k"><button class="key key--ghost" data-act="ws-flag" data-mode="accept" data-fk="flag-accept">Accept with a comment</button><button class="key key--ghost" data-act="ws-flag" data-mode="reinject">Request a Reinjection</button></div>
    </section>`;
    const by = who(st.by);
    return h`<section class="fcard fcard--${st.mode === 'accept' ? 'done' : 'wait'}" aria-labelledby="fc-h">
      <header><span class="fcard__ic">${U.lamp(st.mode === 'accept' ? 'on' : 'wait')}</span><div><h2 id="fc-h">${st.mode === 'accept' ? 'Flag handled: accepted' : 'Reinjection requested'}</h2><p>${f.analyte}, <span class="mono">${f.injection}</span>. ${by.name} at ${T.hm(new Date(st.at))} ${T.zone(new Date(st.at))}.</p></div></header>
      ${st.mode === 'accept' ? h`<blockquote class="fcard__q">${st.comment}</blockquote>` : h`<p class="fcard__d">Waiting for the new export of Preparation ${f.prep}. This Test stays In Progress. Signing is on hold until the new values arrive.</p>`}
      ${ws.sig ? '' : h`<div class="fcard__k"><button class="btn" data-act="ws-flag-undo">${st.mode === 'accept' ? 'Change the decision' : 'Cancel the request'}</button></div>`}
    </section>`;
  }
  function checkTiles() {
    const s = M.runChecksSummary();
    const tile = (id, title, big, sub) => h`<button class="rc" data-act="ws-rc" data-k="${id}" aria-expanded="${ws.open.checks === id}"><span class="rc__h">${U.lamp('on')}<b>${title}</b></span><span class="rc__n mono">${big}</span><span class="rc__s">${sub}</span></button>`;
    return h`<section class="rcs" aria-labelledby="rc-h"><h2 id="rc-h" class="rcs__h">Run checks <span class="chip chip--go">${icon('ok')}All pass</span></h2>
      <div class="rcs__g">
        ${tile('cal', 'Calibration', `${s.calibration.pass} of ${s.calibration.of}`, `r² ${s.calibration.range[0].toFixed(4)} to ${s.calibration.range[1].toFixed(4)}`)}
        ${tile('ccv', 'CCV recovery', `${s.ccv.pass} of ${s.ccv.of}`, `${s.ccv.range[0]} to ${s.ccv.range[1]} % in ${s.ccv.limits.join(' to ')} %`)}
        ${tile('blk', 'Blanks', `${s.blanks.pass} of ${s.blanks.of}`, 'nothing above the reporting limit')}
        ${tile('loq', 'LOQ signal-to-noise', `${s.loq.pass} of ${s.loq.of}`, `lowest ${s.loq.low}, needs ${s.loq.limit} or more`)}
      </div>
      ${ws.open.checks ? runCheckDetail(ws.open.checks) : ''}
    </section>`;
  }
  function runCheckDetail(k) {
    const c = F.run.checks;
    const rows = { cal: c.calibration.map((x) => [x.analyte, `${x.internalStandard}, ${x.levels} levels, ${x.rangePguL.join(' to ')} pg/µL, weighting ${x.weighting}`, `r² ${x.r2.toFixed(4)}`, x.pass]),
      ccv: c.ccv.map((x) => [x.analyte, x.name, `${x.recoveryPct} %`, x.pass]),
      blk: c.blanks.map((x) => [x.analyte, x.name, x.found == null ? 'nothing found' : x.found, x.pass]),
      loq: c.loqSignalToNoise.map((x) => [x.analyte, 'lowest standard', `S/N ${x.sn}`, x.pass]) }[k];
    return h`<div class="rcd" role="region" aria-label="Run check details"><table><tbody>${rows.map(([a, b, v, p]) => h`<tr><th scope="row">${a}</th><td>${b}</td><td class="mono">${v}</td><td>${p ? h`<span class="chip chip--go">${icon('check')}Pass</span>` : h`<span class="chip chip--stop">Fail</span>`}</td></tr>`)}</tbody></table></div>`;
  }
  function injections() {
    const signed = !!ws.sig; const c = signed ? '' : 'draft';
    const rows = F.injections; const isFlag = (i) => flags().some((f) => f.analyte === i.analyte && f.injection === i.name);
    const dash = '\u2014';
    return h`<section class="injp" aria-label="Injections">
      <button class="btn injp__t" data-act="ws-open" data-k="inj" aria-expanded="${ws.open.inj}">${icon(ws.open.inj ? 'chev-u' : 'chev-d', 'ico--s')}${ws.open.inj ? 'Hide' : 'Show'} the ${rows.length} injections behind these Results<span class="muted">retention time, area, internal standard area, pg/\u00B5L, Peak Ratio, S/N</span></button>
      ${ws.open.inj ? h`<div class="mx__wrap injp__w"><table class="ix ${signed ? 'is-signed' : 'is-draft'}">
        <thead><tr><th>Analyte</th><th>Injection</th><th>Preparation</th><th>RT, min</th><th>Area</th><th>IS area</th><th>pg/\u00B5L</th><th>Peak Ratio</th><th>S/N</th></tr></thead>
        <tbody>${rows.map((i) => h`<tr class="${isFlag(i) ? 'is-flag' : ''}">
          <th scope="row">${i.analyte}</th><td class="mono">${i.name}</td><td class="mono">P${i.prep}, inj ${i.inj}</td>
          <td class="mono ${c}">${i.rt ?? dash}</td><td class="mono ${c}">${i.area == null ? dash : LX.int(i.area)}</td><td class="mono ${c}">${LX.int(i.isArea)}</td>
          <td class="mono ${c}">${typeof i.pguL === 'number' ? i.pguL.toFixed(3) : i.pguL === 'Below RL' ? '< LOQ' : 'Not detected'}</td>
          <td class="mono ${c}">${i.peakRatio == null ? dash : i.peakRatio.toFixed(3)}${isFlag(i) ? h` ${icon('flag', 'ico--s')}` : ''}</td><td class="mono ${c}">${i.sn ?? dash}</td>
        </tr>`)}</tbody></table></div>` : ''}
    </section>`;
  }
  function ctxCards() {
    const P = F.preparations; const R = F.run;
    return h`<div class="ctx">
      <section class="ctxc" aria-label="Preparations"><div class="ctxc__h"><h2>Preparations</h2><button class="btn btn--quiet btn--sm" data-act="ws-open" data-k="prep" aria-expanded="${ws.open.prep}">${ws.open.prep ? 'Hide' : 'Details'}${icon(ws.open.prep ? 'chev-u' : 'chev-d', 'ico--s')}</button></div>
        <p>${P.map((p) => h`<span class="mono"><b>P${p.n}</b> ${LX.num(p.weightMg, 2)} mg in ${LX.num(p.volumeMl, 1)} mL</span>`)}</p>
        <p class="muted">Verified by ${who(P[0].verifiedBy).name}. Balance ${P[0].balance} ${U.fit('In use')}</p></section>
      <section class="ctxc" aria-label="Run"><div class="ctxc__h"><h2>Run</h2><button class="btn btn--quiet btn--sm" data-act="ws-open" data-k="run" aria-expanded="${ws.open.run}">${ws.open.run ? 'Hide' : 'Details'}${icon(ws.open.run ? 'chev-u' : 'chev-d', 'ico--s')}</button></div>
        <p><span class="mono"><b>${R.id}</b></span> on <span class="mono">${R.instrument}</span> ${U.fit('In use')}</p>
        <p class="muted">Column ${R.column.pack} ${U.fit(R.column.fitness)} and ${R.solutions.length} Solutions ${U.fit('In use')}</p></section>
    </div>${ws.open.prep ? prepPanel() : ''}${ws.open.run ? runPanel() : ''}`;
  }

  /* ---------- the dock: one next key, and what still blocks it ---------- */
  function dock() {
    const r = row();
    if (ws.sig) return h`<div class="dock__msg"><b>${icon('ok', 'ico--l')}Signed Performed. ${r.id} is now Submitted for Review.</b><span>Hand the PC to the next person: lock it, or let them switch user.</span></div>
      <div class="dock__keys"><button class="key" data-act="lock" data-first>${icon('lock')}Lock this PC</button><button class="key key--ghost" data-act="switch">${icon('swap')}Switch user</button></div>`;
    if (!ws.imported) return h`<div class="dock__msg"><b>Next: import the TargetLynx export from the Run.</b><span>It arrives as draft values. You check them, then sign.</span></div>
      <div class="dock__keys"><button class="key" data-act="ws-upload">${icon('upload')}Upload TargetLynx export</button></div>`;
    const ok = ready(); const left = (flagOk() ? 0 : 1) + ws.ck.filter((x) => !x).length;
    const reinject = ws.flag?.mode === 'reinject';
    const item = (m) => h`<button class="ilkb ${ws.ck[m] ? 'is-on' : ''}" role="checkbox" aria-checked="${!!ws.ck[m]}" data-act="ws-check" data-i="${m}" data-fk="ck${m + 1}">${U.lamp(ws.ck[m] ? 'on' : 'off')}<span>${CHECKLIST[m + 1]}</span></button>`;
    const lamp1 = flagOk() ? 'on' : reinject ? 'wait' : 'off';
    return h`<div class="dock__ilk" role="group" aria-labelledby="dock-h">
        <p class="dock__h" id="dock-h">Before you can sign Performed</p>
        <button class="ilkb ilkb--derived ${flagOk() ? 'is-on' : ''}" data-act="ws-flag" data-mode="${reinject ? 'reinject' : 'accept'}" data-fk="ck0" aria-label="${CHECKLIST[0]}. ${flagOk() ? 'Done.' : reinject ? 'Waiting for the Reinjection.' : 'Not done. Open the flag.'}">${U.lamp(lamp1)}<span>${CHECKLIST[0]}</span></button>
        ${item(0)}${item(1)}
      </div>
      <div class="dock__keys"><button class="key key--stack" data-act="ws-sign" ${ok ? '' : raw('aria-disabled="true"')} data-fk="sign">${icon(ok ? 'seal' : 'lock')}Sign Performed<small>${ok ? 'Moves the Test to Submitted for Review' : reinject && flagOk() === false ? 'Waiting for the Reinjection' : `${LX.plural(left, 'condition')} still open`}</small></button></div>`;
  }

  /* ---------- render ---------- */
  function paintDock() { const d = document.getElementById('dock'); if (d) { const fk = document.activeElement?.dataset?.fk; d.innerHTML = String(dock()); if (fk) d.querySelector(`[data-fk="${fk}"]`)?.focus({ preventScroll: true }); d.classList.toggle('dock--signed', !!ws.sig); } }
  function paintResults() { const el = document.getElementById('ws-res'); if (el) el.innerHTML = String(resultsInner()); }
  const resultsInner = () => h`
    ${identity()}
    <div class="res__g">
      <div class="res__main">${banner()}${matrix()}${injections()}${ctxCards()}</div>
      <aside class="res__side">${flagCard()}${checkTiles()}</aside>
    </div>`;
  function render(root) {
    const before = !ws.imported;
    root.innerHTML = String(h`<section class="ws ${before ? 'ws--before' : 'ws--after'}" aria-label="Test workspace">
      ${header()}
      <div class="ws__scroll" id="ws-scroll">
        ${before ? h`<div class="ws__b1">${prepPanel()}</div><div class="ws__b2">${runPanel()}${workPath()}</div>` : h`<div class="res ${ws.justImported ? 'res--in' : ''}" id="ws-res">${resultsInner()}</div>`}
      </div>
      <footer class="dock ${ws.sig ? 'dock--signed' : ''}" id="dock" aria-label="Next action">${dock()}</footer>
    </section>`);
    ws.justImported = false; ws.justSigned = false;
  }

  LX.workspace = {
    render, paintDock, paintResults,
    /* what each deep link needs to have happened first; never lowers what the person already did */
    seed(level) {
      if (level >= 1) ws.imported = true;
      if (level >= 2 && !ws.flag) { ws.flag = { mode: 'accept', comment: LX.PHRASES[0], at: new Date(T.now().getTime() - 4 * 60000).toISOString(), by: 'u10' }; ws.ck = [true, true]; }
    },
    fullRefresh() { render(document.getElementById('main')); },
    signedRecord() {
      return { kind: 'Test', id: F.testId, title: `Test ${F.testId}`, version: F.recordVersion, hash: F.contentSha256, meaning: 'Performed', lines: recordLines(),
        after: `After you sign: the drafts become your Results and ${F.testId} moves to Submitted for Review. A signature cannot be withdrawn.`,
        done: `${F.testId} is now Submitted for Review.`, doneKey: 'Back to the Test' };
    },
    onSigned(sig) {
      ws.sig = sig; ws.justSigned = true; M.submitForReview(row(), M.person.get(sig.personId), new Date(sig.at));
    },
  };
  function recordLines() {
    const rr = F.results; const num = rr.filter((r) => r.reportablePpm != null); const lt = rr.filter((r) => r.reportableDisplay === '< LOQ'); const nd = rr.filter((r) => r.reportableDisplay === 'Not detected');
    return [
      [`${F.import.rowsForThisTest} draft values`, `from ${F.import.file}, hash ${F.import.sha256.slice(0, 8)}`],
      [`${F.preparations.length} Preparations`, F.preparations.map((p) => `P${p.n} ${LX.num(p.weightMg, 2)} mg`).join(', ')],
      ['Reportable Results', `${num.map((r) => `${r.analyte} ${M.ppm(r.reportablePpm)} ppm`).join(', ')}; ${lt.map((r) => r.analyte).join(', ')} < LOQ; ${nd.length} not detected`],
      ['Flag', ws.flag ? `${flags()[0].analyte} ion ratio, ${ws.flag.mode === 'accept' ? 'accepted with a comment' : 'Reinjection requested'}` : 'none'],
    ];
  }

  /* ---------- actions ---------- */
  const A = LX.actions;
  A['ws-upload'] = () => LX.overlay.open('upload');
  A['ws-flag'] = (el) => { const inst = LX.overlay.open('flag'); if (el?.dataset.mode === 'reinject') { inst.st.mode = 'reinject'; LX.overlay.update('flag'); } };
  A['ws-flag-undo'] = () => { ws.flag = null; paintResults(); paintDock(); };
  A['ws-check'] = (el) => { const i = +el.dataset.i; ws.ck[i] = !ws.ck[i]; paintDock(); };
  A['ws-sign'] = (el) => {
    if (el.getAttribute('aria-disabled') === 'true') {
      const first = !flagOk() ? 'ck0' : !ws.ck[0] ? 'ck1' : 'ck2';
      const t = document.querySelector(`[data-fk="${first}"]`); if (t) { t.classList.remove('is-nudge'); void t.offsetWidth; t.classList.add('is-nudge'); t.focus({ preventScroll: true }); }
      return;
    }
    LX.go('sign');
  };
  A['ws-hash'] = () => { ws.hashOpen = !ws.hashOpen; paintResults(); };
  A['ws-rc'] = (el) => { ws.open.checks = ws.open.checks === el.dataset.k ? false : el.dataset.k; paintResults(); document.querySelector(`.rc[data-k="${el.dataset.k}"]`)?.focus({ preventScroll: true }); };
  A['ws-open'] = (el) => { ws.open[el.dataset.k] = !ws.open[el.dataset.k]; paintResults(); document.querySelector(`[data-act="ws-open"][data-k="${el.dataset.k}"]`)?.focus({ preventScroll: true }); };
})();

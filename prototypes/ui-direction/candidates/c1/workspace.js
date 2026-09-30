/* workspace.js: the Test workspace at the bench (#test before the import, #imported after it, #sign with the prompt open).
   The record reads down the left; the right column says what is left to do; the rail holds the next commit. */
(function () {
  'use strict';
  const { L, DB, S, $, $$, esc, ic, plural, fmt, now, person, stateTag, gxpTag, dueCell, fitTag, sigBlock, audit, receipt, sha256, sha256Bytes, canon, nameLine } = App.lib;
  const V = (App.views.test = {});
  const F = L.focus.test;
  const W = () => S.work;
  const test = () => S.testIdx[F.testId];
  const isAssignee = () => S.userId === test().assigneeId;
  const EQ = (id) => App.lib.fitnessOf(id);
  const flagOf = F.results.find((r) => r.flags.length);
  const FLAG = flagOf.flags[0];
  const MIN_COMMENT = 15;
  const DEMO_COMMENT = 'Ion ratio low on 1 of 4 NDMA injections only. P2 injection 1 is in window (0.755), RT matches, S/N 64; NDMA is 5.3 % of the illustrative limit. Value accepted.';

  V.reset = () => { S.work = { imported: false, uploading: null, uploadError: null, flag: { choice: null, comment: '', saved: null, editing: true }, checklist: F.performedChecklist.map(() => false), version: null, versions: [], signed: null, inkIn: false }; };
  V.routeNow = () => (S.work && S.work.imported ? 'imported' : 'test');

  /* Record Versions: v1 is the draft the import creates; saving the flag decision makes v2 (the server's hash for it is in the data). */
  function draftContent(v) {
    const w = W();
    return { record: `Results of ${F.testId}`, version: v, import: { file: F.import.file, sha256: F.import.sha256, parser: F.import.parser }, injections: F.injections, results: F.results.map((r) => ({ analyte: r.analyte, perPrep: r.perPrep, reportable: r.reportablePpm ?? r.reportableDisplay })), flagDecision: v > 1 && w.flag.saved ? { choice: w.flag.saved.choice, comment: w.flag.saved.comment } : null };
  }
  function addVersion(what) {
    const w = W(); const v = (w.version || 0) + 1;
    const hash = v === F.recordVersion && w.flag.saved && w.flag.saved.choice === 'accept' ? F.contentSha256 : sha256(canon(draftContent(v)));
    w.version = v; w.versions.push({ v, sha: hash, at: now().toISOString(), by: S.userId, what });
    audit(`${F.testId} results saved as Record Version ${v}: ${what}`);
  }
  const current = () => W().versions[W().versions.length - 1];
  function importNow(at) {
    const w = W(); w.imported = true; w.uploading = null; w.version = null; w.versions = [];
    addVersion('draft values created by the TargetLynx import');
    if (at) w.versions[0].at = at;
  }

  V.enter = (route) => {
    const w = W();
    if (route === 'imported' || route === 'sign') importNow(F.import.uploadedAt);
    if (route === 'sign') {
      w.flag = { choice: 'accept', comment: DEMO_COMMENT, saved: { choice: 'accept', comment: DEMO_COMMENT, at: new Date(now() - 6 * 60e3).toISOString(), by: S.userId }, editing: false };
      addVersion('NDMA flag accepted with comment');
      current().at = w.flag.saved.at;
      w.checklist = w.checklist.map(() => true);
      S.sign = { spec: signSpec(true), error: null, opener: null };
    }
  };
  V.afterEnter = () => {};

  const readyToSign = () => { const w = W(); return w.imported && !w.signed && w.flag.saved && w.flag.saved.choice === 'accept' && !w.flag.editing && w.checklist.every(Boolean); };
  const stepNow = () => { const w = W(); if (!w.flag.saved || w.flag.editing) return 1; if (w.flag.saved.choice === 'reinject') return 0; if (!w.checklist.every(Boolean)) return 2; return 3; };

  /* ---------- render ---------- */
  V.render = (route, host) => {
    inkPending = W().inkIn;
    const t = test(); const s = DB.samples[t.sampleId]; const p = DB.products[t.productId]; const m = DB.methods[t.methodId];
    host.innerHTML = `
      <div class="ws">
        <header class="ws__head">
          <div class="ws__idline">
            <h1 class="h-screen"><span class="sr-only">Test </span><span class="num">${t.id}</span></h1>
            <span class="ws__state">${stateTag(t)}</span>
            ${gxpTag(t.gxp)}<span class="ws__svc">${esc(t.serviceLevel)}</span>
            <span class="ws__due">${dueCell(t)}</span>
          </div>
          <dl class="facts facts--row">
            <div><dt>Product</dt><dd>${esc(p.name)} <span class="num">${esc(p.code)}</span></dd></div>
            <div><dt>Lot</dt><dd class="num">${esc(s.lot)}</dd></div>
            <div><dt>Sample</dt><dd class="num">${esc(s.id)}</dd></div>
            <div><dt>Customer</dt><dd>${esc(DB.customers[t.customerId].name)}</dd></div>
            <div><dt>Method</dt><dd><span class="num">${esc(m.number)} v${m.version}</span> ${esc(m.title)}</dd></div>
            <div><dt>Notebook Entry</dt><dd class="num">${esc(F.notebookEntry)}</dd></div>
            <div><dt>Assignee</dt><dd>${esc(person(t.assigneeId).name)}</dd></div>
          </dl>
        </header>
        <div class="ws__cols">
          <div class="ws__doc${W().inkIn ? ' inking' : ''}" id="ws-doc" data-scroll-key="ws-doc">${docHTML()}</div>
          <aside class="ws__task" id="ws-task" data-scroll-key="ws-task" aria-label="What is left to do">${taskHTML()}</aside>
        </div>
      </div>`;
    inkPending = false;
    if (W().inkIn) {
      W().inkIn = false;
      requestAnimationFrame(() => requestAnimationFrame(() => { $$('#ws-doc .v.draft').forEach((el) => el.classList.replace('draft', 'ink')); }));
      setTimeout(() => { const d = $('#ws-doc'); if (d) d.classList.remove('inking'); }, 1600);
    }
  };
  const renderTask = () => App.keepState(() => { const el = $('#ws-task'); if (el) el.innerHTML = taskHTML(); });

  function recordStrip() {
    const w = W(); const v = current();
    const status = w.signed ? `<span class="rec__status rec__status--ink">${ic('sig')}Signed Performed</span>` : `<span class="rec__status rec__status--draft">${ic('pencil')}Draft, not yet your Results</span>`;
    return `<div class="rec" aria-label="Record identity"><span class="rec__label">Record</span><span class="rec__val">Results of <span class="num">${F.testId}</span></span><span class="rec__label">Record Version</span><span class="rec__val num">${v.v}</span><span class="rec__label">SHA-256</span><span class="rec__val mono">${esc(v.sha.slice(0, 8))}</span>${status}</div>`;
  }

  function docHTML() {
    const w = W();
    if (!w.imported) return `
      <section class="panel panel--empty" aria-labelledby="res-h">
        <h2 id="res-h" class="h-sec">Results</h2>
        <p class="empty__title">No results yet.</p>
        <p>Import the TargetLynx export of <span class="num">${F.run.id}</span> to create draft values. They become Results only when you sign Performed.</p>
      </section>
      ${prepsHTML()}${runHTML()}`;
    return `${recordStrip()}${importHTML()}${resultsHTML()}${checksHTML()}${injectionsHTML()}${prepsHTML()}${runHTML()}`;
  }

  function importHTML() {
    const im = F.import; const pdf = im.pdf;
    return `
      <section class="panel" aria-labelledby="imp-h">
        <div class="panel__head"><h2 id="imp-h" class="h-sec">${ic('file')}Imported file</h2><span class="okline">${ic('check')}PDF cross-check: ${fmt.int(pdf.crossCheck.cellsCompared)} cells compared, ${pdf.crossCheck.mismatches} mismatches</span></div>
        <dl class="kv kv--import">
          <div><dt>File</dt><dd class="mono">${esc(im.file)} <span class="sub">${fmt.int(im.bytes)} bytes</span></dd></div>
          <div><dt>SHA-256</dt><dd class="mono hash"><b>${esc(im.sha256.slice(0, 8))}</b> ${esc(fmt.hashGroups(im.sha256.slice(8)))}</dd></div>
          <div><dt>Dataset</dt><dd class="mono">${esc(im.dataset)}</dd></div>
          <div><dt>Parser</dt><dd class="mono">${esc(im.parser)}</dd></div>
          <div><dt>PDF</dt><dd class="mono">${esc(pdf.file)} <span class="sub">SHA-256 ${esc(pdf.sha256.slice(0, 8))}</span></dd></div>
          <div><dt>Uploaded</dt><dd>${esc(person(im.uploadedBy).name)}, ${fmt.stamp(W().versions[0].at)} ${App.lib.ZONE}. ${im.rowsForThisTest} rows for this Test.</dd></div>
        </dl>
      </section>`;
  }

  let inkPending = false; // true for the one render right after signing, so the values can transition from pencil to ink
  const inked = () => !!W().signed && !inkPending;
  const val = (x, cls = '') => `<span class="v ${inked() ? 'ink' : 'draft'} ${cls}">${x}</span>`;
  function resultsHTML() {
    const w = W(); const sd = !!w.signed;
    const flagState = () => { const f = w.flag.saved; if (!f) return `<span class="flagtag flagtag--open">${ic('flag')}Ion ratio, to handle</span>`; if (f.choice === 'accept') return `<span class="flagtag flagtag--done">${ic('check')}Accepted with comment</span>`; return `<span class="flagtag flagtag--wait">${ic('clock')}Reinjection requested</span>`; };
    const rows = F.results.map((r, i) => {
      const pp = (k) => { const x = r.perPrep[k]; return x.ppm != null ? val(x.ppm.toFixed(4), 'num') : val(esc(x.display), 'word'); };
      const rep = r.reportablePpm != null ? val(String(r.reportablePpm), 'num v--rep') : val(esc(r.reportableDisplay), 'word v--rep');
      const pct = r.pctOfLimit;
      const bar = pct != null ? `<span class="lim" aria-hidden="true"><i class="lim__loq" style="left:${Math.min(100, (r.loqPpm / r.limitPpm) * 100)}%"></i><i class="lim__val" style="width:${Math.max(1.5, pct)}%"></i></span><span class="num lim__pct">${pct.toFixed(1)} %</span>` : '<span class="none">Not quantified</span>';
      return `<tr style="--i:${i}"${r.flags.length && !w.flag.saved ? ' class="is-flagged"' : ''}>
        <th scope="row" class="an">${esc(r.analyte)}</th>
        <td class="n">${pp(0)}</td><td class="n">${pp(1)}</td><td class="n n--rep">${rep}</td>
        <td class="n num">${r.loqPpm}</td><td class="n num">${Number(r.limitPpm).toPrecision(3)}</td>
        <td class="limcell">${bar}</td>
        <td>${r.flags.length ? flagState() : ''}</td>
      </tr>`;
    }).join('');
    return `
      <section class="panel" aria-labelledby="res-h">
        <div class="panel__head"><h2 id="res-h" class="h-sec">Results by analyte</h2>${sd ? `<span class="rtag rtag--ink">${ic('sig')}Results, signed Performed</span>` : `<span class="rtag rtag--draft">${ic('pencil')}Draft values, not yet Results</span>`}<span class="panel__unit">ppm (µg/g API)</span></div>
        <div class="tscroll"><table class="res">
          <caption class="sr-only">Each Preparation's result and the Reportable Result, the mean of the Preparations, against LOQ and the illustrative limit</caption>
          <thead><tr><th scope="col">Analyte</th><th scope="col" class="n">Preparation 1</th><th scope="col" class="n">Preparation 2</th><th scope="col" class="n">Reportable Result</th><th scope="col" class="n">LOQ</th><th scope="col" class="n">Limit</th><th scope="col">Share of limit</th><th scope="col">Flag</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <p class="note">Reportable Result = mean of the Preparations, each the mean of its 2 injections. ${esc(F.limitsNote)}</p>
      </section>`;
  }

  function checksHTML() {
    const c = F.run.checks; const an = c.calibration.map((x) => x.analyte);
    const ok = (pass) => (pass ? `<span class="pf pf--ok">${ic('tick')}<span class="sr-only">pass</span></span>` : `<span class="pf pf--bad">${ic('fail')}<span class="sr-only">fail</span></span>`);
    const total = c.calibration.length + c.ccv.length + c.blanks.length + c.loqSignalToNoise.length;
    const passed = [...c.calibration, ...c.ccv, ...c.blanks, ...c.loqSignalToNoise].filter((x) => x.pass).length;
    const ccvNames = ['CCV-1', 'CCV-2', 'CCV-3'];
    const rows = an.map((a) => {
      const cal = c.calibration.find((x) => x.analyte === a);
      const ccvs = ccvNames.map((n) => c.ccv.find((x) => x.analyte === a && x.name === n));
      const bl = c.blanks.filter((x) => x.analyte === a);
      const sn = c.loqSignalToNoise.find((x) => x.analyte === a);
      return `<tr><th scope="row" class="an">${esc(a)}<span class="sub">${esc(cal.internalStandard)}</span></th>
        <td class="n"><span class="num">${cal.r2.toFixed(4)}</span>${ok(cal.pass)}</td>
        ${ccvs.map((x) => `<td class="n"><span class="num">${x.recoveryPct.toFixed(1)} %</span>${ok(x.pass)}</td>`).join('')}
        <td class="n"><span>${bl.every((x) => x.found == null) ? 'No peak' : 'Peak'}</span>${ok(bl.every((x) => x.pass))}</td>
        <td class="n"><span class="num">${sn.sn}</span>${ok(sn.pass)}</td></tr>`;
    }).join('');
    const cal0 = c.calibration[0];
    return `
      <section class="panel" aria-labelledby="rc-h">
        <div class="panel__head"><h2 id="rc-h" class="h-sec">Run checks</h2><span class="okline">${ic('check')}${passed} of ${total} pass</span></div>
        <div class="tscroll"><table class="rc">
          <caption class="sr-only">Run checks for ${F.run.id}</caption>
          <thead><tr><th scope="col">Analyte</th><th scope="col" class="n">Calibration r²<span class="sub">${cal0.levels} levels, ${cal0.rangePguL[0]} to ${cal0.rangePguL[1]} pg/µL, ${esc(cal0.weighting)}</span></th>${ccvNames.map((n) => `<th scope="col" class="n">${n}<span class="sub">recovery 80 to 120 %</span></th>`).join('')}<th scope="col" class="n">Blanks<span class="sub">2 per analyte</span></th><th scope="col" class="n">S/N at LOQ<span class="sub">at least 10</span></th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </section>`;
  }

  function injectionsHTML() {
    const w = W(); const sd = !!w.signed;
    const dash = '<span class="none" aria-label="no peak">—</span>';
    const rows = F.injections.map((j, i) => {
      const flagged = j.analyte === flagOf.analyte && j.name === FLAG.injection;
      const cell = (x, d) => (x == null ? dash : typeof x === 'number' ? val(d != null ? x.toFixed(d) : fmt.int(x), 'num') : val(esc(x), 'word'));
      const pr = j.peakRatio == null ? dash : flagged ? `<span class="v ${inked() ? 'ink' : 'draft'} num v--flag">${j.peakRatio.toFixed(3)}</span><span class="why">window ${FLAG.window[0]} to ${FLAG.window[1]}</span>` : cell(j.peakRatio, 3);
      const first = i === 0 || F.injections[i - 1].analyte !== j.analyte;
      return `<tr class="${first ? 'grp' : ''}${flagged ? ' is-flagged' : ''}" style="--i:${Math.min(i, 20)}">
        <th scope="row" class="an">${first ? esc(j.analyte) : `<span class="sr-only">${esc(j.analyte)}</span>`}</th>
        <td class="n num">P${j.prep}</td><td class="n num">${j.inj}</td>
        <td class="mono">${flagged ? ic('flag', 'ic--flag') : ''}${esc(j.name)}</td>
        <td class="n">${cell(j.rt, 2)}</td><td class="n">${cell(j.area)}</td><td class="n">${cell(j.isArea)}</td>
        <td class="n">${cell(j.pguL, 3)}</td><td class="n">${pr}</td><td class="n">${cell(j.sn)}</td>
        <td class="n num sub">${fmt.hm(j.acquiredAt)}</td></tr>`;
    }).join('');
    return `
      <section class="panel" aria-labelledby="inj-h">
        <div class="panel__head"><h2 id="inj-h" class="h-sec">Injections for this Test <span class="num">(${F.injections.length})</span></h2>${sd ? `<span class="rtag rtag--ink">${ic('sig')}Confirmed</span>` : `<span class="rtag rtag--draft">${ic('pencil')}Draft, as parsed</span>`}<span class="panel__unit">${esc(F.units.pguL)}</span></div>
        <div class="tscroll"><table class="inj">
          <caption class="sr-only">Parsed injection rows for ${F.testId} from ${esc(F.import.file)}</caption>
          <thead><tr><th scope="col">Analyte</th><th scope="col" class="n">Prep</th><th scope="col" class="n">Inj</th><th scope="col">Injection</th><th scope="col" class="n">RT min</th><th scope="col" class="n">Area</th><th scope="col" class="n">IS area</th><th scope="col" class="n">pg/µL</th><th scope="col" class="n">Peak Ratio</th><th scope="col" class="n">S/N</th><th scope="col" class="n">Acquired</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </section>`;
  }

  function prepsHTML() {
    const eqTag = (id) => { const e = EQ(id); return `<span class="eqid"><span class="num">${esc(id)}</span>${fitTag(e.fitness, e.reason, { compact: true })}</span>`; };
    const sol = (id) => { const x = F.run.solutions.find((y) => y.id === id); return `<span class="eqid"><span class="num">${esc(id)}</span>${fitTag(x ? x.fitness : 'In use', null, { compact: true })}</span>`; };
    const rows = F.preparations.map((p) => {
      const v = person(p.verifiedBy);
      return `<tr>
        <th scope="row"><span class="num">P${p.n}</span><span class="sub num">${esc(p.id)}</span></th>
        <td class="n num">${p.weightMg.toFixed(2)} mg</td><td class="n num">${p.volumeMl} mL</td>
        <td>${eqTag(p.balance)}</td><td>${p.pipettes.map(eqTag).join('')}</td><td>${eqTag(p.diWater)}</td><td>${sol(p.diluent)}</td>
        <td><span>${esc(person(p.enteredBy).name)}</span><span class="sub num">${fmt.stamp(p.enteredAt)}</span></td>
        <td><span class="sigline" title="Electronic Signature, Verified: ${esc(v.name)} (${esc(v.username)}), ${fmt.isoUtc(p.verifiedAt)} UTC">${ic('sig')}<span>${esc(v.name)}</span></span><span class="sub num">Verified ${fmt.stamp(p.verifiedAt)}</span></td>
      </tr>`;
    }).join('');
    return `
      <section class="panel" aria-labelledby="prep-h">
        <div class="panel__head"><h2 id="prep-h" class="h-sec">Preparations <span class="num">(${F.preparations.length})</span></h2><span class="rtag rtag--ink">${ic('sig')}Entered and Verified</span></div>
        <div class="tscroll"><table class="prep">
          <caption class="sr-only">Preparations with their equipment, Solutions and signatures</caption>
          <thead><tr><th scope="col">Preparation</th><th scope="col" class="n">Weight</th><th scope="col" class="n">Volume</th><th scope="col">Balance</th><th scope="col">Pipette</th><th scope="col">DI water</th><th scope="col">Diluent</th><th scope="col">Entered by</th><th scope="col">Verified by</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </section>`;
  }

  function runHTML() {
    const r = F.run; const inst = EQ(r.instrument);
    const sols = r.solutions.map((x) => `<tr><th scope="row" class="num">${esc(x.id)}</th><td>${esc(x.what)}</td><td class="num">${fmt.day(x.madeOn)}</td><td class="num">${fmt.day(x.expires)}</td><td>${fitTag(x.fitness, x.fitness === 'In use' ? `until ${fmt.day(x.expires)}` : x.reason)}</td></tr>`).join('');
    return `
      <section class="panel" aria-labelledby="run-h">
        <div class="panel__head"><h2 id="run-h" class="h-sec">Run <span class="num">${esc(r.id)}</span></h2><span class="panel__unit">Acquired ${fmt.stamp(r.acquiredFrom)} to ${fmt.hm(r.acquiredTo)} ${App.lib.ZONE}, ${r.injections} injections, ${r.testsInRun} Tests</span></div>
        <dl class="kv kv--run">
          <div><dt>Instrument</dt><dd><span class="num">${esc(inst.id)}</span> ${esc(inst.name)}${inst.software ? `, ${esc(inst.software)}` : ''}</dd><dd class="kv__fit">${fitTag(inst.fitness, inst.reason || `next Check due ${fmt.day(inst.nextDue)}`)}</dd></div>
          <div><dt>Column</dt><dd>Pack <span class="num">${esc(r.column.pack)}</span>, ${esc(r.column.material)}</dd><dd class="kv__fit">${fitTag(r.column.fitness, null)}</dd></div>
          <div><dt>Notebook Entry</dt><dd class="num">${esc(F.notebookEntry)}</dd></div>
        </dl>
        <div class="tscroll"><table class="sol">
          <caption class="sr-only">Solutions used in the Run with their Fitness Status</caption>
          <thead><tr><th scope="col">Solution</th><th scope="col">What it is</th><th scope="col">Made</th><th scope="col">Expires</th><th scope="col">Fitness Status</th></tr></thead>
          <tbody>${sols}</tbody>
        </table></div>
      </section>`;
  }

  /* ---------- the task column ---------- */
  function taskHTML() {
    const w = W(); const t = test();
    if (!isAssignee()) return `
      <section class="task">
        <h2 class="h-sec">${ic('lock')}Read only for you</h2>
        <p>${esc(person(t.assigneeId).name)} is assigned to <span class="num">${t.id}</span>. Only the assigned Analyst imports results and signs Performed.</p>
        <p class="sub">To work on it, ${esc(person(t.assigneeId).name)} uses Switch user in the rail.</p>
      </section>`;
    if (w.signed) return `
      <section class="task task--done">
        <h2 class="h-sec">${ic('check')}Signed Performed</h2>
        <p><span class="num">${t.id}</span> is <b>Submitted for Review</b>. The draft values are now your Results.</p>
        ${sigBlock(w.signed)}
        <p class="sub">If the record changes, this signature shows as unsigned. It can never be withdrawn.</p>
      </section>`;
    if (!w.imported) return uploadHTML();
    const step = stepNow();
    const f = w.flag;
    const handled = f.saved && !f.editing;
    const flagCard = handled ? `
      <div class="step__body">
        <p class="decided">${f.saved.choice === 'accept' ? `${ic('check')}<b>Accepted with a comment</b>` : `${ic('clock')}<b>Reinjection requested</b> for <span class="mono">${esc(FLAG.injection)}</span>`}</p>
        <blockquote class="quote">${esc(f.saved.comment)}</blockquote>
        <p class="sub">Saved by ${esc(person(f.saved.by).name)} at ${fmt.hm(f.saved.at)} ${App.lib.ZONE} as Record Version ${current().v}.</p>
        <button type="button" class="btn btn--quiet" data-act="flag-edit">Change the decision</button>
      </div>` : `
      <div class="step__body">
        <p class="flagdetail"><span class="mono">${esc(FLAG.injection)}</span>, Preparation ${FLAG.prep}, injection 2: Peak Ratio <b class="num">${FLAG.found}</b>, outside the window <span class="num">${FLAG.window[0]} to ${FLAG.window[1]}</span> (${esc(FLAG.detail.replace(/^Peak Ratio [\d.]+ vs /, ''))}).</p>
        <div class="opts" role="radiogroup" aria-label="How to handle the NDMA flag">
          <label class="opt${f.choice === 'accept' ? ' is-on' : ''}"><input type="radio" name="flag" value="accept" class="opt__input" data-act-change="flag-choice" data-fk="flag-accept"${f.choice === 'accept' ? ' checked' : ''}><span class="opt__dot" aria-hidden="true"></span><span class="opt__text"><b>Accept with a comment</b><span class="sub">The value stands. Your reason stays with the record.</span></span></label>
          <label class="opt${f.choice === 'reinject' ? ' is-on' : ''}"><input type="radio" name="flag" value="reinject" class="opt__input" data-act-change="flag-choice" data-fk="flag-reinject"${f.choice === 'reinject' ? ' checked' : ''}><span class="opt__dot" aria-hidden="true"></span><span class="opt__text"><b>Request a Reinjection</b><span class="sub">This draft cannot be signed until the new injection is imported.</span></span></label>
        </div>
        ${f.choice ? `<div class="field field--area"><label for="flag-comment">${f.choice === 'accept' ? 'Why the value can stand' : 'Reason for the Reinjection'} <span class="req">(required)</span></label><textarea id="flag-comment" data-fk="flag-comment" rows="3" aria-describedby="flag-hint">${esc(f.comment)}</textarea><p class="field__hint" id="flag-hint"><span id="flag-count" class="num">${f.comment.trim().length}</span> of at least ${MIN_COMMENT} characters. Saving makes a new Record Version.</p></div>` : ''}
      </div>`;
    const items = F.performedChecklist.map((txt, i) => {
      const lockedItem = i === 0 && !handled;
      return `<label class="check${w.checklist[i] ? ' is-on' : ''}${lockedItem ? ' is-blocked' : ''}"><input type="checkbox" class="check__input" data-act-change="checklist" data-arg="${i}" data-fk="chk-${i}"${w.checklist[i] ? ' checked' : ''}${lockedItem ? ' disabled aria-describedby="chk-0-why"' : ''}><span class="check__box" aria-hidden="true">${ic('tick')}</span><span class="check__text">${esc(txt)}${lockedItem ? `<span class="sub" id="chk-0-why">Decide the NDMA flag first.</span>` : ''}</span></label>`;
    }).join('');
    const stepCls = (n) => (step === n ? ' is-now' : step > n || (n === 1 && handled) ? ' is-done' : '');
    const left = (handled ? 0 : 1) + w.checklist.filter((x) => !x).length;
    return `
      <section class="task" aria-labelledby="task-h">
        <div class="task__head"><h2 id="task-h" class="h-sec">Before you sign Performed</h2><span class="task__left num">${step === 3 ? 'Ready to sign' : step === 0 ? 'Waiting' : `${left} left`}</span></div>
        <ol class="steps">
          <li class="step${stepCls(1)}${step === 0 ? ' is-wait' : ''}"><h3 class="step__h"><span class="step__n">1</span>${ic('flag')}Handle the NDMA flag</h3>${flagCard}</li>
          <li class="step${stepCls(2)}"><h3 class="step__h"><span class="step__n">2</span>Performed checklist</h3><div class="step__body checks">${items}</div></li>
          <li class="step${stepCls(3)}"><h3 class="step__h"><span class="step__n">3</span>${ic('sig')}Sign Performed in the rail</h3>${step === 3 ? `<div class="step__body"><p>You will sign Record Version ${current().v} (SHA-256 <span class="mono">${esc(current().sha.slice(0, 8))}</span>).</p></div>` : ''}</li>
        </ol>
      </section>`;
  }

  function uploadHTML() {
    const up = W().uploading; const im = F.import;
    const steps = [
      ['Uploaded 2 files', 'TXT and PDF'],
      ['SHA-256 of the TXT', up && up.hash ? `<span class="mono">${esc(up.hash.slice(0, 8))}</span>${up.hash === im.sha256 ? ', matches the export' : ''}` : ''],
      [`Parsed with <span class="mono">${esc(im.parser)}</span>`, `${im.rowsForThisTest} rows for ${F.testId}`],
      ['Cross-checked against the PDF', `${fmt.int(im.pdf.crossCheck.cellsCompared)} cells, ${im.pdf.crossCheck.mismatches} mismatches`],
    ];
    const prog = up ? `<ol class="prog" aria-live="polite">${steps.map(([a, b], i) => `<li class="${i < up.step ? 'is-done' : i === up.step ? 'is-now' : ''}">${i < up.step ? ic('check') : ic('todo')}<span>${a}${i < up.step && b ? `<span class="sub">${b}</span>` : ''}</span></li>`).join('')}</ol>` : '';
    return `
      <section class="task" aria-labelledby="up-h">
        <div class="task__head"><h2 id="up-h" class="h-sec">${ic('upload')}Import results</h2></div>
        <p>The TargetLynx export for <span class="num">${F.run.id}</span> is ready on the LCMS-02 export folder.</p>
        <ul class="files">
          <li>${ic('file')}<span><span class="mono">${esc(im.file)}</span><span class="sub">${fmt.int(im.bytes)} bytes, parsed into draft values</span></span></li>
          <li>${ic('file')}<span><span class="mono">${esc(im.pdf.file)}</span><span class="sub">attached and cross-checked cell by cell</span></span></li>
        </ul>
        ${prog}
        ${W().uploadError ? `<p class="form-error" role="alert">${ic('fail')}<span>${W().uploadError}</span></p>` : ''}
        <div class="drop" id="drop" data-drop="1"><p>${ic('upload')}At a desk, you can also drop the TXT and PDF here.</p></div>
        <p class="sub">Imported values stay drafts until you handle each flag and sign Performed.</p>
      </section>`;
  }

  /* ---------- rail ---------- */
  V.rail = () => {
    const w = W(); const t = test();
    if (!isAssignee()) return { context: `<span class="ctx__main">${esc(person(t.assigneeId).name)} is assigned to <span class="num">${t.id}</span></span><span class="ctx__sub">Read only. Only the assigned Analyst imports and signs.</span>`, actions: [] };
    if (w.signed) return { context: `<span class="ctx__main">${ic('sig')}Signed Performed at ${fmt.hm(w.signed.at)} ${App.lib.ZONE}</span><span class="ctx__sub"><span class="num">${t.id}</span> is Submitted for Review</span>`, actions: [{ act: 'ws-queue', label: 'Open the Lab queue', icon: 'next' }] };
    if (!w.imported) return { context: `<span class="ctx__main">No results yet</span><span class="ctx__sub">Import ${esc(F.run.id)} from LCMS-02</span>`, actions: [{ act: 'ws-upload', label: w.uploading ? 'Importing…' : 'Upload TargetLynx export', kind: 'primary', icon: 'upload', disabled: !!w.uploading, why: 'The import is running.', fk: 'ws-upload' }] };
    const v = current(); const step = stepNow();
    const id = `<span class="ctx__sub">Record Version ${v.v}, SHA-256 <span class="mono">${esc(v.sha.slice(0, 8))}</span>, draft</span>`;
    if (step === 1) {
      const f = w.flag; const ok = f.choice && f.comment.trim().length >= MIN_COMMENT;
      return { context: `<span class="ctx__main">Step 1 of 3: handle the NDMA flag</span>${id}`, actions: [{ act: 'flag-save', label: f.choice === 'reinject' ? 'Request Reinjection' : 'Save flag decision', kind: 'primary', icon: 'check', disabled: !ok, why: !f.choice ? 'Choose Accept with a comment or Request a Reinjection.' : `Write at least ${MIN_COMMENT} characters.`, fk: 'flag-save' }] };
    }
    if (step === 0) return { context: `<span class="ctx__main">Waiting for the Reinjection of <span class="mono">${esc(FLAG.injection)}</span></span>${id}`, actions: [{ act: 'ws-sign', label: 'Sign Performed…', kind: 'primary', icon: 'sig', disabled: true, why: 'This draft cannot be signed until the Reinjection is imported.' }] };
    if (step === 2) { const n = w.checklist.filter((x) => !x).length; return { context: `<span class="ctx__main">Step 2 of 3: the Performed checklist</span>${id}`, actions: [{ act: 'ws-sign', label: 'Sign Performed…', kind: 'primary', icon: 'sig', disabled: true, why: `Tick the ${plural(n, 'remaining checklist item')} first.`, fk: 'ws-sign' }] }; }
    return { context: `<span class="ctx__main">Step 3 of 3: sign Performed</span>${id}`, actions: [{ act: 'ws-sign', label: 'Sign Performed…', kind: 'primary', icon: 'sig', fk: 'ws-sign' }] };
  };
  V.onEscape = () => false;

  /* ---------- the signature: what exactly is signed ---------- */
  function signSpec(instant) {
    const v = current(); const w = W();
    const reps = F.results.map((r) => `<li><span class="an">${esc(r.analyte)}</span><span class="v draft ${r.reportablePpm != null ? 'num' : 'word'}">${r.reportablePpm != null ? `${r.reportablePpm} ppm` : esc(r.reportableDisplay)}</span></li>`).join('');
    return {
      instant, meaning: 'Performed', role: 'Analyst', title: `Sign the results of ${F.testId} as Performed`,
      record: `Results of Test ${F.testId}`, version: v.v, sha256: v.sha,
      contents: `
        <p class="manifest__lede">${esc(DB.products[test().productId].name)}, lot ${esc(DB.samples[test().sampleId].lot)}. ${F.results.length} analytes from ${F.preparations.length} Preparations, ${F.injections.length} injections of <span class="num">${esc(F.run.id)}</span>.</p>
        <ul class="replist" aria-label="Reportable Results being signed">${reps}</ul>
        <p class="manifest__line">${ic('flag')}<span>NDMA flag on <span class="mono">${esc(FLAG.injection)}</span>: accepted with your comment.</span></p>
        <p class="manifest__line">${ic('file')}<span>Source <span class="mono">${esc(F.import.file)}</span>, SHA-256 <span class="mono">${esc(F.import.sha256.slice(0, 8))}</span>, PDF cross-checked.</span></p>
        <p class="manifest__line">${ic('check')}<span>Performed checklist: all ${w.checklist.length} items confirmed.</span></p>`,
      effects: `<ul class="effects__list"><li>These draft values become your Results.</li><li><span class="num">${F.testId}</span> moves to Submitted for Review.</li><li>If Record Version ${v.v} changes after you sign, the signature shows as unsigned. It can never be withdrawn.</li></ul>`,
      onSigned: (sig) => {
        const t = test();
        w.signed = sig; w.inkIn = true;
        t.state = 'Submitted for Review'; t.history.push({ state: 'Submitted for Review', at: sig.at, by: S.userId }); delete t._s;
        audit(`${t.id} moved to Submitted for Review`);
        S.route = 'imported'; history.replaceState(null, '', '#imported');
        App.show();
        receipt({ title: `Signed Performed on ${t.id}`, body: `Record Version ${sig.version}, SHA-256 <span class="mono">${esc(sig.sha256.slice(0, 8))}</span>. ${esc(t.id)} is Submitted for Review.`, icon: 'sig', tone: 'sig' });
        const task = $('#ws-task'); if (task) task.scrollTop = 0;
      },
      onCancel: () => { S.route = 'imported'; history.replaceState(null, '', '#imported'); App.renderTop(); App.renderRail(); },
    };
  }

  /* ---------- actions ---------- */
  App.act['ws-upload'] = () => runUpload();
  App.act['ws-queue'] = () => App.go('queue');
  App.act['ws-sign'] = () => {
    if (!readyToSign()) return;
    S.route = 'sign'; history.replaceState(null, '', '#sign');
    App.renderTop();
    App.openSign(signSpec(false));
  };
  App.act['flag-save'] = () => {
    const f = W().flag;
    if (!f.choice || f.comment.trim().length < MIN_COMMENT) return;
    f.saved = { choice: f.choice, comment: f.comment.trim(), at: now().toISOString(), by: S.userId };
    f.editing = false;
    addVersion(f.choice === 'accept' ? 'NDMA flag accepted with comment' : `Reinjection of ${FLAG.injection} requested`);
    if (f.choice !== 'accept') W().checklist[0] = false;
    App.keepState(() => { $('#ws-doc').innerHTML = docHTML(); $('#ws-task').innerHTML = taskHTML(); });
    App.renderRail();
    receipt({ title: f.choice === 'accept' ? 'NDMA flag accepted with your comment' : `Reinjection of ${FLAG.injection} requested`, body: `Saved as Record Version ${current().v}. Recorded in the audit trail.` });
    const next = $('#chk-0') || $('[data-fk="chk-0"]'); if (next && !next.disabled) next.focus({ preventScroll: false });
  };
  App.act['flag-edit'] = () => { const f = W().flag; f.editing = true; f.choice = f.saved.choice; f.comment = f.saved.comment; W().checklist[0] = false; renderTask(); App.renderRail(); const c = $('#flag-comment'); if (c) c.focus(); };

  document.addEventListener('change', (e) => {
    const k = e.target.dataset.actChange;
    if (k === 'flag-choice') { W().flag.choice = e.target.value; renderTask(); App.renderRail(); const c = $('#flag-comment'); if (c && !W().flag.comment) c.focus(); }
    if (k === 'checklist') {
      W().checklist[+e.target.dataset.arg] = e.target.checked; renderTask(); App.renderRail();
      if (stepNow() === 3) { const now3 = $('#ws-task .step.is-now'); if (now3) now3.scrollIntoView({ block: 'nearest' }); }
    }
  });
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'flag-comment') return;
    W().flag.comment = e.target.value;
    const n = $('#flag-count'); if (n) n.textContent = e.target.value.trim().length;
    App.renderRail();
  });

  /* the simulated upload: hash the real fixture in the browser, then take the server's parse from the data */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function runUpload(bytes) {
    const w = W(); if (w.uploading || w.imported) return;
    w.uploading = { step: 0, hash: null }; w.uploadError = null;
    renderTask(); App.renderRail();
    let hash = F.import.sha256;
    try {
      if (!bytes) { const res = await fetch(`../../${F.import.fixturePath}`, { cache: 'no-store' }); if (res.ok) bytes = new Uint8Array(await res.arrayBuffer()); }
      if (bytes) hash = sha256Bytes(bytes);
    } catch (err) { /* offline or file:// — fall back to the server's hash */ }
    await wait(320); w.uploading.step = 1; renderTask();
    w.uploading.hash = hash;
    if (hash !== F.import.sha256) {
      w.uploading = null;
      w.uploadError = `That file's SHA-256 (<span class="mono">${esc(hash.slice(0, 8))}</span>) is not the export of ${esc(F.run.id)}. Nothing was imported.`;
      renderTask(); App.renderRail();
      return;
    }
    await wait(320); w.uploading.step = 2; renderTask();
    await wait(320); w.uploading.step = 3; renderTask();
    await wait(320); w.uploading.step = 4; renderTask();
    await wait(260);
    if (S.route !== 'test' || S.userId !== test().assigneeId) { w.uploading = null; importNow(); return; }
    importNow();
    S.route = 'imported'; history.replaceState(null, '', '#imported');
    App.show();
    receipt({ title: 'Imported as drafts', body: `${F.import.rowsForThisTest} rows for ${F.testId}. 1 flag to handle before you can sign.`, icon: 'pencil', tone: 'draft' });
  }
  /* drag and drop at a desk: the dropped TXT must hash to the export's SHA-256 */
  document.addEventListener('dragover', (e) => { const d = e.target.closest && e.target.closest('[data-drop]'); if (d) { e.preventDefault(); d.classList.add('is-over'); } });
  document.addEventListener('dragleave', (e) => { const d = e.target.closest && e.target.closest('[data-drop]'); if (d) d.classList.remove('is-over'); });
  document.addEventListener('drop', (e) => {
    const d = e.target.closest && e.target.closest('[data-drop]'); if (!d) return;
    e.preventDefault(); d.classList.remove('is-over');
    const txt = Array.from(e.dataTransfer.files || []).find((f) => /\.txt$/i.test(f.name));
    if (!txt) { receipt({ title: 'Drop the TXT export', body: 'The PDF is attached alongside; the TXT is what gets parsed.', tone: 'warn', icon: 'file' }); return; }
    txt.arrayBuffer().then((buf) => runUpload(new Uint8Array(buf)));
  });
})();

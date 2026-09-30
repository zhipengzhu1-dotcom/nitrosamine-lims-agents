'use strict';
/* Ledger & Rail · state, routes and events. One state object S; the render functions only read it. */

const ROUTES = {
  queue: { persona: 'queue', screen: 'queue' },
  assign: { persona: 'queue', screen: 'queue' },
  test: { persona: 'test', screen: 'bench' },
  imported: { persona: 'test', screen: 'bench' },
  sign: { persona: 'test', screen: 'bench' },
  checks: { persona: 'checks', screen: 'checks' },
  'check-fail': { persona: 'checks', screen: 'checks' },
};
const freshQueue = () => ({ search: '', method: '', customer: '', gxp: '', states: [], assignee: '', holds: false, devs: false, overdue: false, atRisk: false, sort: 'urgency', selected: null });
const freshBench = () => ({ imported: false, importedAt: null, importedBy: null, fileHashChecked: false, flag: null, composing: false, draftComment: '', integrations: null, integrationsText: '', injectionsMatch: false, signature: null });
const importedBench = () => ({ ...freshBench(), imported: true, importedAt: Date.parse(FOCUS.import.uploadedAt), importedBy: FOCUS.import.uploadedBy });
/* The #sign deep link needs the gates closed; this is the decision Priya saved a few minutes earlier. */
const CANNED_FLAG = () => ({ decision: 'accept', by: FOCUS.import.uploadedBy, at: T0 - 9 * 60e3, comment: 'Ion ratio low on 1 of 4 NDMA injections (R260929_014). RT 2.41 min and peak shape match the standards, and the other 3 injections are inside the window. The value stands.' });

const S = {
  route: 'queue', userId: null, lock: null, failures: {}, lockedAccounts: {},
  q: freshQueue(), qRows: [], flash: null,
  testMods: {}, bench: freshBench(), checkState: {}, equipMods: {}, devsAdded: [], alarmAck: null,
  sheet: null, toasts: [],
};
let idleDeadline = Date.now() + IDLE_MS;
let devSeq = 94;
const FOCUS_ASSIGNEE = TESTS[FOCUS.testId].assigneeId;

/* ======================= routes ======================= */
const parseRoute = () => { const r = decodeURIComponent(location.hash.replace(/^#/, '')); return ROUTES[r] ? r : 'queue'; };
const homeRoute = (id) => (id === FOCUS_ASSIGNEE ? (S.bench.imported ? 'imported' : 'test') : PEOPLE[id].roles.includes('Lab Manager') ? 'queue' : 'checks');
function checkFailSheet() {
  const cf = L.focus.checkFail; const c = CHECKS[cf.checkId];
  return { type: 'balance', checkId: cf.checkId, readings: cf.typed.readingsMg.map((mg) => (balUnit(c.target) === 'g' ? mgToG(mg) : String(mg))), retype: [], wCommitted: [], focusRetype: true };
}
/* Full preset: what a fresh load of each deep link shows. */
function applyPreset(route) {
  S.sheet = null;
  if (route === 'queue') S.q = freshQueue();
  if (route === 'assign') { S.q = freshQueue(); S.q.selected = L.focus.assignTestId; S.sheet = { type: 'assign', testId: L.focus.assignTestId, choice: null }; }
  if (route === 'test') S.bench = freshBench();
  if (route === 'imported') S.bench = importedBench();
  if (route === 'sign') { S.bench = { ...importedBench(), flag: CANNED_FLAG(), integrations: 'none', injectionsMatch: true }; S.sheet = { type: 'sign', ctx: signCtxForTest(), error: null }; }
  if (route === 'check-fail') S.sheet = checkFailSheet();
}
/* Same person, different hash (back/forward or an edited address): keep their work, show the route's state. */
function softPreset(route) {
  S.sheet = null;
  if (route === 'assign') { S.q.selected = L.focus.assignTestId; S.sheet = { type: 'assign', testId: L.focus.assignTestId, choice: null }; }
  if (route === 'test') S.bench = freshBench();
  if ((route === 'imported' || route === 'sign') && !S.bench.imported) S.bench = importedBench();
  if (route === 'sign') {
    if (S.bench.signature) { S.route = 'imported'; history.replaceState(null, '', '#imported'); return; }
    if (!benchGates().ready) Object.assign(S.bench, { flag: CANNED_FLAG(), composing: false, integrations: 'none', injectionsMatch: true });
    S.sheet = { type: 'sign', ctx: signCtxForTest(), error: null };
  }
  if (route === 'check-fail') S.sheet = checkFailSheet();
}
function go(route) { S.route = route; history.pushState(null, '', `#${route}`); render(); $('#main').scrollTop = 0; }
function boot() {
  const route = parseRoute();
  S.route = route;
  S.userId = L.personas[ROUTES[route].persona];
  applyPreset(route);
  if (!location.hash) history.replaceState(null, '', '#queue');
  render();
  mountSheet();
  if (route === 'assign') scrollRowIntoView(S.q.selected);
}
window.addEventListener('hashchange', () => {
  const route = parseRoute();
  const persona = L.personas[ROUTES[route].persona];
  const prev = S.userId;
  S.lock = null;
  S.route = route;
  if (persona !== prev) { S.userId = persona; applyPreset(route); } else softPreset(route);
  bumpIdle();
  render();
  mountSheet();
  if (persona !== prev && prev) toast('info', `${PEOPLE[persona].name} signed in on this PC`, `${PEOPLE[prev].name}'s session ended. Unsigned work stays saved under ${firstName(PEOPLE[prev])}'s name.`);
});

/* ======================= rendering ======================= */
function keepFocus(root, fn) {
  const a = document.activeElement;
  const key = a && root.contains(a) ? a.getAttribute('data-k') || (a.id ? `#${a.id}` : null) : null;
  fn();
  if (!key) return;
  const el = key.startsWith('#') ? root.querySelector(`[id="${key.slice(1)}"]`) : root.querySelector(`[data-k="${CSS.escape(key)}"]`);
  if (el && !el.disabled) el.focus({ preventScroll: true });
}
function keepScroll(sel, fn) {
  const before = $$(sel).map((el) => [el.id || el.className, el.scrollTop]);
  fn();
  $$(sel).forEach((el, i) => { if (before[i] && before[i][0] === (el.id || el.className)) el.scrollTop = before[i][1]; });
}
function render() { renderTopbar(); renderMain(); renderRail(); renderSheet(); renderLock(); setInert(); tickIdle(); }
function renderTopbar() {
  const u = currentUser();
  const scr = ROUTES[S.route].screen;
  const tabs = [];
  if (u.roles.includes('Lab Manager')) tabs.push(['queue', 'Lab queue', 'queue']);
  if (u.id === FOCUS_ASSIGNEE) tabs.push([S.bench.imported ? 'imported' : 'test', `Bench · ${FOCUS.testId}`, 'bench']);
  tabs.push(['checks', "Today's Checks", 'checks']);
  const bar = $('#topbar');
  keepFocus(bar, () => {
    bar.innerHTML = String(h`<div class="brand"><span class="logo" aria-hidden="true">N–N=O</span><span class="brand-name">Nitrosamine LIMS</span><span class="brand-lab">${L.lab.name} · ${L.lab.id}</span></div>
      <nav class="tabs" aria-label="Screens">${tabs.map(([r, label, s]) => h`<a class="tab" href="#${r}" data-act="nav" data-arg="${r}" data-k="tab-${s}"${s === scr ? raw(' aria-current="page"') : ''}>${label}</a>`)}</nav>
      <div class="topbar-right"><span class="pc">${icon('pc')}${WORKSTATION}</span><span class="clock mono" id="clock">${fmtClock(nowMs())}</span><span class="fictional" title="${L.meta.note}">${icon('info')}Fictional data</span></div>`);
  });
}
function renderMain() {
  const scr = ROUTES[S.route].screen;
  const main = $('#main');
  main.dataset.screen = scr;
  keepScroll('#main, #q-wrap', () => keepFocus(main, () => {
    main.innerHTML = String(scr === 'queue' ? queueScreen() : scr === 'bench' ? workspaceScreen() : checksScreen());
  }));
}
function renderRail() {
  const scr = ROUTES[S.route].screen;
  const spec = scr === 'queue' ? queueRail() : scr === 'bench' ? benchRail() : checksRail();
  const rail = $('#rail');
  keepFocus(rail, () => { rail.innerHTML = String(railInner(spec)); });
  tickIdle();
}
function benchRail() {
  const b = S.bench; const g = benchGates();
  if (!b.imported) return { context: h`<span class="ctx-line">Next: upload the TargetLynx export for <b class="mono">${FOCUS.run.id}</b>.</span><span class="ctx-line">Preparations Verified · Run acquired · no open Holds.</span>`, actions: [rbtn({ act: 'upload-open', label: 'Upload TargetLynx export', ic: 'upload', kind: 'primary', k: 'rail-upload' })] };
  if (b.signature) return { context: h`<span class="ctx-line">${icon('check')} Signed Performed at <b>${fmtTime(b.signature.at)} ${ZONE}</b>. <b class="mono">${FOCUS.testId}</b> is Submitted for Review.</span><span class="ctx-line">A Reviewer signs Reviewed next.</span>`, actions: [] };
  const chip = (ok, label) => h`<span class="gate-chip${ok ? ' ok' : ''}">${icon(ok ? 'check' : 'ring')}${label}</span>`;
  return {
    context: h`<span class="ctx-line gates-line">${chip(g.flagOk, g.reinject ? 'Reinjection pending' : 'NDMA flag')}${chip(g.integOk, 'Manual integrations')}${chip(g.matchOk, 'Injections match')}</span><span class="ctx-line">${g.ready ? 'All three done. Signing opens the Electronic Signature prompt.' : g.reinject ? 'Signing waits for the Reinjection.' : 'Sign Performed unlocks when all three are done.'}</span>`,
    actions: [rbtn({ act: 'sign-open', label: 'Sign Performed…', ic: 'nib', kind: 'primary', disabled: !g.ready, k: 'rail-sign', title: g.ready ? '' : 'Handle the flag and the checklist first' })],
  };
}
const isEntryCheck = (c) => c.type === 'Reading' || (c.type === 'Verification' && /^BAL/.test(c.target));
function checksRail() {
  const due = L.checksToday.map(checkNow).filter((c) => c.status === 'Due' && isEntryCheck(c));
  const next = due[0];
  return {
    context: h`<span class="ctx-line"><b>${due.length}</b> Checks left to enter today${next ? h` · next: <b class="mono">${next.target}</b> ${checkName(next)}` : ''}.</span><span class="ctx-line">Tap a tile to enter it. Readings save without a signature; balance verifications are signed Performed.</span>`,
    actions: next ? [rbtn({ act: 'open-check', arg: next.id, label: `Enter ${next.target}`, sub: checkName(next), ic: 'arrow', kind: 'primary', k: 'rail-next' })] : [],
  };
}

/* ----- sheets ----- */
const SHEETS = { assign: assignSheet, details: detailsSheet, upload: uploadSheet, sign: signSheet, reading: readingSheet, balance: balanceSheet, info: checkInfoSheet, alarm: alarmSheet };
let renderedSheet = null;
let sheetReturn = null;
function renderSheet(force = false) {
  const layer = $('#layer-sheet');
  if (!S.sheet) { if (renderedSheet) { layer.innerHTML = ''; renderedSheet = null; } return; }
  if (!force && renderedSheet === S.sheet) return;
  keepScroll('.sheet-body', () => keepFocus(layer, () => { layer.innerHTML = String(SHEETS[S.sheet.type](S.sheet)); }));
  renderedSheet = S.sheet;
  if (S.sheet.type === 'reading' || S.sheet.type === 'balance') updateEntry();
  if (S.sheet.type === 'sign') updateSignButton();
}
function mountSheet() {
  if (!S.sheet || S.lock) return;
  const sh = S.sheet; const layer = $('#layer-sheet');
  let el = null;
  if (sh.type === 'sign') el = $('#sg-user');
  else if (sh.type === 'reading') el = numFields(CHECKS[sh.checkId]).map((f) => $(`#f-${f}`)).find((i) => !i.value) || $('.fcard input');
  else if (sh.type === 'balance') el = sh.focusRetype ? $$('.retype:not([hidden]) input')[0] || $('#w-0') : $$('[data-weight]').find((i) => !i.value) || $('#w-0');
  else if (sh.type === 'assign') el = $('.pick[aria-checked="true"]') || $('#sheet-title');
  else if (sh.type === 'alarm') el = $('#ack-text');
  else if (sh.type === 'upload') el = layer.querySelector('[data-act="upload-start"]');
  else el = layer.querySelector('.sheet-foot [data-act="sheet-cancel"]');
  if (el) { el.focus({ preventScroll: true }); if (el.classList.contains('num')) markActive(el); }
}
function openSheet(sheet, route) {
  if (S.toasts.length) { S.toasts = []; renderToasts(); }
  sheetReturn = document.activeElement;
  S.sheet = sheet;
  if (route) { S.route = route; history.pushState(null, '', `#${route}`); }
  renderSheet(true); setInert(); mountSheet();
}
function closeSheet(route) {
  S.sheet = null; renderSheet(); setInert();
  if (route && route !== S.route) { S.route = route; history.pushState(null, '', `#${route}`); }
  if (sheetReturn && document.contains(sheetReturn) && !sheetReturn.closest('[inert]')) sheetReturn.focus({ preventScroll: true });
}
function cancelSheet() {
  const sh = S.sheet;
  if (!sh) return;
  if (sh.type === 'sign' && sh.ctx.back) { S.sheet = sh.ctx.back; renderSheet(true); setInert(); mountSheet(); return; }
  const back = { assign: 'queue', sign: 'imported', balance: S.route === 'check-fail' ? 'checks' : null }[sh.type] || null;
  closeSheet(back);
}
function setInert() {
  const modal = !!S.sheet || !!S.lock;
  $('#app').inert = modal;
  $('#layer-sheet').inert = !!S.lock;
  document.body.classList.toggle('has-sheet', !!S.sheet && !S.lock);
}

/* ----- lock screen ----- */
function renderLock() {
  const layer = $('#layer-lock');
  if (!S.lock) { layer.innerHTML = ''; return; }
  keepFocus(layer, () => { layer.innerHTML = String(lockScreen()); });
}
function focusLock() {
  const lk = S.lock; if (!lk) return;
  const el = lk.mode === 'locked' ? $('#si-pass') : lk.mode === 'switch' ? (lk.picked == null ? $('.user-tile') : lk.picked === '' ? $('#si-user') : $('#si-pass')) : $('.lock [data-act="lock-switch"]');
  if (el) el.focus();
}
function lockPC(reason) {
  if (S.lock || !S.userId) return;
  $$('#layer-sheet input[type=password], #layer-sheet .code').forEach((i) => { i.value = ''; });
  S.lock = { mode: 'locked', reason, userId: S.userId, sessionUserId: S.userId, at: nowMs(), picked: null, error: null };
  renderLock(); setInert(); focusLock();
}
/* userId is the account shown as locked; sessionUserId is whoever's session is open on this PC. */
function lockout(username) {
  const p = BY_USERNAME[username];
  S.lockedAccounts[username] = nowMs();
  if (p.id === S.userId && S.sheet && S.sheet.type === 'sign') { S.sheet = S.sheet.ctx.back || null; renderSheet(true); }
  S.lock = { mode: 'lockout', reason: 'failures', userId: p.id, sessionUserId: S.lock ? S.lock.sessionUserId : S.userId, at: nowMs(), picked: null, error: null };
  renderLock(); setInert(); focusLock();
}
function checkCredentials(username, pass, code) {
  const cred = L.demoCredentials.users[username];
  return !!cred && pass === cred.password && code === cred.totp;
}
function failAttempt(username, title) {
  const n = (S.failures[username] || 0) + 1;
  S.failures[username] = n;
  const left = MAX_FAILURES - n;
  if (left <= 0) return null;
  return { title, body: `${left} ${left === 1 ? 'attempt' : 'attempts'} left before ${username} is locked.` };
}
function submitSignin(form, kind) {
  const username = form.user.value.trim(); const pass = form.pass.value; const code = form.code.value.trim();
  const clear = () => { form.pass.value = ''; form.code.value = ''; };
  if (!username || !pass || code.length !== 6) { S.lock.error = { title: 'Enter your user ID, password and the 6-digit code.', body: '' }; renderLock(); focusLock(); return; }
  if (S.lockedAccounts[username]) { S.lock.error = { title: `${username} is locked.`, body: 'An Admin must unlock it.' }; clear(); renderLock(); return; }
  if (!BY_USERNAME[username] || !L.demoCredentials.users[username]) { S.lock.error = { title: 'Sign-in refused: the user ID, password or code is wrong.', body: '' }; clear(); renderLock(); focusLock(); return; }
  if (!checkCredentials(username, pass, code)) {
    const err = failAttempt(username, 'Sign-in refused: the password or the code is wrong.');
    if (!err) { lockout(username); return; }
    S.lock.error = err; clear(); renderLock(); focusLock(); return;
  }
  S.failures[username] = 0;
  const who = BY_USERNAME[username];
  const prev = S.lock.sessionUserId;
  S.lock = null;
  bumpIdle();
  if (kind === 'unlock' || who.id === prev) { render(); mountSheet(); toast('ok', `Unlocked · ${who.name}`, 'Welcome back. Nothing changed while the PC was locked.'); return; }
  S.userId = who.id;
  S.sheet = null;
  S.route = homeRoute(who.id);
  history.pushState(null, '', `#${S.route}`);
  render();
  $('#main').scrollTop = 0;
  $('#main').focus({ preventScroll: true });
  toast('info', `${who.name} signed in on this PC`, prev ? `${PEOPLE[prev].name}'s session ended. Unsigned work stays saved under ${firstName(PEOPLE[prev])}'s name; nothing was signed for ${firstName(PEOPLE[prev])}.` : '');
}

/* ----- idle lock ----- */
function idleText() {
  const left = Math.max(0, idleDeadline - Date.now());
  return left > 60e3 ? `auto-locks in ${Math.ceil(left / 60e3)} min idle` : `locking in ${Math.ceil(left / 1000)} s`;
}
function bumpIdle() { if (!S.lock) idleDeadline = Date.now() + IDLE_MS; }
function tickIdle() {
  const clock = $('#clock'); if (clock) clock.textContent = fmtClock(nowMs());
  const lc = $('.lock .clock'); if (lc) lc.textContent = fmtClock(nowMs());
  if (S.lock || !S.userId) return;
  const left = idleDeadline - Date.now();
  if (left <= 0) { lockPC('idle'); return; }
  const frac = left / IDLE_MS;
  $$('.ring-left').forEach((c) => { c.style.strokeDashoffset = String(100 - frac * 100); });
  const txt = idleText();
  $$('.idle-text').forEach((e) => { if (e.textContent !== txt) e.textContent = txt; });
  document.body.classList.toggle('idle-warn', left <= 60e3);
}
['pointerdown', 'keydown', 'wheel', 'touchstart', 'input'].forEach((ev) => addEventListener(ev, bumpIdle, { capture: true, passive: true }));
setInterval(tickIdle, 1000);

/* ======================= queue behaviour ======================= */
let searchTimer = 0;
function queueRefresh() {
  if (ROUTES[S.route].screen !== 'queue') return;
  const { all, rows, perState, totals } = queueModel();
  S.qRows = rows.map((t) => t.id);
  const pipe = $('#q-pipeline'); keepFocus(pipe, () => { pipe.innerHTML = String(h`${pipeline(perState, S.q)}`); });
  const wl = $('#q-workload'); keepFocus(wl, () => { wl.innerHTML = String(workloadBand(all, S.q, totals)); });
  const wrap = $('#q-wrap'); keepFocus(wrap, () => { wrap.innerHTML = String(queueTable(rows)); });
  wrap.scrollTop = 0;
  $$('.filters [data-act="q-chip"]').forEach((b) => b.setAttribute('aria-pressed', tf(S.q[b.dataset.arg])));
  $$('.filters [data-act="q-gxp"]').forEach((b) => b.setAttribute('aria-pressed', tf(S.q.gxp === b.dataset.arg)));
  $('.filters .clear').disabled = !anyFilter(S.q);
  if (S.q.selected && !S.qRows.includes(S.q.selected)) S.q.selected = null;
  renderRail();
}
function selectRow(id, focus = true) {
  S.q.selected = id;
  $$('#q-body tr.row').forEach((tr) => { const on = tr.dataset.id === id; tr.setAttribute('aria-selected', tf(on)); tr.tabIndex = on ? 0 : -1; });
  const tr = $(`#q-body tr[data-id="${CSS.escape(id)}"]`);
  if (tr && focus) tr.focus({ preventScroll: true });
  if (tr) tr.scrollIntoView({ block: 'nearest' });
  renderRail();
}
function scrollRowIntoView(id) { const tr = id && $(`#q-body tr[data-id="${CSS.escape(id)}"]`); if (tr) tr.scrollIntoView({ block: 'start' }); }
function openAssign(testId) { S.q.selected = testId; openSheet({ type: 'assign', testId, choice: null }, 'assign'); }
function confirmAssign() {
  const sh = S.sheet; const t = testNow(TESTS[sh.testId]); const who = PEOPLE[sh.choice]; const at = nowMs();
  const elig = eligibilityFor(t).find((e) => e.id === sh.choice);
  if (!elig || elig.reasons.length) return; /* refused: the button cannot be reached, and the rule holds here too */
  S.testMods[t.id] = { state: 'Assigned', assigneeId: who.id, historyAdd: [{ state: 'Assigned', at: iso(at), by: S.userId }] };
  S.flash = t.id;
  closeSheet('queue');
  renderMain(); renderRail();
  selectRow(t.id);
  setTimeout(() => { S.flash = null; }, 1600);
  toast('audit', `${t.id} assigned to ${who.name}`, `Moved to Assigned. Recorded in the Audit Trail: ${currentUser().name} (${currentUser().username}, Lab Manager), ${fmtLocalFull(at)} · ${fmtUtcTime(at, true)}. Audited, not signed.`);
}

/* ======================= bench behaviour ======================= */
function renderBench() { renderMain(); renderRail(); renderTopbar(); }
function startUpload() {
  const sh = S.sheet; const imp = FOCUS.import;
  sh.phase = 'running'; sh.step = 0; renderSheet(true);
  fetch(`../../${imp.fixturePath}`).then((r) => (r.ok ? r.arrayBuffer() : null)).then((buf) => {
    if (!buf) return;
    sh.hash = sha256(new Uint8Array(buf));
    S.bench.fileHashChecked = sh.hash === imp.sha256;
    if (S.sheet === sh) renderSheet(true);
  }).catch(() => {});
  const advance = () => {
    if (S.sheet !== sh) return;
    sh.step++; renderSheet(true);
    if (sh.step < 5) setTimeout(advance, 360); else setTimeout(finishUpload, 420);
  };
  setTimeout(advance, 360);
}
function finishUpload() {
  if (!S.sheet || S.sheet.type !== 'upload') return;
  Object.assign(S.bench, { imported: true, importedAt: nowMs(), importedBy: S.userId });
  closeSheet('imported');
  renderBench();
  $('#main').scrollTop = 0;
  toast('ok', `${FOCUS.import.rowsForThisTest} draft rows imported for ${FOCUS.testId}`, 'Drafts are not Results yet. Handle the NDMA flag and the checklist, then sign Performed.');
}
function updateGateUI() {
  const g = benchGates();
  const lis = $$('.gates .gate');
  [g.flagHandled, g.integOk, g.matchOk].forEach((ok, i) => { if (lis[i]) { lis[i].classList.toggle('done', ok); lis[i].querySelector('.gate-box').innerHTML = ok ? String(icon('check')) : ''; } });
  renderRail();
}

/* ======================= signing ======================= */
function updateSignButton() {
  const f = $('#sign-form'); const btn = $('.sign-btn');
  if (!f || !btn) return;
  btn.disabled = !(f.user.value.trim() && f.pass.value && /^\d{6}$/.test(f.code.value.trim()));
}
function submitSignature(form) {
  const sh = S.sheet; const u = currentUser();
  const user = form.user.value.trim(); const pass = form.pass.value; const code = form.code.value.trim();
  if (!user || !pass || !/^\d{6}$/.test(code)) return;
  let title = null;
  if (user !== u.username) title = `Not signed: ${user} is not the person signed in on this PC. Only ${u.name} (${u.username}) can sign here; anyone else must lock the PC and sign in first.`;
  else if (!checkCredentials(u.username, pass, code)) title = 'Not signed: the password or the code is wrong.';
  if (title) {
    const err = failAttempt(u.username, title);
    if (!err) { lockout(u.username); return; }
    sh.error = err;
    $('#sign-error').innerHTML = String(errorBox(err));
    form.pass.value = ''; form.code.value = '';
    updateSignButton();
    (user !== u.username ? form.user : form.pass).focus();
    return;
  }
  S.failures[u.username] = 0;
  const sig = { meaning: sh.ctx.meaning, name: u.name, username: u.username, role: roleOf(u), at: nowMs(), recordId: sh.ctx.recordId, recordVersion: sh.ctx.recordVersion, sha: sh.ctx.sha };
  if (sh.ctx.onSigned === 'bench') signedBench(sig); else signedBalance(sh.ctx, sig);
}
function signedBench(sig) {
  S.bench.signature = sig;
  S.testMods[FOCUS.testId] = { state: 'Submitted for Review', historyAdd: [{ state: 'Submitted for Review', at: iso(sig.at), by: S.userId }] };
  closeSheet('imported');
  renderBench();
  $('#main').scrollTop = 0;
  toast('ok', `Signed Performed · ${FOCUS.testId} is Submitted for Review`, `Record Version ${sig.recordVersion} · SHA-256 ${sig.sha.slice(0, 8)} · ${fmtUtcFull(sig.at)}. The drafts are now your Results.`);
}
function openDeviation(kind, risk, title) {
  const id = `DEV-26-${String(devSeq++).padStart(4, '0')}`;
  S.devsAdded.push({ id, kind, risk, state: 'Open', title, openedAt: iso(nowMs()), investigatorId: S.userId, dueDate: addDays(LAB_DAY, 28) });
  return id;
}

/* ======================= checks behaviour ======================= */
function openCheck(id) {
  const c = checkNow(CHECKS[id]);
  if (c.status === 'Due' && c.type === 'Reading') return openSheet({ type: 'reading', checkId: id, values: {}, retype: {}, committed: {}, reset: null });
  if (c.status === 'Due' && /^BAL/.test(c.target)) return openSheet({ type: 'balance', checkId: id, readings: [], retype: [], wCommitted: [] });
  return openSheet({ type: 'info', checkId: id });
}
let activeNum = null;
function markActive(input) {
  activeNum = input;
  $$('#layer-sheet .fcard, #layer-sheet .weigh tr, #layer-sheet .retype, #layer-sheet .fld, #layer-lock .fld').forEach((el) => el.classList.remove('active'));
  const host = input.closest('.retype') || input.closest('.fcard') || input.closest('.weigh tr') || input.closest('.fld');
  if (host) host.classList.add('active');
}
function keypadPress(key, pad) {
  /* A code pad always types into its code field; an entry pad types into the highlighted numeric field. */
  const fixed = pad && pad.dataset.for ? document.getElementById(pad.dataset.for) : null;
  const inp = fixed || (activeNum && document.contains(activeNum) && activeNum.classList.contains('num') ? activeNum : null);
  if (!inp) return;
  const v = inp.value; const s = inp.selectionStart ?? v.length; const e = inp.selectionEnd ?? v.length;
  let nv = v; let caret = s;
  if (key === 'next') { focusNextNum(inp); return; }
  if (key === 'back') { if (s !== e) nv = v.slice(0, s) + v.slice(e); else if (s > 0) { nv = v.slice(0, s - 1) + v.slice(e); caret = s - 1; } }
  else if (key === 'clear') { nv = ''; caret = 0; }
  else if (key === 'sign') { nv = /^[-−]/.test(v) ? v.slice(1) : `−${v}`; caret = nv.length; }
  else {
    if (key === '.' && v.includes('.')) return;
    const max = inp.maxLength > 0 ? inp.maxLength : 12;
    if (v.length - (e - s) >= max) return;
    nv = v.slice(0, s) + key + v.slice(e); caret = s + key.length;
  }
  inp.value = nv;
  inp.focus({ preventScroll: true });
  try { inp.setSelectionRange(caret, caret); } catch (_) { /* some input types have no caret */ }
  inp.dispatchEvent(new Event('input', { bubbles: true }));
}
function focusNextNum(inp) {
  /* Commit first, so a value outside its limits reveals its confirm field and focus lands there next. */
  const sh = S.sheet;
  if (sh && inp.dataset.field && sh.committed) { sh.committed[inp.dataset.field] = true; updateEntry(); }
  if (sh && inp.dataset.weight != null && sh.wCommitted) { sh.wCommitted[+inp.dataset.weight] = true; updateEntry(); }
  const scope = inp.closest('#layer-sheet, #layer-lock') || document;
  const list = $$('input.num, input[type=password], #sg-user, #si-user:not([readonly])', scope).filter((i) => !i.closest('[hidden]') && !i.readOnly);
  const i = list.indexOf(inp);
  const next = list[i + 1];
  if (next) { next.focus(); if (next.classList.contains('num')) markActive(next); }
  else { const save = scope.querySelector('.sheet-foot .primary:not(:disabled), .signin button[type=submit]'); if (save) save.focus(); }
}
function statusLine(ev, unit) {
  if (ev.state === 'in') return h`${icon('check')}Inside the limits`;
  if (ev.state === 'out') return h`${icon('cross')}Outside the limits (${rangeText(ev.lim, unit)}). Type it again below to confirm.`;
  if (ev.state === 'implausible') return h`${icon('cross')}Not plausible for this sensor (${rangeText(ev.pl, unit)}). Check the display, then type it again below.`;
  if (ev.state === 'invalid') return h`${icon('cross')}Not a number`;
  return '';
}
function retypeState(original, text, v) {
  const ok = String(text).trim() !== '' && parseNum(text) === v;
  return { ok, html: ok ? h`${icon('check')}Confirmed: both entries match` : String(text).trim() ? h`${icon('cross')}Does not match ${original}. Look at the display and type it again.` : '' };
}
function updateEntry() { const sh = S.sheet; if (!sh) return; if (sh.type === 'reading') updateReading(sh); if (sh.type === 'balance') updateBalance(sh); }
function updateReading(sh) {
  const c = checkNow(CHECKS[sh.checkId]); const fields = numFields(c);
  let filled = true; let confirmed = true; const flagged = [];
  let pending = false;
  for (const f of fields) {
    const ev = evalReading(c, f, sh.values[f] || '');
    const card = $(`.fcard[data-field="${f}"]`); if (!card) return;
    const unit = FIELD_DEF[f].unit;
    /* A value is judged once it is committed (Next, Enter or leaving the field), not on every keystroke. */
    const done = sh.committed[f] !== false;
    if (!done && ev.state !== 'empty') { pending = pending || needsRetype(ev) || ev.state === 'invalid'; }
    const shownState = done ? ev.state : ev.state === 'empty' ? 'empty' : 'typing';
    card.classList.toggle('is-out', done && (needsRetype(ev) || ev.state === 'invalid'));
    card.classList.toggle('is-in', done && ev.state === 'in');
    const g = card.querySelector('.gauge'); const mk = g.querySelector('.g-mark');
    if (ev.v != null) {
      const min = +g.dataset.min; const max = +g.dataset.max;
      mk.hidden = false; mk.style.left = `${Math.max(0, Math.min(100, ((ev.v - min) / (max - min)) * 100))}%`;
      mk.classList.toggle('off', done && ev.state !== 'in');
    } else mk.hidden = true;
    const st = $(`#st-${f}`); st.className = `fstatus ${shownState === 'in' ? 'ok' : shownState === 'empty' || shownState === 'typing' ? '' : 'bad'}`; st.innerHTML = String(shownState === 'typing' ? h`Press Next to check it against the limits` : statusLine(ev, unit));
    if (ev.state === 'empty' || ev.state === 'invalid') filled = false;
    const rt = $(`#rt-${f}`);
    if (done && needsRetype(ev)) {
      flagged.push(f);
      const shown = `${sh.values[f].trim().replace('-', MINUS)} ${unit}`;
      rt.hidden = false;
      rt.querySelector('label').innerHTML = String(h`Type <b>${shown}</b> again to confirm`);
      const r = retypeState(shown, sh.retype[f] || '', ev.v);
      const rs = $(`#rs-${f}`); rs.className = `rstatus ${r.ok ? 'ok' : r.html ? 'bad' : ''}`; rs.innerHTML = String(r.html);
      if (!r.ok) confirmed = false;
    } else { rt.hidden = true; }
  }
  const resetOk = !c.fields.includes('reset') || sh.reset != null;
  const cq = $('#consequence');
  if (flagged.length) {
    cq.className = 'consequence bad';
    cq.innerHTML = String(h`<p class="conseq-h">${icon('dev')}<span><b>Before you save:</b> this reading is outside its limits. Saving it</span></p><ul>${readingConsequence(c).map((x) => h`<li>${x}</li>`)}</ul>`);
  } else { cq.className = 'consequence'; cq.innerHTML = ''; }
  const canSave = filled && confirmed && resetOk && !pending;
  const btn = $('.sheet-foot [data-act="reading-save"]');
  if (btn) {
    btn.disabled = !canSave;
    btn.classList.toggle('danger', flagged.length > 0);
    btn.classList.toggle('primary', !flagged.length);
    btn.lastChild.textContent = flagged.length ? 'Save out-of-limit reading' : 'Save reading';
  }
  const ctx = $('#entry-ctx');
  if (ctx) ctx.textContent = pending ? 'Press Next to check the value you typed.' : !filled ? `Enter ${fields.length === 1 ? 'the value' : `all ${fields.length} values`}${c.fields.includes('reset') ? ', then the min/max answer' : ''}.` : !confirmed ? 'Type the flagged value again to confirm it.' : !resetOk ? 'Say whether you reset the min/max memory.' : flagged.length ? 'Saving opens a Deviation. Read what it does beside the keypad.' : 'Inside the limits. Saving stamps the server time.';
}
function updateBalance(sh) {
  const c = checkNow(CHECKS[sh.checkId]); const unit = balUnit(c.target);
  let filled = true; let confirmed = true; let pending = false; const fails = [];
  c.weights.forEach((w, i) => {
    const ev = evalWeight(c, i, sh.readings[i] || '');
    const e = $(`#e-${i}`); const p = $(`#p-${i}`); const row = $(`.weigh tr[data-w="${i}"]`); const rt = $(`#wr-${i}`);
    if (!e) return;
    row.classList.remove('is-out', 'is-in');
    if (sh.wCommitted[i] === false && ev.state !== 'empty') {
      pending = pending || ev.state !== 'in';
      e.textContent = '…'; p.textContent = 'Press Next to compute'; rt.hidden = true; return;
    }
    if (ev.state === 'empty' || ev.state === 'invalid') {
      e.textContent = '—'; p.innerHTML = ev.state === 'invalid' ? String(h`<span class="tag bad">${icon('cross')}Not a number</span>`) : '—';
      filled = false; rt.hidden = true; return;
    }
    e.innerHTML = String(h`${fmtSigned(ev.errPct, 4)} %<small>rounds to ${fmtSigned(ev.rounded, ev.dp)} %</small>`);
    p.innerHTML = String(ev.state === 'in' ? passTag(true, `Pass · within ±${c.tolerancePct} %`) : ev.state === 'implausible' ? h`<span class="tag bad">${icon('cross')}Not plausible · over ±${c.plausiblePct ?? 5} %</span>` : passTag(false, '', `Fail · outside ±${c.tolerancePct} %`));
    row.classList.add(ev.state === 'in' ? 'is-in' : 'is-out');
    if (ev.state !== 'in') {
      fails.push(i);
      const shown = `${sh.readings[i].trim()} ${unit}`;
      rt.hidden = false;
      rt.querySelector('label').innerHTML = String(h`Type the <b>${w.nominal}</b> reading <b>${shown}</b> again to confirm`);
      const r = retypeState(shown, sh.retype[i] || '', ev.v);
      const rs = $(`#wrs-${i}`); rs.className = `rstatus ${r.ok ? 'ok' : r.html ? 'bad' : ''}`; rs.innerHTML = String(r.html);
      if (!r.ok) confirmed = false;
    } else rt.hidden = true;
  });
  const cq = $('#consequence');
  if (fails.length) {
    cq.className = 'consequence wide bad';
    cq.innerHTML = String(h`<p class="conseq-h">${icon('dev')}<span><b>Before you save:</b> this Check fails. Saving and signing it</span></p><ul>${balanceConsequence(c).map((x) => h`<li>${x}</li>`)}</ul>`);
  } else { cq.className = 'consequence wide'; cq.innerHTML = ''; }
  const btn = $('.sheet-foot [data-act="balance-save"]');
  if (btn) {
    btn.disabled = !(filled && confirmed) || pending;
    btn.classList.toggle('danger', fails.length > 0);
    btn.classList.toggle('primary', !fails.length);
    btn.lastChild.textContent = fails.length ? 'Save failing Check, sign Performed…' : 'Save and sign Performed…';
  }
  const ctx = $('#entry-ctx');
  if (ctx) ctx.textContent = pending ? 'Press Next to compute the error.' : !filled ? `Weigh each check weight and type the reading in ${unit}.` : !confirmed ? 'Type the failing reading again to confirm it.' : fails.length ? 'Signing saves a failed Check. Read what it does beside the keypad.' : 'Both weights pass. Next: your Electronic Signature.';
}
function saveReading() {
  const sh = S.sheet; const c = CHECKS[sh.checkId]; const fields = numFields(c);
  const values = Object.fromEntries(fields.map((f) => [f, parseNum(sh.values[f])]));
  if (c.fields.includes('reset')) values.reset = sh.reset;
  const out = fields.filter((f) => needsRetype(evalReading(c, f, sh.values[f])));
  const at = nowMs();
  let deviationId = null; let note = '';
  if (out.length) {
    const t = c.target;
    const what = out.map((f) => `${FIELD_DEF[f].label.toLowerCase()} ${fmtFixed(values[f], decimalsOf(sh.values[f]))} ${FIELD_DEF[f].unit}`).join(', ');
    if (c.targetKind === 'Room') {
      const r = ROOMS[t];
      deviationId = openDeviation(r.storage ? 'Excursion' : 'Room', r.storage ? 'Major' : 'Minor', `${t} ${what} at the ${fmtDate(LAB_DAY)} reading`);
      note = r.storage ? `${deviationId} opened; ${t} refuses new placements.` : `${deviationId} opened.`;
    } else if (/^(FRZ|CMB)/.test(t)) {
      const open = L.deviations.find((d) => d.kind === 'Excursion' && d.state !== 'Closed' && d.title.startsWith(t));
      if (open) { deviationId = open.id; note = `Added to the open Excursion ${open.id}.`; }
      else {
        deviationId = openDeviation('Excursion', 'Major', `${t} ${what} at the ${fmtDate(LAB_DAY)} reading`);
        S.equipMods[t] = { fitness: 'Suspended', blocks: 'new placements', reason: `Excursion since ${c.last ? fmtLocal(c.last.at) : 'the last in-limit reading'} · ${deviationId} · new placements refused` };
        note = `${deviationId} opened; ${t} refuses new placements.`;
      }
    } else {
      deviationId = openDeviation('Equipment', 'Major', `${t} ${what} at the ${fmtDate(LAB_DAY)} reading`);
      S.equipMods[t] = { fitness: 'Suspended', reason: `Reading outside limits ${fmtDate(LAB_DAY)} (${deviationId})` };
      note = `${deviationId} opened; ${t} Suspended.`;
    }
  }
  S.checkState[c.id] = { status: 'Done', at, by: S.userId, values, outOfLimits: out.length > 0, deviationId };
  closeSheet(S.route === 'check-fail' ? 'checks' : null);
  renderMain(); renderRail();
  toast(out.length ? 'warn' : 'audit', `${c.target} reading saved${out.length ? ' outside its limits' : ''}`, `Server time ${fmtTime(at, true)} ${ZONE} (${fmtUtcTime(at, true)}). Audited, not signed.${note ? ` ${note}` : ''}`);
}
function balanceSign() {
  const sh = S.sheet; const c = CHECKS[sh.checkId]; const unit = balUnit(c.target);
  const evs = c.weights.map((w, i) => evalWeight(c, i, sh.readings[i] || ''));
  const pass = evs.every((e) => e.state === 'in');
  const failed = c.weights.filter((w, i) => evs[i].state !== 'in').map((w) => w.nominal);
  const content = { record: 'Check', checkId: c.id, planId: c.planId, equipment: c.target, labDay: LAB_DAY, unit, weights: c.weights, readings: sh.readings.map((r) => r.trim()), errorPct: evs.map((e) => Number(e.errPct.toFixed(4))), tolerancePct: c.tolerancePct, outcome: pass ? 'pass' : 'fail', confirmedByRetype: failed, performedBy: currentUser().username };
  const ctx = {
    meaning: 'Performed',
    recordId: `${c.id} · ${LAB_DAY}`,
    recordTitle: `${c.target} ${EQUIPMENT[c.target].name}: verification before first use`,
    recordVersion: 1,
    sha: sha256(JSON.stringify(content)),
    lines: [
      ['Readings', c.weights.map((w, i) => `${w.nominal}: ${sh.readings[i].trim()} ${unit} (${fmtSigned(evs[i].errPct, 4)} %)`).join(' · ')],
      ['Outcome', pass ? h`${passTag(true)} both within ±${c.tolerancePct} %` : h`${passTag(false)} ${failed.join(', ')} outside ±${c.tolerancePct} %, confirmed by typing it twice`],
      ['Time', "the server's clock when you sign"],
    ],
    consequence: pass ? `When you sign, the Check is saved as passed and ${c.target} can be used today.` : `When you sign, the failed Check is saved, an Equipment Deviation opens, ${c.target} is Suspended and the ${c.testsSinceLastPass ?? ''} Tests that cited it since its last pass get a Hold.`,
    onSigned: 'balance', back: sh, content, pass,
  };
  openSheet({ type: 'sign', ctx, error: null });
}
function signedBalance(ctx, sig) {
  const c = CHECKS[ctx.content.checkId];
  let deviationId = null;
  if (!ctx.pass) {
    const bad = ctx.content.weights.map((w, i) => [w, ctx.content.errorPct[i]]).filter(([, e]) => Math.abs(roundHalfAway(e, decimalsOf(c.tolerancePct))) > c.tolerancePct);
    deviationId = openDeviation('Equipment', 'Major', `${c.target} failed daily verification: ${bad.map(([w, e]) => `${w.nominal} weight read ${fmtSigned(e, 4)} %`).join(', ')} (limit ±${c.tolerancePct} %)`);
    S.equipMods[c.target] = { fitness: 'Suspended', reason: `Failed daily Check on ${fmtDate(LAB_DAY)} (${deviationId})` };
  }
  S.checkState[c.id] = { status: 'Done', at: sig.at, by: S.userId, values: { readings: ctx.content.readings, unit: ctx.content.unit }, outcome: ctx.pass ? 'pass' : 'fail', deviationId, signature: sig, signed: true };
  closeSheet('checks');
  render();
  if (ctx.pass) toast('ok', `${c.target} verification signed Performed`, `Passed. ${c.target} can be used today. ${fmtUtcFull(sig.at)}.`);
  else toast('bad', `${c.target} failed its Check · ${deviationId} opened`, `${c.target} is Suspended. Holds placed on ${c.testsSinceLastPass ?? 'the'} Tests that cited it since ${c.lastPass ? fmtLocal(c.lastPass) : 'its last pass'}. Signed Performed ${fmtUtcFull(sig.at)}.`);
}

/* ======================= events ======================= */
const ACTIONS = {
  nav: (el) => go(el.dataset.arg),
  lock: () => lockPC('manual'),
  'toast-x': (el) => dismissToast(Number(el.dataset.arg)),
  'sheet-cancel': () => cancelSheet(),
  /* lock screen */
  'lock-switch': () => { S.lock.mode = 'switch'; S.lock.picked = null; S.lock.error = null; renderLock(); focusLock(); },
  'lock-back': () => { const owner = PEOPLE[S.lock.sessionUserId]; S.lock.mode = S.lockedAccounts[owner.username] ? 'lockout' : 'locked'; S.lock.userId = owner.id; S.lock.picked = null; S.lock.error = null; renderLock(); focusLock(); },
  'pick-user': (el) => { S.lock.picked = el.dataset.arg; S.lock.error = null; renderLock(); focusLock(); },
  'reset-demo': () => location.reload(),
  /* queue */
  'q-state': (el) => { const s = el.dataset.arg; const i = S.q.states.indexOf(s); if (i >= 0) S.q.states.splice(i, 1); else S.q.states.push(s); queueRefresh(); },
  'q-assignee': (el) => { S.q.assignee = S.q.assignee === el.dataset.arg ? '' : el.dataset.arg; queueRefresh(); },
  'q-chip': (el) => { S.q[el.dataset.arg] = !S.q[el.dataset.arg]; queueRefresh(); },
  'q-gxp': (el) => { S.q.gxp = el.dataset.arg; queueRefresh(); },
  'q-clear': () => { const sel = S.q.selected; const sort = S.q.sort; S.q = { ...freshQueue(), selected: sel, sort }; $('#q-search').value = ''; $('#q-method').value = ''; $('#q-customer').value = ''; queueRefresh(); },
  'q-row': (el) => selectRow(el.dataset.id),
  'q-details': () => S.q.selected && openSheet({ type: 'details', testId: S.q.selected }),
  'q-assign': () => S.q.selected && openAssign(S.q.selected),
  'q-assign-next': () => { const next = rows0(openTests().filter((t) => t.state === 'Ready')); if (next) { if (ROUTES[S.route].screen === 'queue') selectRow(next.id, false); openAssign(next.id); } },
  'assign-pick': (el) => { S.sheet.choice = el.dataset.arg; renderSheet(true); },
  'assign-confirm': () => confirmAssign(),
  /* bench */
  'upload-open': () => openSheet({ type: 'upload', phase: 'choose', step: -1, hash: null }),
  'upload-start': () => startUpload(),
  'flag-accept': () => { Object.assign(S.bench, { composing: true, draftComment: '' }); renderBench(); $('#flag-comment')?.focus(); },
  'flag-cancel': () => { S.bench.composing = false; renderBench(); },
  phrase: (el) => { const b = S.bench; b.draftComment = `${b.draftComment.trim()} ${el.dataset.arg}`.trim(); const ta = $('#flag-comment'); if (ta) { ta.value = b.draftComment; ta.focus(); } const sv = $('[data-act="flag-save"]'); if (sv) sv.disabled = b.draftComment.trim().length < 10; },
  'flag-save': () => { const b = S.bench; b.flag = { decision: 'accept', comment: b.draftComment.trim(), by: S.userId, at: nowMs() }; b.composing = false; renderBench(); toast('audit', 'Flag decision saved', 'Accepted with comment. Recorded in the Audit Trail, and part of what you sign.'); },
  'flag-reinject': () => { S.bench.flag = { decision: 'reinject', by: S.userId, at: nowMs() }; S.bench.composing = false; renderBench(); toast('info', 'Reinjection of Preparation 2 requested', 'Signing waits for the new injection. The Test stays In Progress.'); },
  'flag-change': () => { S.bench.flag = null; S.bench.composing = false; renderBench(); },
  integ: (el) => { S.bench.integrations = el.dataset.arg; renderBench(); if (el.dataset.arg === 'some') $('#integ-text')?.focus(); },
  match: () => { S.bench.injectionsMatch = !S.bench.injectionsMatch; renderBench(); },
  'sign-open': () => { if (benchGates().ready) openSheet({ type: 'sign', ctx: signCtxForTest(), error: null }, 'sign'); },
  /* checks */
  'open-check': (el) => openCheck(el.dataset.arg),
  'reset-choice': (el) => { S.sheet.reset = el.dataset.arg === 'yes'; $$('[data-act="reset-choice"]').forEach((b) => b.setAttribute('aria-checked', tf(b.dataset.arg === el.dataset.arg))); updateEntry(); },
  'reading-save': () => saveReading(),
  'balance-save': () => balanceSign(),
  'alarm-open': () => openSheet({ type: 'alarm', text: '' }),
  'ack-phrase': (el) => { S.sheet.text = `${S.sheet.text.trim()} ${el.dataset.arg}`.trim(); const ta = $('#ack-text'); ta.value = S.sheet.text; ta.focus(); $('[data-act="alarm-save"]').disabled = S.sheet.text.trim().length < 8; },
  'alarm-save': () => { S.alarmAck = { by: S.userId, at: nowMs(), reason: S.sheet.text.trim() }; closeSheet(); renderMain(); toast('audit', 'Missed reading acknowledged', 'Recorded in the Audit Trail under your name. No reading was created for yesterday.'); },
};
document.addEventListener('click', (e) => {
  const key = e.target.closest('.key');
  if (key) { e.preventDefault(); keypadPress(key.dataset.key, key.closest('.keypad')); return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled || el.closest('[inert]')) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});
/* Keypad keys must not steal focus from the field they type into. */
document.addEventListener('pointerdown', (e) => { if (e.target.closest('.key')) e.preventDefault(); });
document.addEventListener('dblclick', (e) => {
  const tr = e.target.closest('#q-body tr.row');
  if (!tr) return;
  const t = testNow(TESTS[tr.dataset.id]);
  if (t.state === 'Ready') openAssign(t.id); else openSheet({ type: 'details', testId: t.id });
});
document.addEventListener('focusout', (e) => {
  const el = e.target; const sh = S.sheet;
  if (!sh || !el.dataset) return;
  if (el.dataset.field && sh.committed) { sh.committed[el.dataset.field] = true; updateEntry(); }
  if (el.dataset.weight != null && sh.wCommitted) { sh.wCommitted[+el.dataset.weight] = true; updateEntry(); }
});
document.addEventListener('focusin', (e) => { if (e.target.matches && e.target.matches('input.num, #sg-user, #sg-pass, #si-user, #si-pass')) markActive(e.target); });
document.addEventListener('input', (e) => {
  const el = e.target; const sh = S.sheet;
  if (el.id === 'q-search') { S.q.search = el.value; clearTimeout(searchTimer); searchTimer = setTimeout(queueRefresh, 120); return; }
  if (sh && el.dataset.field) { sh.values[el.dataset.field] = el.value; sh.committed[el.dataset.field] = false; sh.retype[el.dataset.field] = ''; const r = $(`#r-${el.dataset.field}`); if (r) r.value = ''; updateEntry(); return; }
  if (sh && el.dataset.retype) { sh.retype[el.dataset.retype] = el.value; updateEntry(); return; }
  if (sh && el.dataset.weight != null) { const i = +el.dataset.weight; sh.readings[i] = el.value; sh.wCommitted[i] = false; sh.retype[i] = ''; const r = $(`#wr-in-${i}`); if (r) r.value = ''; sh.focusRetype = false; updateEntry(); return; }
  if (sh && el.dataset.wretype != null) { sh.retype[+el.dataset.wretype] = el.value; updateEntry(); return; }
  if (el.id === 'flag-comment') { S.bench.draftComment = el.value; const sv = $('[data-act="flag-save"]'); if (sv) sv.disabled = el.value.trim().length < 10; return; }
  if (el.id === 'integ-text') { S.bench.integrationsText = el.value; updateGateUI(); return; }
  if (el.id === 'ack-text') { sh.text = el.value; $('[data-act="alarm-save"]').disabled = el.value.trim().length < 8; return; }
  if (el.closest('#sign-form')) updateSignButton();
  if (el.classList.contains('code')) el.value = el.value.replace(/\D/g, '').slice(0, 6);
});
document.addEventListener('change', (e) => {
  const id = e.target.id;
  if (id === 'q-method') { S.q.method = e.target.value; queueRefresh(); }
  if (id === 'q-customer') { S.q.customer = e.target.value; queueRefresh(); }
  if (id === 'q-sort') { S.q.sort = e.target.value; queueRefresh(); }
});
document.addEventListener('submit', (e) => {
  const f = e.target;
  e.preventDefault();
  if (f.dataset.form === 'sign') submitSignature(f);
  if (f.dataset.form === 'unlock' || f.dataset.form === 'signin') submitSignin(f, f.dataset.form);
});
document.addEventListener('keydown', (e) => {
  const t = e.target;
  const tr = t.closest && t.closest('#q-body tr.row');
  if (tr && !S.sheet) {
    const ids = S.qRows; const i = ids.indexOf(tr.dataset.id);
    const j = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: ids.length - 1, PageDown: i + 10, PageUp: i - 10 }[e.key];
    if (j != null) { e.preventDefault(); selectRow(ids[Math.max(0, Math.min(ids.length - 1, j))]); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const x = testNow(TESTS[tr.dataset.id]); selectRow(x.id); if (x.state === 'Ready') openAssign(x.id); else openSheet({ type: 'details', testId: x.id }); return; }
  }
  if (e.key === 'Escape' && S.sheet && !S.lock) { e.preventDefault(); cancelSheet(); return; }
  /* In the signature form Enter moves on and never signs: only the Sign button signs. */
  if (e.key === 'Enter' && t.closest && t.closest('#sign-form') && t.tagName === 'INPUT') {
    e.preventDefault();
    const order = ['sg-user', 'sg-pass', 'sg-code']; const k = order.indexOf(t.id);
    if (k >= 0 && k < 2) $(`#${order[k + 1]}`).focus(); else { const b = $('.sign-btn'); if (b && !b.disabled) b.focus(); }
    return;
  }
  if (e.key === 'Enter' && t.matches && t.matches('#layer-sheet input.num')) { e.preventDefault(); focusNextNum(t); }
});

boot();

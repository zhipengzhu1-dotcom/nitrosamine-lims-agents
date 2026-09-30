/* app.js: routes, the action dispatcher, and boot.
   Hash routes are exactly: queue, assign, test, imported, sign, checks, check-fail. */
(() => {
  'use strict';
  const LX = window.LX, { h, raw, icon } = LX, M = LX.M, T = LX.t, U = LX.U, S = LX.S, L = window.LIMS, O = LX.overlay, A = LX.actions;
  const ROUTES = ['queue', 'assign', 'test', 'imported', 'sign', 'checks', 'check-fail'];
  const TITLES = { queue: 'Lab queue', assign: 'Assign a Test', test: 'Test workspace', imported: 'Test workspace, draft values', sign: 'Sign Performed', checks: 'Today’s Checks', 'check-fail': 'Failed balance Check' };
  LX.routeTitle = () => TITLES[S.route] ?? 'Interlock';
  const main = () => document.getElementById('main');

  /* ---------- routing ---------- */
  /* the route in the URL follows the state; a sandboxed frame may forbid it, and the app still works */
  const setHash = (route, push = false) => { try { history[push ? 'pushState' : 'replaceState'](null, '', `#${route}`); } catch { /* frame without history access */ } };
  let rendered = null; // which screen layout is on the page
  const screenKey = (route) => ({ queue: 'queue', assign: 'queue', test: 'ws-before', imported: 'ws-after', sign: 'ws-after', checks: 'checks', 'check-fail': 'checks' }[route]);
  const homeRoute = (p) => (p.username === 'hkowalski' ? 'queue' : p.username === 'kwatanabe' ? 'checks' : S.ws.imported || S.ws.sig ? 'imported' : 'test');
  const routeForTab = (tab) => (tab === 'queue' ? 'queue' : tab === 'checks' ? 'checks' : S.ws.imported || S.ws.sig ? 'imported' : 'test');
  const sinceOf = (p) => { const t = { hkowalski: '07:52', praman: '08:12', kwatanabe: '06:58' }[p.username] ?? '08:00'; return new Date(`${M.today}T${t}:00-04:00`); };

  LX.go = (route, { replace = false } = {}) => {
    if (replace) { setHash(route); apply(route); } else if (location.hash === `#${route}`) apply(route); else location.hash = `#${route}`;
  };

  function paintTabs() {
    const tab = LX.tabOf(S.route);
    for (const a of document.querySelectorAll('.tabs .tab')) {
      const on = a.dataset.tab === tab; a.toggleAttribute('aria-current', on); if (on) a.setAttribute('aria-current', 'page');
      if (a.dataset.tab === 'test') a.setAttribute('href', `#${routeForTab('test')}`);
    }
  }

  function apply(route) {
    if (!ROUTES.includes(route)) route = 'queue';
    const persona = LX.personaOf(LX.tabOf(route));
    if (!S.session || S.session.person.id !== persona.id) LX.Session.start(persona, { since: sinceOf(persona) });
    const ws = S.ws;
    // routes never lower what the person has already done; they only raise what the state needs
    if (route === 'test' && ws.imported) { route = 'imported'; setHash('imported'); }
    if (route === 'imported') LX.workspace.seed(1);
    if (route === 'sign') { if (ws.sig) { route = 'imported'; setHash('imported'); } else LX.workspace.seed(2); }
    if (route === 'assign' && M.rowById.get(M.assignRowId).state !== 'Ready') { route = 'queue'; setHash('queue'); }
    if (route === 'check-fail' && M.checkById.get('CHK-BAL-04').status !== 'Due') { route = 'checks'; setHash('checks'); }
    S.route = route; const key = screenKey(route);
    const wantOverlay = { assign: 'assign', sign: 'sign', 'check-fail': 'entry' }[route] ?? null;
    if (!(wantOverlay && O.top()?.kind === wantOverlay)) O.closeAll();
    LX.pop.close(true);
    if (rendered !== key) {
      const m = main(); m.scrollTop = 0;
      if (key === 'queue') LX.queue.render(m); else if (key === 'checks') LX.checks.render(m); else LX.workspace.render(m);
      rendered = key;
    }
    if (wantOverlay && O.top()?.kind !== wantOverlay) {
      if (route === 'assign') O.open('assign', { id: M.assignRowId });
      else if (route === 'sign') O.open('sign', { record: LX.workspace.signedRecord(), ctx: 'ws', id: M.focus.testId });
      else O.open('entry', { id: 'CHK-BAL-04', mode: 'entry', preset: { w0: String(L.focus.checkFail.typed.readingsMg[0]), w1: String(L.focus.checkFail.typed.readingsMg[1]) } });
    }
    LX.renderBar(); document.title = `${S.session.person.name}: ${TITLES[route]}`;
  }
  const routeOfHash = () => location.hash.replace(/^#/, '').split('?')[0] || 'queue';
  addEventListener('hashchange', () => { if (S.lock) return; apply(routeOfHash()); });

  /* what closing an overlay leaves behind */
  LX.closeTop = () => {
    const top = O.top(); if (!top) return; if (top.def.canClose?.(top.st) === false) return;
    const kind = top.kind, st = top.st, props = top.props; O.close(kind); LX.afterClose(kind, { st, props });
  };
  LX.afterClose = (kind, { st = {}, props = {} } = {}) => {
    if (kind === 'assign') { if (S.route === 'assign') { setHash('queue'); S.route = 'queue'; LX.renderBar(); paintTabs(); } LX.queue.refreshRows(); if (st.done) LX.queue.flash(props.id); }
    if (kind === 'peek') LX.queue.select(null);
    if (kind === 'sign') { if (S.ws.sig) { LX.workspace.fullRefresh(); LX.renderBar(); } if (S.route === 'sign') { setHash('imported'); S.route = 'imported'; paintTabs(); } }
    if (kind === 'entry') { LX.checks.repaint(); if (S.route === 'check-fail') { setHash('checks'); S.route = 'checks'; paintTabs(); } }
    if (kind === 'flag' || kind === 'upload') { /* the workspace repaints in the action that finished */ }
  };

  /* ---------- dispatcher ---------- */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const fn = A[el.dataset.act]; if (!fn) return;
    if (el.tagName === 'A') e.preventDefault();
    fn(el, e);
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-form]'); if (!f) return; const k = f.dataset.form;
    if (k === 'sign') return; e.preventDefault();
    if (k === 'unlock') {
      const pw = f.querySelector('#lk-pw'); const r = LX.Session.unlockWith(pw.value); const err = f.querySelector('#lk-err');
      if (!r.ok) { err.textContent = r.locked ? LX.Auth.message(r) : `The password is not correct. ${LX.Auth.attemptsLeft(r.username)} ${LX.Auth.attemptsLeft(r.username) === 1 ? 'attempt is' : 'attempts are'} left before ${r.username} is locked.`; err.hidden = false; pw.value = ''; pw.focus(); }
    }
    if (k === 'switch') LX.Switch.submit(f);
  });

  A.nav = (el, e) => {
    e.preventDefault(); const tab = el.dataset.tab; if (tab === LX.tabOf(S.route)) return;
    const persona = LX.personaOf(tab);
    if (persona.id !== S.session.person.id) LX.Switch.open({ to: persona.username, then: routeForTab(tab) }); else LX.go(routeForTab(tab));
  };
  A.lock = () => LX.Session.lock('manual');
  A.switch = () => LX.Switch.open({ then: S.pendingRoute });
  A['switch-to'] = (el) => { O.closeAll(); LX.Switch.open({ to: el.dataset.user, then: el.dataset.then }); };
  A['switch-pick'] = (el) => LX.Switch.pick(el.dataset.user);
  A['switch-cancel'] = () => LX.Switch.cancel();
  A['switch-back'] = () => LX.Switch.back();
  A.passkey = (el) => {
    const root = document.getElementById('lock-root'); const user = el.dataset.user;
    LX.passkey(root, user, (r) => {
      if (r.ok) { const prev = S.session?.person; const then = S.pendingRoute; const person = M.byUser.get(user); LX.Session.start(person); LX.afterSwitch(person, prev, then); }
      else { const err = root.querySelector('#sw-err'); err.textContent = LX.Auth.message(r); err.hidden = false; }
    });
  };
  A['demo-fill'] = (el) => { const root = document.getElementById('lock-root'); LX.Cred.demoFill(root, el.dataset.user, el.dataset.prefix); root.querySelector(el.dataset.prefix === 'lk' ? '#lk-pw' : '#sw-tp')?.focus(); };
  A['ov-close'] = () => LX.closeTop();
  A['ov-scrim'] = () => LX.closeTop();
  A.peek = (el) => { const id = el.dataset.id; LX.queue.select(id); O.open('peek', { id }); };
  A['pop-holds'] = (el) => LX.queue.holdsPopover(el, el.dataset.id);
  A['pop-close'] = () => LX.pop.close();
  A['q-state'] = (el) => LX.queue.toggleState(el.dataset.state);
  A['q-toggle'] = (el) => LX.queue.toggle(el.dataset.k);
  A['q-clear'] = () => LX.queue.clear();
  A['q-sort'] = (el) => LX.queue.sort(el.dataset.k);
  A['q-assignee'] = (el) => LX.queue.assignee(el.dataset.p);

  /* ---------- assignment ---------- */
  A['assign-open'] = (el) => {
    const id = el.dataset.id; if (O.has('peek')) O.close('peek', { restore: false, immediate: true }); LX.queue.select(null);
    O.open('assign', { id });
    if (id === M.assignRowId && S.route === 'queue') { setHash('assign'); S.route = 'assign'; paintTabs(); }
  };
  A['assign-pick'] = (el) => { const inst = O.top(); if (inst.kind !== 'assign' || inst.st.done) return; inst.st.picked = el.dataset.p; O.update('assign'); };
  A['assign-confirm'] = (el) => {
    const inst = O.top(); if (inst.kind !== 'assign') return; const st = inst.st;
    if (!st.picked) { const first = inst.el.querySelector('[role="radio"]'); first?.focus(); const pk = inst.el.querySelector('.asg__pick'); pk?.classList.remove('is-nudge'); void pk?.offsetWidth; pk?.classList.add('is-nudge'); return; }
    const row = M.rowById.get(inst.props.id); const by = S.session.person; const person = M.person.get(st.picked); const at = T.now();
    M.assign(row, person, by, at);
    st.done = { name: person.name, user: person.username, who: by.username, utc: T.stampUtc(at), local: `${T.stampS(at)} (${T.offset(at)})` };
    O.update('assign'); LX.queue.refreshRows(); LX.queue.flash(row.id);
    LX.toast({ title: `${row.id} assigned to ${person.name}`, detail: 'Recorded in the Audit Trail.' });
  };
  A['assign-next'] = (el) => { const id = el.dataset.id; O.close('assign', { restore: false, immediate: true }); O.open('assign', { id }); if (S.route === 'assign') { setHash('queue'); S.route = 'queue'; paintTabs(); } };

  /* ---------- upload (simulated) ---------- */
  A['upload-pick'] = () => { const inst = O.top(); if (inst.kind !== 'upload') return; inst.st.picked = !inst.st.picked; O.update('upload'); };
  A['upload-go'] = (el) => {
    const inst = O.top(); if (inst.kind !== 'upload') return; const st = inst.st; if (el.getAttribute('aria-disabled') === 'true') { if (!st.picked) inst.el.querySelector('.file')?.focus(); return; }
    st.step = 0; O.update('upload');
    const total = 4; let i = 0;
    const tick = () => {
      i++; st.step = i; if (O.has('upload')) O.update('upload');
      if (i < total) setTimeout(tick, 420);
      else setTimeout(() => {
        S.ws.imported = true; S.ws.justImported = true;
        if (O.has('upload')) { O.close('upload', { restore: false, immediate: true }); }
        if (!S.lock) LX.go('imported'); LX.toast({ title: `${M.focus.import.rowsForThisTest} draft values imported`, detail: 'They are drafts until you sign Performed.' });
      }, 900);
    };
    setTimeout(tick, 420);
  };

  /* ---------- flag ---------- */
  A['flag-mode'] = (el) => { const inst = O.top(); inst.st.mode = el.dataset.mode; O.update('flag'); };
  A['flag-phrase'] = (el) => { const inst = O.top(); const s = LX.PHRASES[+el.dataset.i]; inst.st.comment = (inst.st.comment.trim() ? `${inst.st.comment.trim()} ` : '') + s; O.update('flag'); const ta = inst.el.querySelector('#flag-c'); ta?.focus(); ta?.setSelectionRange(ta.value.length, ta.value.length); };
  A['flag-confirm'] = (el) => {
    const inst = O.top(); const st = inst.st;
    if (el.getAttribute('aria-disabled') === 'true') { inst.el.querySelector('#flag-c')?.focus(); return; }
    S.ws.flag = { mode: st.mode, comment: st.comment.trim(), at: T.now().toISOString(), by: S.session.person.id };
    O.close('flag'); LX.workspace.paintResults(); LX.workspace.paintDock();
    LX.toast({ title: st.mode === 'accept' ? 'Flag accepted with your comment' : 'Reinjection requested', detail: st.mode === 'accept' ? 'The value stays a draft until you sign Performed.' : 'This Test waits for the new export.' });
  };

  /* ---------- demo controls: not part of the product ---------- */
  A.demo = (el) => {
    const c = L.demoCredentials.users;
    LX.pop.open(el, h`<div class="pop__head"><span>Prototype controls</span><button class="iconbtn" data-act="pop-close" aria-label="Close">${icon('x')}</button></div>
      <div class="pop__item demo">
        <p class="muted">Not part of the product. All data is fictional.</p>
        <table class="demo__t"><thead><tr><th>User ID</th><th>Password</th><th>Code</th></tr></thead><tbody>${Object.entries(c).map(([u, v]) => h`<tr><td class="mono">${u}</td><td class="mono">${v.password}</td><td class="mono">${v.totp}</td></tr>`)}</tbody></table>
        <button class="btn" data-act="demo-idle">${icon('clock')}Lock in 12 seconds (idle)</button>
        <button class="btn" data-act="demo-unlock">${icon('unlock')}Unlock every account</button>
        <button class="btn" data-act="demo-reset">${icon('reset')}Reset the demo</button>
      </div>`, { label: 'Prototype controls' });
  };
  A['demo-idle'] = () => { LX.pop.close(true); LX.Session.simulateIdle(); LX.toast({ title: 'Idle lock in 12 seconds', detail: 'Do not touch anything. The ring on your name plate runs out.', ms: 6000 }); };
  A['demo-unlock'] = () => { LX.Auth.unlockAll(); LX.pop.close(); LX.toast({ title: 'Every account unlocked', ms: 2500 }); };
  A['demo-reset'] = () => location.reload();

  /* after a switch of user: resume that person's drafts, or open what they were sent for */
  LX.afterSwitch = (person, prev, then) => {
    const d = S.drafts[person.id]; let route = then ?? (d?.route ?? homeRoute(person));
    if (LX.tabOf(route) !== LX.tabOf(homeRoute(person)) && !then) route = homeRoute(person);
    delete S.drafts[person.id];
    document.getElementById('lock-root').innerHTML = ''; LX.Session.setInert(false);
    rendered = null; if (location.hash !== `#${route}`) setHash(route, true); apply(route);
    if (d?.snap?.length && LX.tabOf(d.route) === LX.tabOf(route)) LX.overlay.resume(d.snap);
    LX.toast({ title: `Signed in as ${person.name}`, detail: prev && prev.id !== person.id ? `${prev.name}’s session ended. Open entries stay in ${LX.M.firstName(prev)}’s drafts.` : '', ms: 4000 });
    (document.getElementById('main')).focus({ preventScroll: true });
  };

  /* ---------- boot ---------- */
  if (!window.LIMS) { document.getElementById('main').innerHTML = '<p style="padding:2rem">data.js did not load. Serve the ui-direction folder.</p>'; return; }
  apply(routeOfHash());
})();

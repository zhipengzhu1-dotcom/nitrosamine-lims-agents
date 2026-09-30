/* session.js: who is at this PC. Identity plate, idle lock, take-over, and the credential
   fields that signing, sign-in and unlock all share. */
(() => {
  'use strict';
  const LX = window.LX, { h, raw, icon } = LX, M = LX.M, T = LX.t, L = window.LIMS;
  const S = (LX.S = { route: 'queue', session: null, lock: null, accounts: {}, drafts: {}, layer: [], pendingRoute: null });
  const CREDS = L.demoCredentials; const LIMIT = CREDS.lockoutAfterFailures; const IDLE_MS = CREDS.idleLockMinutes * 60 * 1000;

  /* ---------- credential checking, as the server would answer ---------- */
  const Auth = (LX.Auth = {
    acct: (u) => (S.accounts[u] ??= { fails: 0, locked: false }),
    isLocked: (u) => Auth.acct(u).locked,
    /* mode: 'sign' and 'login' need password and code; 'unlock' needs the password only */
    verify({ username, password, totp, mode }) {
      const u = String(username || '').trim().toLowerCase(); const c = CREDS.users[u]; const a = Auth.acct(u);
      if (a.locked) return { ok: false, locked: true, username: u };
      if (!c) return { ok: false, unknown: true, username: u };
      const good = password === c.password && (mode === 'unlock' || String(totp || '').trim() === c.totp);
      if (good) { a.fails = 0; return { ok: true, username: u }; }
      a.fails += 1;
      if (a.fails >= LIMIT) { a.locked = true; return { ok: false, locked: true, username: u }; }
      return { ok: false, left: LIMIT - a.fails, username: u };
    },
    message(r) {
      if (r.locked) return `${r.username} is locked after ${LIMIT} failed attempts in a row. An Admin has to unlock the account.`;
      if (r.unknown) return 'The user ID, password or code is not correct.';
      return `The password or code is not correct. ${r.left} ${r.left === 1 ? 'attempt is' : 'attempts are'} left before ${r.username} is locked.`;
    },
    attemptsLeft: (u) => Math.max(0, LIMIT - Auth.acct(u).fails),
    unlockAll() { S.accounts = {}; },
  });

  /* ---------- credential fields ---------- */
  LX.Cred = {
    fields({ askUserId = false, totp = true, idPrefix = 'cr', username = '', focusFirst = false }) {
      return h`
        ${askUserId ? h`<div class="cred__row"><label class="cred__lbl" for="${idPrefix}-id">User ID</label>
          <input class="cred__in" id="${idPrefix}-id" name="userid" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" value="${username}" ${focusFirst ? 'data-first' : ''}></div>` : ''}
        <div class="cred__row"><label class="cred__lbl" for="${idPrefix}-pw">Password</label>
          <input class="cred__in" id="${idPrefix}-pw" name="password" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" ${!askUserId && focusFirst ? 'data-first' : ''}></div>
        ${totp ? h`<div class="cred__row"><label class="cred__lbl" for="${idPrefix}-tp">Authenticator code, 6 digits</label>
          <input class="cred__in cred__in--code" id="${idPrefix}-tp" name="totp" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" spellcheck="false" placeholder="000000"></div>` : ''}`;
    },
    read(root, idPrefix = 'cr') {
      const v = (s) => root.querySelector(`#${idPrefix}-${s}`)?.value ?? '';
      return { username: v('id'), password: v('pw'), totp: v('tp') };
    },
    /* the demo helper: fills the fields with the fictional credentials of a user */
    demoFill(root, username, idPrefix = 'cr') {
      const c = CREDS.users[username]; if (!c) return;
      const set = (s, val) => { const el = root.querySelector(`#${idPrefix}-${s}`); if (el) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); } };
      set('id', username); set('pw', c.password); set('tp', c.totp);
    },
  };

  /* ---------- session ---------- */
  const Session = (LX.Session = {
    IDLE_MS,
    start(person, opts = {}) {
      const now = T.mono();
      S.session = { person, since: opts.since ?? T.now(), lastActive: now };
      S.lock = null; S.pendingRoute = null;
      document.getElementById('lock-root').innerHTML = '';
      Session.setInert(false);
      LX.renderBar();
      document.title = `${person.name}: ${LX.routeTitle?.() ?? 'Interlock'}`;
    },
    touch() { if (S.session) S.session.lastActive = T.mono(); },
    remaining() { return S.session ? IDLE_MS - (T.mono() - S.session.lastActive) : IDLE_MS; },
    simulateIdle() { if (S.session) { S.session.lastActive = T.mono() - (IDLE_MS - 12000); Session.tick(); } },
    setInert(on) { for (const id of ['bar', 'main', 'layer']) { const el = document.getElementById(id); if (el) { el.inert = on; if (on) el.setAttribute('aria-hidden', 'true'); else el.removeAttribute('aria-hidden'); } } },

    /* lock: keep the person's open work as their own draft, then cover everything */
    lock(reason = 'manual') {
      if (!S.session || S.lock) return;
      const person = S.session.person;
      const snap = LX.overlay.suspend();
      S.drafts[person.id] = { route: S.route, snap };
      S.lock = { person, reason, at: T.now() };
      LX.pop.close();
      renderLock();
    },
    unlockWith(password) {
      const r = Auth.verify({ username: S.lock.person.username, password, mode: 'unlock' });
      if (!r.ok) return r;
      const person = S.lock.person; const d = S.drafts[person.id]; delete S.drafts[person.id];
      S.lock = null; S.session.lastActive = T.mono();
      document.getElementById('lock-root').innerHTML = '';
      Session.setInert(false);
      if (d?.snap) LX.overlay.resume(d.snap);
      LX.renderBar();
      return r;
    },
    tick() {
      if (!S.session || S.lock) return;
      const rem = Session.remaining();
      if (rem <= 0) { Session.lock('idle'); return; }
      const ring = document.getElementById('ring-arc'); const lbl = document.getElementById('plate-sub'); const plate = document.querySelector('.plate');
      if (!ring) return;
      const f = LX.clamp(rem / IDLE_MS, 0, 1); ring.style.strokeDashoffset = String(CIRC * (1 - f));
      const warn = rem <= 60000;
      plate?.classList.toggle('is-warn', warn);
      if (lbl) {
        const p = S.session.person;
        lbl.textContent = warn ? `Locks in ${Math.floor(rem / 60000)}:${String(Math.ceil((rem % 60000) / 1000) % 60).padStart(2, '0')}` : `${M.role(p)}, ${p.username}`;
      }
    },
  });
  const CIRC = 2 * Math.PI * 21;

  /* any touch, key or wheel keeps the session alive; nothing else does */
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) document.addEventListener(ev, () => Session.touch(), { capture: true, passive: true });
  setInterval(() => Session.tick(), 1000);

  /* ---------- top bar: brand, screens, clock, identity plate, lock, switch ---------- */
  const TABS = [
    { id: 'queue', label: 'Lab queue', persona: 'queue' },
    { id: 'test', label: 'Test workspace', persona: 'test' },
    { id: 'checks', label: 'Today’s Checks', persona: 'checks' },
  ];
  LX.tabs = TABS;
  LX.personaOf = (tabId) => M.person.get(L.personas[TABS.find((x) => x.id === tabId).persona]);
  LX.tabOf = (route) => ({ queue: 'queue', assign: 'queue', test: 'test', imported: 'test', sign: 'test', checks: 'checks', 'check-fail': 'checks' }[route] ?? 'queue');

  LX.renderBar = () => {
    const bar = document.getElementById('bar'); const p = S.session?.person; if (!p) { bar.innerHTML = ''; return; }
    const tab = LX.tabOf(S.route); const now = T.now();
    bar.innerHTML = String(h`
      <div class="brand">
        <svg class="brand__mark" viewBox="0 0 32 24" aria-hidden="true"><use href="#i-trace"/></svg>
        <div class="brand__txt"><b>Nitrosamine LIMS</b><span class="brand__lab">Lab ${L.lab.id} <em class="fict" title="All data is fictional. Limits are illustrative.">Fictional data</em></span></div>
      </div>
      <nav class="tabs" aria-label="Screens">
        ${TABS.map((x) => { const who = LX.personaOf(x.id); const here = who.id === p.id; return h`
          <a class="tab" href="#${x.id === 'test' ? (LX.S.ws?.imported ? 'imported' : 'test') : x.id}" data-act="nav" data-tab="${x.id}" ${tab === x.id ? raw('aria-current="page"') : ''}>
            <span class="tab__l">${x.label}</span>
            <span class="tab__p">${here ? '' : icon('swap', 'ico--s')}${M.firstName(who)}, ${M.role(who)}</span>
          </a>`; })}
      </nav>
      <div class="bar__gap"></div>
      <button class="bar__demo" data-act="demo" aria-haspopup="dialog">Demo</button>
      <div class="clock" role="timer" aria-label="Server time">
        <b class="mono" id="clock-hm">${T.hm(now)}</b><span id="clock-z">${T.zone(now)}, ${T.utcHms(now).slice(0, 5)} UTC</span>
      </div>
      <div class="plate" role="group" aria-label="Signed in as ${p.name}, ${M.role(p)}">
        <span class="plate__av">
          <svg class="ring" viewBox="0 0 48 48" aria-hidden="true"><circle class="ring__t" cx="24" cy="24" r="21"/><circle id="ring-arc" class="ring__a" cx="24" cy="24" r="21" stroke-dasharray="${CIRC}" stroke-dashoffset="0"/></svg>
          ${U_av(p)}
        </span>
        <span class="plate__txt">
          <b class="plate__name">${p.name}</b>
          <span class="plate__sub" id="plate-sub">${M.role(p)}, ${p.username}</span>
        </span>
      </div>
      <button class="bar__btn" data-act="lock">${icon('lock')}Lock</button>
      <button class="bar__btn" data-act="switch">${icon('swap')}Switch user</button>`);
    Session.tick();
  };
  const U_av = (p) => h`<span class="av av--me" style="--av:2.5rem" aria-hidden="true">${M.initials(p)}</span>`;
  setInterval(() => {
    const c = document.getElementById('clock-hm'); if (!c) return; const now = T.now();
    c.textContent = T.hm(now); document.getElementById('clock-z').textContent = `${T.zone(now)}, ${T.utcHms(now).slice(0, 5)} UTC`;
  }, 5000);

  /* ---------- the lock screen: the whole screen goes dark so nobody reads a locked PC by mistake ---------- */
  function renderLock() {
    const root = document.getElementById('lock-root'); const { person, reason, at } = S.lock; Session.setInert(true);
    root.innerHTML = String(h`
      <section class="lock on-dark" role="dialog" aria-modal="true" aria-labelledby="lock-h">
        <div class="lock__brand"><svg viewBox="0 0 32 24" aria-hidden="true"><use href="#i-trace"/></svg><span>Nitrosamine LIMS, Lab ${L.lab.id}</span><em class="fict">Fictional data</em></div>
        <div class="lock__card">
          <div class="lock__badge">${icon('lock', 'ico--l')}<h1 id="lock-h">This PC is locked</h1></div>
          <div class="lock__who">
            <span class="av av--me" style="--av:4.5rem" aria-hidden="true">${M.initials(person)}</span>
            <div><b class="lock__name">${person.name} ${U_native(person)}</b><span>${M.role(person)}, ${person.username}</span></div>
          </div>
          <p class="lock__why">${reason === 'idle' ? `Locked at ${T.hm(at)} ${T.zone(at)} after ${CREDS.idleLockMinutes} minutes without use.` : `${M.firstName(person)} locked it at ${T.hm(at)} ${T.zone(at)}.`} Open entries are kept as ${M.firstName(person)}’s drafts.</p>
          <form class="cred" data-form="unlock" novalidate>
            ${LX.Cred.fields({ totp: false, idPrefix: 'lk', focusFirst: true })}
            <p class="cred__err" role="alert" id="lk-err" hidden></p>
            <button class="key" type="submit">${icon('unlock')}Unlock as ${M.firstName(person)}</button>
          </form>
          <div class="lock__alt">
            <p>Not ${person.name}?</p>
            <button class="key key--ghost lock__switch" data-act="switch">${icon('swap')}Take over this PC</button>
          </div>
          <button class="lock__demo" data-act="demo-fill" data-user="${person.username}" data-prefix="lk">Demo: fill the password</button>
        </div>
      </section>`);
    root.querySelector('[data-first]')?.focus({ preventScroll: true });
  }
  const U_native = (p) => (p.nativeName ? h`<span class="native" lang="${M.lang[p.id] ?? 'zh'}">${p.nativeName}</span>` : '');

  /* ---------- take over: who is at the PC now ---------- */
  const RECENT = () => ['hkowalski', 'praman', 'kwatanabe'].map((u) => M.byUser.get(u));
  const LAST_SEEN = { hkowalski: '07:52', praman: '08:12', kwatanabe: '06:58' };
  const current = () => (S.lock ? S.lock.person : S.session?.person);
  LX.Switch = {
    step1(to = null) {
      const root = document.getElementById('lock-root'); root.innerHTML = String(step1(current(), to));
      root.querySelector('.tile.is-target, .tile')?.focus({ preventScroll: true });
    },
    open({ to = null, then = null } = {}) {
      S.pendingRoute = then; const cur = current();
      // a live session's open work becomes its own draft before anyone else can see the screen
      if (cur && !S.lock && !S.switching) { const snap = LX.overlay.suspend(); S.drafts[cur.id] = { route: S.route, snap }; LX.pop.close(); }
      S.switching = true; Session.setInert(true); LX.Switch.step1(to);
    },
    back() { LX.Switch.step1(); },
    pick(username) {
      const root = document.getElementById('lock-root'); root.innerHTML = String(step2(username, current()));
      root.querySelector('[data-first]')?.focus({ preventScroll: true });
    },
    cancel() {
      S.switching = false; const cur = current();
      if (S.lock) { renderLock(); return; }
      document.getElementById('lock-root').innerHTML = ''; Session.setInert(false);
      const d = cur && S.drafts[cur.id]; if (d?.snap) { delete S.drafts[cur.id]; LX.overlay.resume(d.snap); }
    },
    submit(form) {
      const username = form.dataset.user; const v = LX.Cred.read(form, 'sw');
      const r = Auth.verify({ username, password: v.password, totp: v.totp, mode: 'login' });
      const err = form.querySelector('#sw-err');
      if (!r.ok) { err.textContent = Auth.message(r); err.hidden = false; form.querySelector('#sw-pw')?.focus(); if (r.locked) form.querySelector('button[type="submit"]')?.setAttribute('aria-disabled', 'true'); return; }
      const person = M.byUser.get(username); const prev = S.session?.person; const then = S.pendingRoute;
      S.switching = false; Session.start(person);
      LX.afterSwitch(person, prev, then);
    },
  };
  const step1 = (cur, to) => h`
    <section class="lock lock--switch on-dark" role="dialog" aria-modal="true" aria-labelledby="sw-h">
      <div class="lock__brand"><svg viewBox="0 0 32 24" aria-hidden="true"><use href="#i-trace"/></svg><span>Nitrosamine LIMS, Lab ${L.lab.id}</span><em class="fict">Fictional data</em></div>
      <div class="lock__card lock__card--wide">
        <h1 id="sw-h" class="lock__title">Who is using this PC now?</h1>
        ${cur ? h`<p class="lock__note">${icon('info')}<span><b>${cur.name}</b>’s session ends when someone signs in. Open entries stay with ${M.firstName(cur)} as drafts; nobody else can open them.</span></p>` : ''}
        <div class="tiles" role="list">
          ${RECENT().map((p) => h`<button class="tile ${to === p.username ? 'is-target' : ''}" role="listitem" data-act="switch-pick" data-user="${p.username}">
            <span class="av ${cur?.id === p.id ? 'av--me' : ''}" style="--av:3.5rem" aria-hidden="true">${M.initials(p)}</span>
            <span class="tile__t"><b>${p.name} ${U_native(p)}</b><span>${M.role(p)}, ${p.username}</span><small>${cur?.id === p.id ? 'Signed in now' : `Last on this PC today at ${LAST_SEEN[p.username]}`}</small></span>
          </button>`)}
        </div>
        <div class="lock__row">
          ${cur ? h`<button class="key key--ghost" data-act="switch-cancel">${S.lock ? 'Back to the lock screen' : `Stay signed in as ${M.firstName(cur)}`}</button>` : ''}
          <p class="lock__hint">Someone else? Only people with an account here can sign in. Each sign-in needs a password and a fresh authenticator code, or a passkey.</p>
        </div>
      </div>
    </section>`;
  const step2 = (username, cur) => { const p = M.byUser.get(username); const locked = Auth.isLocked(username); return h`
    <section class="lock lock--switch on-dark" role="dialog" aria-modal="true" aria-labelledby="sw-h">
      <div class="lock__brand"><svg viewBox="0 0 32 24" aria-hidden="true"><use href="#i-trace"/></svg><span>Nitrosamine LIMS, Lab ${L.lab.id}</span><em class="fict">Fictional data</em></div>
      <div class="lock__card">
        <div class="lock__who lock__who--l">
          <span class="av av--me" style="--av:5rem" aria-hidden="true">${M.initials(p)}</span>
          <div><h1 id="sw-h" class="lock__name">Sign in as ${p.name} ${U_native(p)}</h1><span>${M.role(p)}, ${p.username}</span></div>
        </div>
        <form class="cred" data-form="switch" data-user="${username}" novalidate>
          ${locked ? '' : LX.Cred.fields({ idPrefix: 'sw', focusFirst: true })}
          <p class="cred__err" role="alert" id="sw-err" ${locked ? '' : 'hidden'}>${locked ? Auth.message({ locked: true, username }) : ''}</p>
          ${locked ? '' : h`<button class="key" type="submit">${icon('unlock')}Sign in</button>
          <button class="key key--ghost" type="button" data-act="passkey" data-user="${username}" data-mode="login">${icon('key')}Use a passkey instead</button>`}
        </form>
        <div class="lock__row lock__row--split">
          <button class="key key--ghost" data-act="switch-back">Back</button>
          ${locked ? '' : h`<button class="lock__demo" data-act="demo-fill" data-user="${username}" data-prefix="sw">Demo: fill password and code</button>`}
        </div>
      </div>
    </section>`; };

  /* passkey: a simulated platform authenticator; a real one asks the person to verify on the device every time */
  LX.passkey = (root, username, done) => {
    const btn = root.querySelector('[data-act="passkey"]'); if (!btn || btn.dataset.busy) return;
    btn.dataset.busy = '1'; const old = btn.innerHTML;
    btn.innerHTML = String(h`${icon('key')}Waiting for your passkey…`);
    setTimeout(() => { delete btn.dataset.busy; btn.innerHTML = old; done(Auth.isLocked(username) ? { ok: false, locked: true, username } : { ok: true, username }); }, 1300);
  };
})();

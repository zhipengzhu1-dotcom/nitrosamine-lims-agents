/* sign.js: the signature prompt. One prompt for every Electronic Signature, built so that
   who, what meaning and exactly which Record Version are all on the same sheet, and nothing
   signs unless the person types their own user ID, password and a fresh code (or uses a passkey). */
(() => {
  'use strict';
  const LX = window.LX, { h, raw, icon } = LX, M = LX.M, T = LX.t, U = LX.U, S = LX.S, L = window.LIMS;
  const O = LX.overlay;

  const MEANING_WHY = {
    Performed: 'You did the work and recorded it.',
    Verified: 'You checked the entry against its source.',
    Reviewed: 'You reviewed the records and their audit trail.',
    Approved: 'You approve the record for use.',
    Released: 'You release the Test Report to the Customer.',
    Authored: 'You wrote the draft.',
    Acknowledged: 'You have read and understood it.',
  };

  O.register('sign', {
    layout: 'modal', strict: true, modal: true, keepDraft: false,
    init: () => ({ error: '', busy: false, sig: null, locked: false, passkey: false }),
    canClose: (st) => !st.busy,
    render: (props, st) => {
      const rec = props.record; const me = S.session.person; const stmt = L.signatureMeanings[rec.meaning];
      const since = S.session.since;
      if (st.sig) return done(rec, st);
      if (st.locked) return locked(me);
      return h`
      <header class="sg__bar"><span class="sg__bt">${icon('seal')}Electronic Signature</span><span class="sg__rt">${rec.title}</span>
        <button class="iconbtn sg__x" data-act="ov-close" aria-label="Cancel signing">${icon('x')}</button></header>
      <div class="sg__body">
        <section class="sg__what" aria-labelledby="sg-what">
          <h2 id="ov-sign-h" class="sr-only">Sign ${rec.meaning}: ${rec.title}</h2>
          <p class="sg__k" id="sg-what">Signature Meaning</p>
          <p class="sg__meaning">${rec.meaning}</p>
          <blockquote class="sg__stmt">“${stmt}”</blockquote>
          <p class="sg__k">Exactly what you are signing</p>
          <dl class="sg__rec">
            <dt>Record</dt><dd><b>${rec.title}</b></dd>
            <dt>Record Version</dt><dd class="mono"><b>${rec.version}</b></dd>
            <dt>Content hash, SHA-256</dt><dd>${U.hash(rec.hash)}<span class="sg__hn">The first 8 characters will show in the signature block.</span></dd>
          </dl>
          <ul class="sg__lines">${rec.lines.map(([a, b]) => h`<li><b>${a}</b> <span>${b}</span></li>`)}</ul>
          <p class="sg__after">${rec.after}</p>
        </section>
        <section class="sg__who" aria-labelledby="sg-who">
          <p class="sg__k" id="sg-who">Who is signing</p>
          <div class="sg__person">
            <span class="av av--me" style="--av:4rem" aria-hidden="true">${M.initials(me)}</span>
            <div><b class="sg__name">${me.name} ${U.native(me)}</b><span class="mono">${me.username}</span><span>${M.role(me)}, Lab ${L.lab.id}. Signed in on this PC since ${T.hm(since)} ${T.zone(since)}.</span></div>
          </div>
          <p class="sg__fresh">${icon('lock')}<span>Sign in again to sign. Your login session does not count.</span></p>
          <form class="cred cred--sign" data-form="sign" novalidate>
            <div class="cred__grid">
              <div class="cred__row"><label class="cred__lbl" for="sg-id">User ID</label>
                <input class="cred__in" id="sg-id" name="userid" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-first></div>
              <div class="cred__row"><label class="cred__lbl" for="sg-pw">Password</label>
                <input class="cred__in" id="sg-pw" name="password" type="password" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
              <div class="cred__row"><label class="cred__lbl" for="sg-tp">Authenticator code, 6 digits</label>
                <input class="cred__in cred__in--code" id="sg-tp" name="totp" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" spellcheck="false" placeholder="000000"></div>
              <div class="cred__row cred__row--alt"><span class="cred__lbl">Or</span>
                <button class="key key--ghost key--sm" type="button" data-act="sign-passkey">${icon('key')}${st.passkey ? 'Waiting for your passkey…' : 'Use a passkey'}</button></div>
            </div>
            <p class="cred__err" role="alert" id="sg-err" ${st.error ? '' : 'hidden'}>${st.error}</p>
            <div class="sg__keys">
              <button class="key key--ghost" type="button" data-act="ov-close">Cancel, do not sign</button>
              <button class="key" type="submit" id="sg-go" aria-disabled="true">${icon('seal')}Sign ${rec.meaning}</button>
            </div>
          </form>
          <div class="sg__aux"><span>Not ${M.firstName(me)}?</span><button class="linkbtn" data-act="sign-switch">Cancel and switch user</button>
            <button class="linkbtn" data-act="demo-fill-sign" data-user="${me.username}">Demo: fill my credentials</button></div>
        </section>
      </div>`;
    },
    mount(panel, st, props) {
      const form = panel.querySelector('form'); if (!form) return;
      const go = panel.querySelector('#sg-go');
      const check = () => { const v = LX.Cred.read(form, 'sg'); const full = v.username.trim() && v.password && v.totp.trim().length >= 6; go.setAttribute('aria-disabled', full ? 'false' : 'true'); };
      form.addEventListener('input', check); check();
      form.addEventListener('submit', (e) => { e.preventDefault(); attempt(panel, st, props); });
      go.addEventListener('click', (e) => { if (go.getAttribute('aria-disabled') === 'true') { e.preventDefault(); const empty = ['sg-id', 'sg-pw', 'sg-tp'].map((id) => panel.querySelector(`#${id}`)).find((el) => !el.value); (empty ?? panel.querySelector('#sg-id')).focus(); showErr(panel, 'Type your user ID, your password and the code from your authenticator. Nothing is signed until you do.'); } });
    },
  });

  const showErr = (panel, msg) => { const e = panel.querySelector('#sg-err'); e.textContent = msg; e.hidden = !msg; };

  function attempt(panel, st, props) {
    const form = panel.querySelector('form'); const me = S.session.person; const v = LX.Cred.read(form, 'sg');
    if (v.username.trim().toLowerCase() !== me.username) {
      showErr(panel, `This PC is signed in as ${me.username}. Only ${me.username} can sign here. To sign as someone else, cancel and switch user.`);
      panel.querySelector('#sg-id').focus(); panel.querySelector('#sg-id').select(); return;
    }
    const r = LX.Auth.verify({ username: v.username, password: v.password, totp: v.totp, mode: 'sign' });
    if (r.ok) return succeed(st, props);
    if (r.locked) { st.locked = true; O.update('sign'); return; }
    showErr(panel, LX.Auth.message(r));
    const pw = panel.querySelector('#sg-pw'); const tp = panel.querySelector('#sg-tp'); pw.value = ''; tp.value = ''; form.dispatchEvent(new Event('input')); pw.focus();
    form.classList.remove('is-shake'); void form.offsetWidth; form.classList.add('is-shake');
  }

  function succeed(st, props) {
    const me = S.session.person; const rec = props.record; const at = T.now();
    const sig = { personId: me.id, meaning: rec.meaning, at: at.toISOString(), version: rec.version, hash: rec.hash, recordId: rec.id };
    st.sig = sig;
    if (props.ctx === 'ws') LX.workspace.onSigned(sig); else if (props.ctx === 'check') LX.checks.onSigned(sig, props);
    O.update('sign');
  }

  const done = (rec, st) => h`
    <header class="sg__bar sg__bar--ok"><span class="sg__bt">${icon('ok')}Signed</span><span class="sg__rt">${rec.title}</span></header>
    <div class="sg__done">
      <div class="sg__doneL">${U.sig(st.sig, { animate: true })}</div>
      <div class="sg__doneR">
        <p class="sg__ok">${icon('ok', 'ico--l')}${rec.done}</p>
        <button class="key" data-act="ov-close" data-first>${rec.doneKey ?? 'Back to the record'}</button>
        <p class="muted">A signature cannot be withdrawn. If the record changes, it shows as unsigned again.</p>
      </div>
    </div>`;
  const locked = (me) => h`
    <header class="sg__bar sg__bar--bad"><span class="sg__bt">${icon('lock')}Account locked</span><button class="iconbtn sg__x" data-act="ov-close" aria-label="Close">${icon('x')}</button></header>
    <div class="sg__done"><div class="sg__doneL"><p class="sg__ok sg__ok--bad">${icon('alert', 'ico--l')}${me.username} is locked after ${L.demoCredentials.lockoutAfterFailures} failed attempts in a row.</p>
      <p>Nothing was signed. An Admin has to unlock the account. Until then this PC is locked to ${M.firstName(me)}; someone else can take it over.</p></div>
      <div class="sg__doneR"><button class="key" data-act="sign-lockpc" data-first>${icon('lock')}Lock this PC</button><button class="key key--ghost" data-act="sign-switch">${icon('swap')}Take over as someone else</button></div></div>`;

  LX.actions['sign-passkey'] = (el) => {
    const inst = O.top(); if (!inst || inst.kind !== 'sign' || inst.st.passkey) return; const me = S.session.person;
    inst.st.passkey = true; el.innerHTML = String(h`${icon('key')}Waiting for your passkey…`);
    setTimeout(() => { inst.st.passkey = false; if (LX.Auth.isLocked(me.username)) { inst.st.locked = true; O.update('sign'); } else succeed(inst.st, inst.props); }, 1300);
  };
  LX.actions['sign-switch'] = () => { const me = S.session.person; O.close('sign', { restore: false, immediate: true }); LX.Switch.open({}); void me; };
  LX.actions['sign-lockpc'] = () => { O.close('sign', { restore: false, immediate: true }); LX.Session.lock('manual'); };
  LX.actions['demo-fill-sign'] = (el) => { const panel = O.top()?.el; if (panel) { LX.Cred.demoFill(panel, el.dataset.user, 'sg'); panel.querySelector('#sg-tp')?.focus(); } };
})();

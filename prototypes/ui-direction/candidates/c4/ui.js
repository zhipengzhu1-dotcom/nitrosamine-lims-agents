'use strict';
/* Ledger & Rail · components every screen shares.
   The ledger (main area) is for reading; the rail (bottom band) is where hands act.
   Sheets rise out of the rail and keep its footer, so the signer's name and the confirm button never move. */

const icon = (name, cls = '') => raw(`<svg class="ic ${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`);
const currentUser = () => PEOPLE[S.userId];

/* ================= Status vocabulary: glyph + word + colour role ================= */

/* Test state: eight pips show the position in the lifecycle, the word names it. */
function pips(state) {
  const n = FORWARD_STATES.indexOf(state);
  const cells = FORWARD_STATES.map((_, i) => `<i class="${n < 0 ? 'x' : i < n ? 'on' : i === n ? 'cur' : ''}"></i>`).join('');
  return raw(`<span class="pips${n < 0 ? ' exit' : ''}" aria-hidden="true">${cells}</span>`);
}
const stateTag = (state) => h`<span class="state">${pips(state)}<span class="state-name">${state}</span></span>`;
const gxpTag = (g) => (g === 'GMP'
  ? h`<span class="tag gmp" title="GxP Class GMP">GMP</span>`
  : h`<span class="tag nongmp" title="GxP Class non-GMP: skips Reviewer and QA release">non-GMP</span>`);
const serviceTag = (s) => (s === 'Expedited' ? h`<span class="svc exp">» Expedited</span>` : h`<span class="svc">Standard</span>`);

const FITNESS = { 'In use': ['ok', 'dot'], Quarantined: ['warn', 'dashed'], Suspended: ['bad', 'slash'], Expired: ['bad', 'hourglass'], Retired: ['neutral', 'retired'] };
const fitnessTag = (f) => { const [c, i] = FITNESS[f] || ['neutral', 'dot']; return h`<span class="tag ${c}">${icon(i)}${f}</span>`; };

const CHECK_STATUS = { Done: ['ok', 'check'], Due: ['due', 'ring'], 'Due soon': ['warn', 'half'], Overdue: ['bad', 'alarm'], Blocked: ['bad', 'slash'], 'Not used today': ['neutral', 'dash'] };
const checkTag = (s, label = s) => { const [c, i] = CHECK_STATUS[s]; return h`<span class="tag ${c}">${icon(i)}${label}</span>`; };

const holdTag = (n) => h`<span class="tag hold">${icon('hold')}${n} ${n === 1 ? 'Hold' : 'Holds'}</span>`;
const devTag = (d) => h`<span class="tag dev ${d.risk.toLowerCase()}" title="${d.id} · ${d.kind} · ${d.risk} · ${d.state}">${icon('dev')}${d.id}</span>`;
const riskTag = (risk) => h`<span class="tag dev ${risk.toLowerCase()}">${risk}</span>`;
const passTag = (pass, yes = 'Pass', no = 'Fail') => (pass ? h`<span class="tag ok">${icon('check')}${yes}</span>` : h`<span class="tag bad">${icon('cross')}${no}</span>`);
const draftTag = (label = 'Draft') => h`<span class="tag draft">${icon('pencil')}${label}</span>`;

/* Due: overdue and at-risk are words in a tag, not just a red date. */
function dueInfo(t) {
  if (!t.dueDate) return { kind: 'none' };
  const bd = businessDaysFromToday(t.dueDate);
  if (t.dueDate < LAB_DAY) return { kind: 'overdue', late: calendarDaysLate(t.dueDate), bd };
  if (bd <= 2 && t.state !== 'Reviewed') return { kind: 'risk', bd };
  return { kind: 'ok', bd };
}
function dueWords(d) {
  if (d.kind === 'overdue') return `Overdue ${d.late} d`;
  if (d.bd === 0) return 'Due today';
  if (d.bd === 1) return 'Due tomorrow';
  return `in ${d.bd} business days`;
}
function dueTag(t) {
  const d = dueInfo(t);
  if (d.kind === 'none') return h`<span class="muted">not set until Ready</span>`;
  if (d.kind === 'overdue') return h`<span class="tag bad">${icon('alarm')}Overdue ${d.late} d</span>`;
  if (d.kind === 'risk') return h`<span class="tag warn">${icon('clock')}At risk · ${d.bd === 0 ? 'due today' : d.bd === 1 ? 'due tomorrow' : `${d.bd} bd`}</span>`;
  return h`<span class="muted">in ${d.bd} bd</span>`;
}

/* ================= Identity ================= */
function badge(p, size = '') {
  return h`<span class="badge ${size}" style="--badge:${badgeColor(p)}">
    <svg class="ring" viewBox="0 0 48 48" aria-hidden="true"><circle class="ring-track" cx="24" cy="24" r="22.5"/><circle class="ring-left" cx="24" cy="24" r="22.5" pathLength="100"/></svg>
    <span class="ini" aria-hidden="true">${initials(p.name)}</span></span>`;
}
const nativeName = (p) => (p.nativeName ? h` <span class="native" lang="${NATIVE_LANG[p.id] || 'und'}">${p.nativeName}</span>` : '');
function identityBlock(p) {
  return h`<div class="rail-id" role="group" aria-label="Signed in on this PC: ${p.name}, ${roleOf(p)}">
    ${badge(p)}
    <span class="id-text">
      <span class="id-name">${p.name}${nativeName(p)}</span>
      <span class="id-meta">${roleOf(p)} · <span class="mono">${p.username}</span></span>
    </span>
  </div>`;
}

/* ================= Buttons ================= */
/* rbtn = rail button (glove size, on graphite). bbtn = bench button in the ledger (glove size, on paper). */
function rbtn({ act, arg = '', label, sub = '', ic = '', kind = '', disabled = false, title = '', type = 'button', form = '', k = '' }) {
  return h`<button type="${type}" class="rbtn ${kind}" ${act ? raw(`data-act="${esc(act)}"`) : ''} data-arg="${arg}" data-k="${k || act || ''}"${form ? raw(` form="${esc(form)}"`) : ''}${disabled ? raw(' disabled') : ''}${title ? raw(` title="${esc(title)}"`) : ''}>${ic ? icon(ic) : ''}${sub ? h`<span class="two"><span>${label}</span><small>${sub}</small></span>` : label}</button>`;
}
/* The Lock button also carries the idle countdown: it says when it will press itself. */
const lockButton = () => h`<button type="button" class="rbtn lockbtn" data-act="lock" data-k="lock" title="Lock this PC now. From the lock screen someone else can sign in.">${icon('lock')}<span class="two"><span>Lock or switch</span><small class="idle-text">${idleText()}</small></span></button>`;
function railInner({ context = '', actions = [] } = {}) {
  return h`${identityBlock(currentUser())}${lockButton()}<div class="rail-context">${context}</div><div class="rail-actions">${actions}</div>`;
}

/* ================= Sheets ================= */
function sheetFrame({ cls = '', body, context = '', actions = [] }) {
  return h`<div class="scrim"></div>
  <section class="sheet ${cls}" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
    <div class="sheet-body">${body}</div>
    <div class="rail sheet-foot" role="group" aria-label="Signed-in person and actions">${railInner({ context, actions })}</div>
  </section>`;
}

/* ================= Keypad (glove entry without the OS keyboard covering the screen) ================= */
const KEY_LABEL = { back: 'Delete one character', clear: 'Clear the field', sign: 'Change sign', next: 'Next field', '.': 'Decimal point' };
function keypad(mode = 'decimal', forId = '') {
  const keys = mode === 'digits'
    ? [['7'], ['8'], ['9'], ['back'], ['4'], ['5'], ['6'], ['clear', 'Clear'], ['1'], ['2'], ['3'], ['next', 'Next'], ['0']]
    : [['7'], ['8'], ['9'], ['back'], ['4'], ['5'], ['6'], ['clear', 'Clear'], ['1'], ['2'], ['3'], ['sign', '±'], ['0'], ['.'], ['next', 'Next']];
  return h`<div class="keypad ${mode}" role="group" aria-label="${forId ? 'Number pad for the authenticator code' : 'Number pad'}"${forId ? raw(` data-for="${esc(forId)}"`) : ''}>${keys.map(([k, t = k]) => h`<button type="button" class="key k-${k === '.' ? 'dot' : k}" data-key="${k}" tabindex="-1" aria-label="${KEY_LABEL[k] || t}">${k === 'back' ? icon('back') : t}</button>`)}</div>`;
}

/* ================= Signature ================= */
const hashView = (hex) => h`${hashGroups(hex).map((g, i) => (i === 0 ? h`<mark>${g}</mark> ` : h`<span>${g}</span> `))}`;
function signSheet(sh) {
  const u = currentUser();
  const c = sh.ctx;
  const cred = L.demoCredentials.users[u.username];
  const body = h`<div class="sign-grid">
    <section class="sign-what" aria-label="What you are signing">
      <p class="overline">${icon('nib')} Electronic Signature</p>
      <h2 id="sheet-title" tabindex="-1" class="sign-title">Sign <span class="meaning-word">${c.meaning}</span> · ${c.recordId}</h2>
      <div class="meaning-card">
        <p class="overline">Signature Meaning</p>
        <p class="meaning-big">${c.meaning}</p>
        <blockquote class="statement">“${MEANINGS[c.meaning]}”</blockquote>
      </div>
      <div class="record-card">
        <p class="overline">Exactly what is signed</p>
        <p class="rec-title">${c.recordTitle}</p>
        <dl class="kv">
          <dt>Record</dt><dd class="mono">${c.recordId}</dd>
          <dt>Record Version</dt><dd><b class="big-num">${c.recordVersion}</b></dd>
          <dt>SHA-256</dt><dd class="hash mono">${hashView(c.sha)}</dd>
          ${c.lines.map(([k, v]) => h`<dt>${k}</dt><dd>${v}</dd>`)}
        </dl>
        <p class="consequence-line">${icon('arrow')}<span>${c.consequence}</span></p>
      </div>
    </section>
    <form class="sign-who" id="sign-form" data-form="sign" autocomplete="off" novalidate>
      <p class="overline">Who is signing</p>
      <div class="signer">${badge(u, 'lg')}<div><p class="signer-name">${u.name}${nativeName(u)}</p><p class="signer-meta"><span class="mono">${u.username}</span> · ${roleOf(u)} · ${L.lab.name} (${L.lab.id})</p></div></div>
      <p class="sign-rule">Type all three again: being signed in does not count. Only <b>${u.name}</b> can sign on this PC now, so the user ID must be <b class="mono">${u.username}</b>.</p>
      <div class="sign-fields">
        <div class="fields-col">
          <label class="fld"><span class="fld-l">User ID</span><input id="sg-user" name="user" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
          <label class="fld"><span class="fld-l">Password</span><input id="sg-pass" name="pass" type="password" autocomplete="off"></label>
          <label class="fld"><span class="fld-l">Authenticator code <small>6 digits, fresh</small></span><input id="sg-code" name="code" class="num code mono" inputmode="none" maxlength="6" autocomplete="off"></label>
        </div>
        ${keypad('digits', 'sg-code')}
      </div>
      <div class="sign-error" id="sign-error" role="alert">${sh.error ? errorBox(sh.error) : ''}</div>
      <div class="sign-alt"><button type="button" class="bbtn ghost" disabled>${icon('key')}Use a passkey</button><span>No passkey is enrolled for <span class="mono">${u.username}</span> on this PC.</span></div>
      ${cred ? h`<p class="demo-note">Demo only: password <b class="mono">${cred.password}</b> · code <b class="mono">${cred.totp}</b></p>` : ''}
    </form>
  </div>`;
  return sheetFrame({
    cls: 'tall sign-sheet',
    body,
    context: h`<span class="ctx-line">Nothing is signed until you press <b>Sign ${c.meaning}</b>.</span><span class="ctx-line">Cancel signs nothing and keeps your work.</span>`,
    actions: [
      rbtn({ act: 'sheet-cancel', label: 'Cancel', k: 'sign-cancel' }),
      rbtn({ label: `Sign ${c.meaning}`, ic: 'nib', kind: 'primary sign-btn', type: 'submit', form: 'sign-form', disabled: true, k: 'sign-submit' }),
    ],
  });
}
const errorBox = (e) => h`<div class="err">${icon('alarm')}<div><b>${e.title}</b><p>${e.body}</p></div></div>`;

function sigBlock(sig) {
  return h`<div class="sigblock" aria-label="Electronic Signature">
    <p class="sig-meaning">${icon('nib')}<span>Signed · ${sig.meaning}</span></p>
    <dl class="kv sig-kv">
      <dt>Signed by</dt><dd><b>${sig.name}</b> (<span class="mono">${sig.username}</span>) · ${sig.role}</dd>
      <dt>Time</dt><dd><span class="mono">${fmtUtcFull(sig.at)}</span> · <span class="mono">${fmtLocalFull(sig.at)}</span> <span class="muted">(${ZONE_LONG})</span></dd>
      <dt>Record</dt><dd><span class="mono">${sig.recordId}</span> · Record Version <b>${sig.recordVersion}</b> · SHA-256 <b class="mono">${sig.sha.slice(0, 8)}</b></dd>
      <dt>Statement</dt><dd>“${MEANINGS[sig.meaning]}”</dd>
    </dl>
  </div>`;
}

/* ================= Toasts ================= */
let toastSeq = 0;
const TOAST_ICON = { ok: 'check', info: 'info', warn: 'dev', bad: 'dev', audit: 'audit' };
/* Receipts: one at a time, bottom-left above the signed-in name, never over the acting side of the screen. */
function toast(kind, title, body = '') {
  const id = ++toastSeq;
  S.toasts = [{ id, kind, title, body }];
  renderToasts();
  setTimeout(() => dismissToast(id), 9000);
}
function dismissToast(id) { S.toasts = S.toasts.filter((t) => t.id !== id); renderToasts(); }
function renderToasts() {
  $('#toasts').innerHTML = String(h`${S.toasts.slice(-1).map((t) => h`<div class="toast ${t.kind}">${icon(TOAST_ICON[t.kind] || 'info')}<div class="toast-text"><b>${t.title}</b>${t.body ? h`<p>${t.body}</p>` : ''}</div><button type="button" class="toast-x" data-act="toast-x" data-arg="${t.id}" aria-label="Dismiss this message">${icon('cross')}</button></div>`)}`);
}

/* ================= Lock screen, takeover, lockout ================= */
const DEMO_USERS = Object.keys(L.demoCredentials.users).map((u) => BY_USERNAME[u]);
function lockScreen() {
  const lk = S.lock;
  const who = PEOPLE[lk.mode === 'switch' ? lk.sessionUserId : lk.userId];
  const top = h`<div class="lock-bar"><span>${icon('pc')}${WORKSTATION} · ${L.lab.name} (${L.lab.id})</span><span class="clock mono">${fmtClock(nowMs())}</span><span class="fictional">${icon('info')}Fictional data</span></div>`;
  let main;
  if (lk.mode === 'lockout') {
    main = h`<div class="lock-card">
      <div class="lock-who">${badge(who, 'xl')}<div><p class="overline bad-ink">${icon('slash')} Account locked</p><h1 id="lock-h">${who.name}</h1><p class="lock-meta"><span class="mono">${who.username}</span> · ${roleOf(who)} · locked ${fmtLocal(lk.at)}</p></div></div>
      <p class="lock-explain">${MAX_FAILURES} failed attempts in a row, at sign-in or signing, locked <b class="mono">${who.username}</b>. An Admin must unlock the account; nobody unlocks their own. Nothing was signed.</p>
      <div class="lock-actions">${h`<button type="button" class="bbtn primary" data-act="lock-switch">${icon('swap')}Someone else signs in</button><button type="button" class="bbtn ghost" data-act="reset-demo">Reset the demo</button>`}</div>
    </div>`;
  } else if (lk.mode === 'switch') {
    const picked = lk.picked;
    main = h`<div class="lock-card wide">
      <div class="lock-card-top"><div><p class="overline">${icon('swap')} Switch user on this PC</p><h1 id="lock-h">Who is signing in?</h1></div><button type="button" class="bbtn ghost" data-act="lock-back">${who ? h`Back to ${firstName(who)}'s lock screen` : 'Back'}</button></div>
      <div class="user-tiles" role="radiogroup" aria-label="Recent on this PC">
        ${DEMO_USERS.map((p) => h`<button type="button" role="radio" aria-checked="${tf(picked === p.username)}" class="user-tile" data-act="pick-user" data-arg="${p.username}">${badge(p)}<span><b>${p.name}</b>${nativeName(p)}<small>${roleOf(p)} · <span class="mono">${p.username}</span>${S.lockedAccounts[p.username] ? ' · account locked' : p.id === lk.sessionUserId ? ' · session open' : ''}</small></span></button>`)}
        <button type="button" role="radio" aria-checked="${tf(picked === '')}" class="user-tile other" data-act="pick-user" data-arg="">${icon('user')}<span><b>Someone else</b><small>Type your user ID</small></span></button>
      </div>
      ${picked == null ? h`<p class="lock-explain">Tap your name. ${who ? h`<b>${who.name}</b>'s session ends when you sign in; anything ${firstName(who)} has not signed stays saved under ${firstName(who)}'s name.` : ''}</p>` : signinForm('signin', picked, who)}
    </div>`;
  } else {
    main = h`<div class="lock-card">
      <div class="lock-who">${badge(who, 'xl')}<div><p class="overline">${icon('lock')} This PC is locked${lk.reason === 'idle' ? ' after 15 minutes idle' : ''}</p><h1 id="lock-h">${who.name}${nativeName(who)}</h1><p class="lock-meta"><span class="mono">${who.username}</span> · ${roleOf(who)} · locked ${fmtLocal(lk.at)}</p></div></div>
      ${signinForm('unlock', who.username, who)}
      <div class="lock-or"><p>Not ${firstName(who)}?</p><button type="button" class="bbtn" data-act="lock-switch">${icon('swap')}Switch user</button><p class="small">Ends ${firstName(who)}'s session. Nothing of ${firstName(who)}'s is signed; unsigned work stays saved under ${firstName(who)}'s name.</p></div>
    </div>`;
  }
  return h`<div class="lock" role="dialog" aria-modal="true" aria-labelledby="lock-h">${top}<div class="lock-main">${main}</div></div>`;
}
function signinForm(kind, username, prev) {
  const cred = username ? L.demoCredentials.users[username] : null;
  const fixed = kind === 'unlock' || !!username;
  const err = S.lock.error;
  return h`<form class="signin" id="signin-form" data-form="${kind}" autocomplete="off" novalidate>
    <div class="signin-grid">
      <div class="fields-col">
        <label class="fld"><span class="fld-l">User ID</span><input id="si-user" name="user" value="${username || ''}" ${fixed ? raw('readonly') : ''} autocomplete="off" autocapitalize="none" spellcheck="false"></label>
        <label class="fld"><span class="fld-l">Password</span><input id="si-pass" name="pass" type="password" autocomplete="off"></label>
        <label class="fld"><span class="fld-l">Authenticator code <small>6 digits</small></span><input id="si-code" name="code" class="num code mono" inputmode="none" maxlength="6" autocomplete="off"></label>
      </div>
      ${keypad('digits', 'si-code')}
    </div>
    <div class="sign-error" role="alert">${err ? errorBox(err) : ''}</div>
    <button type="submit" class="bbtn primary wide">${icon(kind === 'unlock' ? 'lock' : 'arrow')}${kind === 'unlock' ? `Unlock as ${PEOPLE[prev.id].name}` : 'Sign in'}</button>
    ${kind === 'signin' && prev ? h`<p class="lock-explain small">Signing in ends <b>${prev.name}</b>'s session on this PC. Unsigned work stays saved under ${firstName(prev)}'s name.</p>` : ''}
    ${cred ? h`<p class="demo-note">Demo only: password <b class="mono">${cred.password}</b> · code <b class="mono">${cred.totp}</b></p>` : h`<p class="demo-note">Demo accounts: ${DEMO_USERS.map((p) => p.username).join(', ')}</p>`}
  </form>`;
}

/* core.js: data access, store, deep-link router, the frame (top bar + bench rail),
   shared status components, the shared-PC lock/takeover, and the signature prompt.
   Views (queue.js, workspace.js, checks.js) register on App.views and read App.lib. */
(function () {
  'use strict';
  const L = window.LIMS;
  const App = (window.App = { views: {}, act: {}, lib: {} });

  /* ---------- DOM and text helpers ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
  const initials = (name) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  /* ---------- this shared PC (configuration of the PC, not of the person) ---------- */
  const WORKSTATION = { name: 'Bench PC RD-102-02', room: 'RD-102' };

  /* ---------- server answers, indexed ---------- */
  const idx = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
  const DB = {
    people: idx(L.people), customers: idx(L.customers), products: idx(L.products), methods: idx(L.methods),
    samples: idx(L.samples), equipment: idx(L.equipment), deviations: idx(L.deviations), rooms: idx(L.rooms),
    byUsername: Object.fromEntries(L.people.map((p) => [p.username, p])),
  };
  const analysts = L.people.filter((p) => p.roles.includes('Analyst'));
  const stationLine = () => `${WORKSTATION.name}, in ${WORKSTATION.room} ${DB.rooms[WORKSTATION.room] ? DB.rooms[WORKSTATION.room].name : ''}`.trim();
  // New Deviations continue the server's numbering: one past the highest ID in the data.
  const nextDevSeq = () => 1 + Math.max(0, ...L.deviations.map((d) => Number((d.id.match(/(\d+)$/) || [0, 0])[1])));

  /* ---------- clock: the data's "now", advancing in real time ---------- */
  const NOW0 = Date.parse(L.meta.now);
  const T0 = Date.now();
  const now = () => new Date(NOW0 + (Date.now() - T0));
  const OFF_MS = L.meta.utcOffsetHours * 3600e3;
  const ZONE = 'EDT';
  const IANA = L.meta.labZone;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const p2 = (n) => String(n).padStart(2, '0');
  const loc = (d) => new Date(new Date(d).getTime() + OFF_MS); // read with getUTC*
  const fmt = {
    hm: (d) => { const x = loc(d); return `${p2(x.getUTCHours())}:${p2(x.getUTCMinutes())}`; },
    hmUtc: (d) => { const x = new Date(d); return `${p2(x.getUTCHours())}:${p2(x.getUTCMinutes())}`; },
    dm: (d) => { const x = loc(d); return `${x.getUTCDate()} ${MON[x.getUTCMonth()]}`; },
    stamp: (d) => `${fmt.dm(d)} ${fmt.hm(d)}`,
    day: (day) => { const x = new Date(day + 'T12:00:00Z'); return `${DOW[x.getUTCDay()]} ${x.getUTCDate()} ${MON[x.getUTCMonth()]}`; },
    dayLong: (d) => { const x = loc(d); return `${DAY[x.getUTCDay()]} ${x.getUTCDate()} ${MONTH[x.getUTCMonth()]} ${x.getUTCFullYear()}`; },
    isoLocal: (d) => { const x = loc(d); return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())} ${p2(x.getUTCHours())}:${p2(x.getUTCMinutes())}:${p2(x.getUTCSeconds())}`; },
    isoUtc: (d) => { const x = new Date(d); return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())} ${p2(x.getUTCHours())}:${p2(x.getUTCMinutes())}:${p2(x.getUTCSeconds())}`; },
    dur: (ms) => { const m = Math.max(0, Math.round(ms / 60000)); if (m < 1) return 'under a minute'; if (m < 60) return `${m} min`; const h = Math.floor(m / 60); if (h < 48) return `${h} h`; return `${Math.floor(h / 24)} d`; },
    int: (n) => n.toLocaleString('en-US'),
    hash8: (h) => h.slice(0, 8),
    hashGroups: (h) => h.match(/.{8}/g).join(' '),
  };

  /* ---------- business days (same calendar as the server) ---------- */
  const HOLIDAYS = new Set(['2026-09-07']);
  const isBD = (day) => { const wd = new Date(day + 'T12:00:00Z').getUTCDay(); return wd !== 0 && wd !== 6 && !HOLIDAYS.has(day); };
  const addBD = (day, n) => { let d = new Date(day + 'T12:00:00Z'); let left = n; while (left > 0) { d = new Date(d.getTime() + 864e5); if (isBD(d.toISOString().slice(0, 10))) left--; } return d.toISOString().slice(0, 10); };
  const bdBetween = (a, b) => { let n = 0; let d = a; while (d < b) { d = addBD(d, 1); n++; } return n; };
  const calDays = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
  const LAB_DAY = L.meta.labDay;
  const RISK_UNTIL = addBD(LAB_DAY, 2);

  /* ---------- SHA-256 (synchronous, UTF-8) for records the prototype creates ---------- */
  const K256 = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256Bytes(bytes) {
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const len = bytes.length;
    const total = Math.ceil((len + 9) / 64) * 64;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(len / 0x20000000));
    dv.setUint32(total - 4, (len * 8) >>> 0);
    const W = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) >>> 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
  }
  const sha256 = (text) => sha256Bytes(new TextEncoder().encode(text));
  // Canonical JSON: sorted keys, so the same content always hashes the same.
  const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));

  /* ---------- Test vocabulary ---------- */
  const MAIN_PATH = ['Requested', 'Accepted', 'Ready', 'Assigned', 'In Progress', 'Submitted for Review', 'Reviewed', 'Reported'];
  const OPEN_STATES = MAIN_PATH.slice(0, 7);
  const PRE_REVIEW = MAIN_PATH.slice(0, 5);
  const dueStatus = (t) => {
    if (!OPEN_STATES.includes(t.state) || !t.dueDate) return 'none';
    if (t.dueDate < LAB_DAY) return 'overdue';
    if (t.dueDate <= RISK_UNTIL && PRE_REVIEW.includes(t.state)) return 'risk';
    return 'ok';
  };
  const stateSince = (t) => t.history[t.history.length - 1].at;
  const person = (id) => DB.people[id];
  const blocksText = (b) => b.split(';').map((s) => s.trim()).map((s) => (s.startsWith('→') ? `moving to ${s.slice(1).trim()}` : s.charAt(0).toLowerCase() + s.slice(1))).join('; ');
  const deviation = (id) => DB.deviations[id] || App.S.newDevs[id];
  const fitnessOf = (id) => App.S.fitness[id] || DB.equipment[id];

  /* ---------- shared status components (word + glyph + colour) ---------- */
  const track = (state) => {
    const i = MAIN_PATH.indexOf(state);
    const cells = MAIN_PATH.map((_, k) => `<i class="${i >= 0 && k <= i ? 'on' : ''}"></i>`).join('');
    return `<span class="track${i < 0 ? ' track--exit' : ''}" aria-hidden="true">${cells}</span>`;
  };
  const stateTag = (t, withAge = true) => `<span class="state"><span class="state__name">${esc(t.state)}</span></span>${withAge ? `<span class="sub state__age">${track(t.state)}for ${fmt.dur(now() - new Date(stateSince(t)))}</span>` : ''}`;
  const holdTip = (h) => `${h.kind}: ${h.reason}. Blocks ${blocksText(h.blocks)}.`;
  const holdTag = (holds) => (holds.length ? `<span class="tag tag--hold" title="${esc(holds.map(holdTip).join('\n'))}">${ic('hold')}${plural(holds.length, 'Hold')}</span>` : '');
  const devTag = (id) => {
    const d = deviation(id);
    return `<span class="tag tag--dev tag--${d.risk.toLowerCase()}" title="${esc(`${d.id}, ${d.kind}, Risk Level ${d.risk}, ${d.state}: ${d.title}`)}">${ic('dev')}${esc(d.id)}<span class="tag__risk">${esc(d.risk)}</span></span>`;
  };
  const riskTag = (risk) => `<span class="risk risk--${risk.toLowerCase()}">${esc(risk)}</span>`;
  const gxpTag = (g) => `<span class="gxp ${g === 'GMP' ? 'gxp--gmp' : 'gxp--non'}">${esc(g)}</span>`;
  const FIT = { 'In use': ['ok', 'check'], Quarantined: ['warn', 'quarantine'], Suspended: ['bad', 'noentry'], Expired: ['bad', 'hourglass'], Retired: ['idle', 'retired'] };
  const fitTag = (status, reason, opts = {}) => {
    const [tone, glyph] = FIT[status] || ['idle', 'todo'];
    return `<span class="fit fit--${tone}${opts.compact ? ' fit--compact' : ''}" title="${esc(reason ? `${status}: ${reason}` : status)}">${ic(glyph)}<span class="fit__word">${esc(status)}</span></span>${reason && !opts.compact ? `<span class="fit__why">${esc(reason)}</span>` : ''}`;
  };
  const dueCell = (t) => {
    if (!t.dueDate) return `<span class="due due--none">Not set yet</span><span class="sub">${t.tatBusinessDays} business days from Ready</span>`;
    const s = dueStatus(t);
    if (s === 'overdue') return `<span class="due due--over">${ic('overdue')}Overdue ${calDays(t.dueDate, LAB_DAY)} d</span><span class="sub">was ${fmt.day(t.dueDate)}</span>`;
    if (s === 'risk') {
      const n = bdBetween(LAB_DAY, t.dueDate);
      const when = n === 0 ? 'Due today' : n === 1 ? 'Due tomorrow' : `Due ${fmt.day(t.dueDate).split(' ')[0]}`;
      return `<span class="due due--risk">${ic('clock')}${when}</span><span class="sub">At risk, ${fmt.day(t.dueDate).split(' ').slice(1).join(' ')}</span>`;
    }
    return `<span class="due">${fmt.day(t.dueDate)}</span><span class="sub">${plural(bdBetween(LAB_DAY, t.dueDate), 'business day')}</span>`;
  };
  const sigBlock = (sig, extra = '') => `
    <section class="sig" aria-label="Electronic Signature: ${esc(sig.meaning)} by ${esc(sig.name)}">
      <header class="sig__head">${ic('sig')}<span class="sig__meaning">${esc(sig.meaning)}</span><span class="sig__kind">Electronic Signature</span></header>
      <p class="sig__statement">${esc(sig.statement)}</p>
      <dl class="sig__grid">
        <dt>Signed by</dt><dd><b>${esc(sig.name)}</b>${sig.nativeName ? ` <span class="native">${esc(sig.nativeName)}</span>` : ''}</dd>
        <dt>Username</dt><dd class="mono">${esc(sig.username)}</dd>
        <dt>Role</dt><dd>${esc(sig.role)}</dd>
        <dt>UTC</dt><dd class="num">${esc(sig.utc)}</dd>
        <dt>Lab time</dt><dd class="num">${esc(sig.local)}</dd>
        <dt>Record</dt><dd>${esc(sig.record)}, Record Version ${sig.version}</dd>
        <dt>SHA-256</dt><dd class="mono">${esc(fmt.hash8(sig.sha256))}</dd>
      </dl>${extra}
    </section>`;
  const monogram = (p, cls = '') => `<span class="mono-av ${cls}" aria-hidden="true">${esc(initials(p.name))}</span>`;
  const nameLine = (p) => `${esc(p.name)}${p.nativeName ? ` <span class="native">${esc(p.nativeName)}</span>` : ''}`;

  /* ---------- store ---------- */
  const S = (App.S = { userId: null, route: 'queue', locked: null, sign: null, failures: {}, lockedAccounts: {}, tests: [], testIdx: {}, audit: [], newDevs: {}, devSeq: nextDevSeq(), fitness: {}, sessionStart: null, lastActivity: Date.now() });
  const P = L.personas;
  const PERSONA = { queue: P.queue, assign: P.queue, test: P.test, imported: P.test, sign: P.test, checks: P.checks, 'check-fail': P.checks };
  const ROUTES = Object.keys(PERSONA);
  const TITLES = { queue: 'Lab queue', assign: 'Assign a Test', test: 'Test workspace', imported: 'Test workspace', sign: 'Sign Performed', checks: 'Checks today', 'check-fail': 'Balance verification' };
  const viewFor = (route) => (route === 'queue' || route === 'assign' ? App.views.queue : route === 'checks' || route === 'check-fail' ? App.views.checks : App.views.test);
  const home = (userId) => (userId === P.queue ? 'queue' : userId === P.test ? App.views.test.routeNow() : userId === P.checks ? 'checks' : 'queue');

  function resetData() {
    S.tests = JSON.parse(JSON.stringify(L.tests));
    S.testIdx = idx(S.tests);
    S.audit = []; S.newDevs = {}; S.devSeq = nextDevSeq(); S.fitness = {}; S.failures = {}; S.lockedAccounts = {}; S.drafts = {};
    Object.values(App.views).forEach((v) => v.reset());
  }
  function audit(what) { const entry = { at: now().toISOString(), by: S.userId, pc: WORKSTATION.name, what }; S.audit.push(entry); return entry; }
  const DEV_PREFIX = (L.deviations[0] ? L.deviations[0].id : 'DEV-26-0000').replace(/\d+$/, '');
  // An ID the server has promised to a specific record (the failed BAL-04 Check's Deviation) is never handed to another one.
  const reservedDevIds = () => { const c = L.focus.checkFail && L.focus.checkFail.consequence; return c && c.deviationId ? [c.deviationId] : []; };
  function openDeviation({ id, kind, risk, title, links }) {
    const taken = (x) => !!(DB.deviations[x] || S.newDevs[x]);
    if (!id || taken(id)) { do { id = `${DEV_PREFIX}${String(S.devSeq++).padStart(4, '0')}`; } while (taken(id) || reservedDevIds().includes(id)); }
    S.newDevs[id] = { id, kind, risk, state: 'Open', title, openedAt: now().toISOString(), investigatorId: S.userId, links };
    return S.newDevs[id];
  }

  /* ---------- router ----------
     A fresh load is a deep link: it sets the state and the person signed in. After that, the person only ever changes
     through Switch user. A later hash change (typed, Back or Forward) onto another person's screen locks the PC and asks
     for that person's credentials; onto the same person's screen it simply navigates, keeping everything they did. */
  function deepLink(route) {
    if (!ROUTES.includes(route)) route = 'queue';
    S.sign = null; S.locked = null;
    resetData();
    S.userId = PERSONA[route];
    S.sessionStart = now();
    S.route = route;
    viewFor(route).enter(route);
    show();
    if (location.hash.slice(1) !== route) history.replaceState(null, '', '#' + route);
    markActivity();
    const v = viewFor(route);
    if (S.sign) { const f = $('#sg-uid'); if (f) f.focus({ preventScroll: true }); }
    else if (v.afterEnter) v.afterEnter(route);
  }
  function visit(route) {
    App.views.queue.closeAssign && App.views.queue.closeAssign();
    if (S.sign) S.sign = null;
    const v = viewFor(route);
    let after = null;
    if (v.visit) after = v.visit(route); else S.route = route;
    history.replaceState(null, '', '#' + S.route);
    show();
    if (after) after();
  }
  function onHashChange() {
    const route = location.hash.slice(1);
    if (!ROUTES.includes(route)) { history.replaceState(null, '', '#' + S.route); return; }
    if (S.locked) { S.locked.want = route; if (PERSONA[route] !== S.locked.prevUserId) { S.locked.pick = PERSONA[route]; S.locked.uid = person(PERSONA[route]).username; } renderLayer(); return; }
    if (route === S.route) return;
    if (PERSONA[route] === S.userId) { visit(route); return; }
    lock('link', { want: route, pick: PERSONA[route] });
  }
  function go(route) {
    S.route = route;
    history.replaceState(null, '', '#' + route);
    show();
    const v = $('#view');
    if (v && !v.contains(document.activeElement) && !$('#layer').contains(document.activeElement)) v.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', onHashChange);

  /* ---------- rendering ---------- */
  function keepState(fn) {
    const scrolls = $$('[data-scroll-key]').map((el) => [el.dataset.scrollKey, el.scrollTop]);
    const active = document.activeElement;
    const fk = active && active.dataset ? active.dataset.fk : null;
    const sel = fk && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    fn();
    scrolls.forEach(([k, top]) => { const el = $(`[data-scroll-key="${k}"]`); if (el) el.scrollTop = top; });
    if (fk) { const el = $(`[data-fk="${fk}"]`); if (el) { el.focus({ preventScroll: true }); if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text input */ } } }
  }
  function show() {
    keepState(() => {
      document.title = `${TITLES[S.route]} | RD LIMS`;
      renderTop();
      const view = $('#view');
      view.dataset.route = S.route;
      viewFor(S.route).render(S.route, view);
      renderRail();
      renderLayer();
    });
  }
  function renderTop() {
    const t = now();
    const testRoute = App.views.test.routeNow();
    const place = viewFor(S.route);
    const tab = (href, label, sub, isOn) => `<a class="nav__tab" href="#${href}" data-nav="${href}"${isOn ? ' aria-current="page"' : ''}><span>${label}</span>${sub ? `<span class="nav__sub">${sub}</span>` : ''}</a>`;
    $('#top').innerHTML = `
      <div class="brand"><span class="brand__mark">RD</span><span class="brand__name">Nitrosamine LIMS</span></div>
      <nav class="nav" aria-label="Places">
        ${tab('queue', 'Lab queue', '', place === App.views.queue)}
        ${tab(testRoute, 'Test T26-04175', '', place === App.views.test)}
        ${tab('checks', 'Checks today', '', place === App.views.checks)}
      </nav>
      <span class="station" title="This shared PC: ${esc(stationLine())}. It stays the same when someone else signs in.">${ic('pc')}<span>${esc(WORKSTATION.name)}</span></span>
      <div class="clock" role="group" aria-label="Lab time"><span class="clock__local num" id="clock-local">${DOW[loc(t).getUTCDay()]} ${fmt.dm(t)}, ${fmt.hm(t)} ${ZONE}</span><span class="clock__utc num" id="clock-utc">${fmt.hmUtc(t)} UTC</span></div>
      <span class="fict" title="${esc(L.meta.note)}">Fictional data</span>`;
  }

  /* The bench rail: identity at the left, the view's context and commit actions, then Switch user and Lock. */
  function rbtn(a) {
    const cls = a.kind === 'primary' ? 'rbtn rbtn--primary' : a.kind === 'danger' ? 'rbtn rbtn--danger' : 'rbtn rbtn--secondary';
    return `<button type="button" class="${cls}" data-act="${a.act}"${a.arg ? ` data-arg="${esc(a.arg)}"` : ''}${a.disabled ? ` aria-disabled="true" title="${esc(a.why || '')}"` : ''}${a.fk ? ` data-fk="${a.fk}"` : ''}>${a.icon ? ic(a.icon) : ''}<span>${esc(a.label)}</span></button>`;
  }
  function whoPlate(p, extra = '') {
    return `<div class="who">${monogram(p)}<span class="who__text"><span class="who__name">${esc(p.name)}</span><span class="who__meta">${p.nativeName ? `<span class="native">${esc(p.nativeName)}</span>, ` : ''}${esc(p.roles.join(' and '))}, <span class="mono">${esc(p.username)}</span></span>${extra}</span></div>`;
  }
  function renderRail() {
    const p = person(S.userId);
    const spec = viewFor(S.route).rail(S.route);
    let r = S.receipt && S.receipt.until > Date.now() ? S.receipt : null;
    if (r && r.forAct && (spec.actions || []).some((a) => a.act === r.forAct && !a.disabled)) { S.receipt = null; r = null; }
    const context = r ? `<span class="ctx__main">${ic(r.icon)}${esc(r.title)}</span><span class="ctx__sub ctx__sub--wrap">${r.body}</span>` : spec.context || '';
    $('#rail').innerHTML = `
      ${whoPlate(p, `<span class="who__idle" id="idle-line">Signed in ${fmt.hm(S.sessionStart)}. Locks after 15 min idle.</span>`)}
      <div class="rail__context${r ? ` rail__context--receipt rail__context--${r.tone}` : ''}" id="rail-context">${context}</div>
      <div class="rail__actions">${(spec.actions || []).map(rbtn).join('')}</div>
      <div class="rail__session">
        <button type="button" class="rbtn rbtn--quiet" data-act="switch-user">${ic('switch')}<span>Switch user</span></button>
        <button type="button" class="rbtn rbtn--quiet" data-act="lock">${ic('lock')}<span>Lock</span></button>
      </div>`;
  }
  function renderLayer() {
    const layer = $('#layer');
    if (S.locked) layer.innerHTML = lockHTML();
    else if (S.sign) layer.innerHTML = signHTML();
    else layer.innerHTML = '';
    document.body.classList.toggle('is-locked', !!S.locked);
  }

  /* ---------- receipts: the system answers in the rail, where the hand just acted ---------- */
  let receiptTimer = null;
  function receipt({ title, body = '', tone = 'ok', icon = 'check', ms = 7000, forAct = null }) {
    S.receipt = { title, body, tone, icon, forAct, until: Date.now() + ms };
    const live = $('#live'); if (live) live.textContent = `${title}. ${body.replace(/<[^>]+>/g, '')}`;
    renderRail();
    clearTimeout(receiptTimer);
    receiptTimer = setTimeout(() => { S.receipt = null; if (!S.locked) renderRail(); }, ms);
  }

  /* ---------- shared PC: lock, idle lock, takeover ---------- */
  const DEMO = L.demoCredentials;
  const demoUsers = Object.keys(DEMO.users).map((u) => DB.byUsername[u]).filter(Boolean);
  function lock(reason, opts = {}) {
    if (S.locked) return;
    if (S.sign) S.sign = null;
    const pick = opts.pick || (reason === 'switch' || reason === 'lockout' ? null : S.userId);
    S.locked = { reason, prevUserId: S.userId, at: now(), pick, uid: pick ? person(pick).username : '', want: opts.want || null, error: null, closing: false };
    const opener = document.activeElement;
    renderLayer();
    const first = $('#layer .tile[aria-checked="true"]') || $('#layer .tile');
    if (first) first.focus();
    S.locked.opener = opener;
  }
  function lockHTML() {
    const k = S.locked;
    const prev = person(k.prevUserId);
    const t = now();
    const picked = k.pick ? person(k.pick) : null;
    const same = picked && picked.id === k.prevUserId;
    const wantName = k.want ? person(PERSONA[k.want]).name : '';
    const why = k.reason === 'lockout' ? `${prev.name}'s account (${prev.username}) was locked at ${fmt.hm(k.at)} after ${DEMO.lockoutAfterFailures} failed attempts in a row while signing. Nothing was signed. An Admin must unlock the account; someone else can sign in now.` : k.reason === 'idle' ? `Locked after 15 minutes without activity, at ${fmt.hm(k.at)}.` : k.reason === 'switch' ? `${prev.name} handed over this PC at ${fmt.hm(k.at)}.` : k.reason === 'link' ? `A link opened ${wantName}'s screen (${TITLES[k.want]}) at ${fmt.hm(k.at)}. Only the person signed in can change, and only through a sign-in.` : `Locked by ${prev.name} at ${fmt.hm(k.at)}.`;
    const tiles = [prev, ...demoUsers.filter((u) => u.id !== prev.id)].map((u) => `
      <button type="button" class="tile" role="radio" aria-checked="${k.pick === u.id}" data-act="lock-pick" data-arg="${u.id}">
        ${monogram(u, 'mono-av--lg')}<span class="tile__text"><span class="tile__name">${esc(u.name)}</span>${S.lockedAccounts[u.username] ? '<span class="tile__flag">Account locked</span>' : ''}${u.nativeName ? `<span class="tile__native native">${esc(u.nativeName)}</span>` : ''}<span class="tile__meta">${esc(u.roles.join(' and '))}</span>${u.id === prev.id ? '<span class="tile__flag">Locked session</span>' : ''}</span>
      </button>`).join('');
    const other = `<button type="button" class="tile tile--other" role="radio" aria-checked="${k.pick === 'other'}" data-act="lock-pick" data-arg="other">${ic('switch', 'ic--lg')}<span class="tile__text"><span class="tile__name">Someone else</span><span class="tile__meta">Type your user ID</span></span></button>`;
    const locked = picked && S.lockedAccounts[picked.username];
    const passkey = k.passkey && picked ? `
      <div class="passkey passkey--dark" role="status">
        <p class="passkey__h">${ic('key', 'ic--lg')}Waiting for ${esc(picked.name)}'s passkey</p>
        <p>Touch the security key or use Windows Hello now. Only a passkey registered to <span class="mono">${esc(picked.username)}</span> works.</p>
        <div class="passkey__row"><button type="button" class="rbtn rbtn--primary" data-act="lock-passkey-touch">${ic('key')}<span>Simulate the key touch (demo)</span></button><button type="button" class="rbtn rbtn--quiet" data-act="lock-passkey-off"><span>Use password and code</span></button></div>
      </div>` : '';
    const form = k.pick && passkey ? passkey + `<p class="lock__note">${same ? `Unlocking returns ${esc(prev.name)} to where they left off.` : `Signing in ends ${esc(prev.name)}'s session. Anything they had not saved stays as their draft.`}</p>` : k.pick ? `
      <form class="lock__form" id="lock-form" autocomplete="off" novalidate>
        <div class="field field--dark"><label for="lk-uid">User ID</label><input id="lk-uid" data-fk="lk-uid" name="uid" value="${esc(k.uid)}" autocomplete="off" autocapitalize="off" spellcheck="false" ${k.pick !== 'other' ? 'readonly' : ''}></div>
        <div class="field field--dark"><label for="lk-pw">Password</label><input id="lk-pw" data-fk="lk-pw" name="pw" type="password" autocomplete="off"></div>
        <div class="field field--dark field--code"><label for="lk-code">Authenticator code</label><input id="lk-code" data-fk="lk-code" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
        <button type="submit" class="rbtn rbtn--primary lock__go"${locked ? ' aria-disabled="true"' : ''}>${ic(same ? 'lock' : 'switch')}<span>${same ? 'Unlock' : 'Sign in and take over'}</span></button>
      </form>
      ${k.error ? `<p class="lock__error" role="alert">${ic('fail')}${k.error}</p>` : ''}
      <p class="lock__note">${same ? `Unlocking returns ${esc(prev.name)} to where they left off.` : `Signing in ends ${esc(prev.name)}'s session. Anything they had not saved stays as their draft.`}</p>
      ${k.pick !== 'other' && !locked ? `<button type="button" class="rbtn rbtn--quiet lock__passkey" data-act="lock-passkey">${ic('key')}<span>Use a passkey instead</span></button>` : ''}
      <div class="demo demo--dark"><span>Demo credentials: password <b class="mono">${esc(DEMO.users[(picked || prev).username] ? DEMO.users[(picked || prev).username].password : 'bench-demo-2026')}</b>, code <b class="mono">${esc(picked && DEMO.users[picked.username] ? DEMO.users[picked.username].totp : '(per user)')}</b></span><button type="button" class="rbtn rbtn--quiet rbtn--small" data-act="lock-demo">Fill demo credentials</button></div>` : `<p class="lock__note">Choose who is signing in. Every sign-in needs a password and a fresh authenticator code.</p>`;
    return `
      <div class="lock" role="dialog" aria-modal="true" aria-labelledby="lk-title">
        <div class="lock__bar"><span class="brand__mark brand__mark--dark">RD</span><span class="lock__station">${ic('pc')}${esc(stationLine())}, Lab ${esc(L.lab.id)}</span><span class="fict fict--dark" title="${esc(L.meta.note)}">Fictional data</span></div>
        <div class="lock__body">
          <div class="lock__clock"><span class="lock__time num" id="lock-time">${fmt.hm(t)}</span><span class="lock__date">${fmt.dayLong(t)}, ${ZONE}</span><span class="lock__utc num">${fmt.hmUtc(t)} UTC</span></div>
          <div class="lock__main">
            <h1 id="lk-title">${ic('lock', 'ic--lg')}${esc(prev.name)}'s session is locked</h1>
            <p class="lock__why">${esc(why)} Nothing is shown until someone signs in.</p>
            <h2 class="lock__ask">Who is signing in?</h2>
            <div class="tiles" role="radiogroup" aria-label="Who is signing in">${tiles}${other}</div>
            ${form}
          </div>
        </div>
      </div>`;
  }
  App.act['lock'] = () => lock('manual');
  App.act['switch-user'] = () => lock('switch');
  App.act['lock-passkey'] = () => { S.locked.passkey = true; S.locked.error = null; renderLayer(); const b = $('[data-act="lock-passkey-touch"]'); if (b) b.focus(); };
  App.act['lock-passkey-off'] = () => { S.locked.passkey = false; renderLayer(); const f = $('#lk-pw'); if (f) f.focus(); };
  App.act['lock-passkey-touch'] = () => { const p = person(S.locked.pick); if (S.lockedAccounts[p.username]) return; completeSignIn(p, 'passkey'); };
  App.act['lock-pick'] = (el) => {
    const id = el.dataset.arg;
    S.locked.pick = id; S.locked.passkey = false;
    S.locked.uid = id === 'other' ? '' : person(id).username;
    S.locked.error = null;
    renderLayer();
    const f = id === 'other' ? $('#lk-uid') : $('#lk-pw');
    if (f) f.focus();
  };
  App.act['lock-demo'] = () => {
    const k = S.locked;
    const uid = k.pick === 'other' ? ($('#lk-uid').value || 'kwatanabe').trim().toLowerCase() : person(k.pick).username;
    const cred = DEMO.users[uid];
    if (!cred) { k.error = `No demo credentials for ${esc(uid)}. Demo users: ${Object.keys(DEMO.users).join(', ')}.`; renderLayer(); return; }
    $('#lk-pw').value = cred.password; $('#lk-code').value = cred.totp;
    $('#lock-form .lock__go').focus();
  };
  function checkCredentials(uid, pw, code) {
    // Returns { ok } or { error, locked }. Five consecutive failures lock the account.
    const p = DB.byUsername[uid];
    if (!p) return { error: 'That user ID, password or code is not right.' };
    if (S.lockedAccounts[uid]) return { error: `${esc(uid)} is locked after 5 failed attempts. An Admin must unlock the account.`, locked: true };
    const cred = DEMO.users[uid];
    if (cred && pw === cred.password && code === cred.totp) { S.failures[uid] = 0; return { ok: true, person: p }; }
    S.failures[uid] = (S.failures[uid] || 0) + 1;
    const left = DEMO.lockoutAfterFailures - S.failures[uid];
    if (left <= 0) { S.lockedAccounts[uid] = true; audit(`Account ${uid} locked after ${DEMO.lockoutAfterFailures} failed attempts`); return { error: `Wrong password or code. <b>${esc(uid)} is now locked</b> after ${DEMO.lockoutAfterFailures} failed attempts in a row. An Admin must unlock it.`, locked: true }; }
    return { error: `Wrong password or code. <b>${plural(left, 'attempt')} left</b> before ${esc(uid)} is locked.` };
  }
  App.lib.checkCredentials = checkCredentials;
  function submitLock(form) {
    const k = S.locked;
    const uid = form.uid.value.trim().toLowerCase();
    const pw = form.pw.value;
    const code = form.code.value.trim();
    if (!uid || !pw || !code) { k.error = 'Enter the user ID, password and authenticator code.'; renderLayer(); ($('#lk-pw').value ? $('#lk-code') : $('#lk-pw')).focus(); return; }
    const r = checkCredentials(uid, pw, code);
    if (!r.ok) { k.error = r.error; if (k.pick === 'other') k.uid = uid; renderLayer(); const f = $('#lk-pw'); if (f) f.focus(); return; }
    completeSignIn(r.person, 'password and code');
  }
  // Each view hands over the unsaved typing that belongs to the person leaving, and takes back what belongs to the person arriving.
  function stashDrafts(userId) {
    const kept = [];
    Object.entries(App.views).forEach(([key, v]) => { const k = v.stash && v.stash(userId); if (k) { (S.drafts[userId] = S.drafts[userId] || {})[key] = k.data; kept.push(k.label); } });
    return kept;
  }
  function restoreDrafts(userId) {
    const mine = S.drafts[userId]; if (!mine) return [];
    const back = Object.entries(mine).map(([key, data]) => App.views[key] && App.views[key].restore ? App.views[key].restore(data) : null).filter(Boolean);
    delete S.drafts[userId];
    return back;
  }
  const listText = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  function completeSignIn(who, method) {
    const prevId = S.locked.prevUserId; const want = S.locked.want;
    S.locked = null;
    const r = { person: who };
    if (r.person.id === prevId) {
      audit(`${r.person.username} unlocked the session (${method})`);
      if (want && want !== S.route) visit(want); else show();
      receipt({ title: `Welcome back, ${r.person.name.split(' ')[0]}`, body: 'Your session is unlocked where you left it.', icon: 'lock' });
    } else {
      audit(`${r.person.username} signed in (${method}); session of ${person(prevId).username} ended`);
      const kept = stashDrafts(prevId);
      S.userId = r.person.id;
      S.sessionStart = now();
      const back = restoreDrafts(r.person.id);
      visit(want || home(r.person.id));
      const prevName = person(prevId).name;
      const first = (n) => n.split(' ')[0];
      receipt({ title: `${r.person.name} is signed in`, body: `${esc(prevName)}'s session ended on this PC. ${kept.length ? `Kept as ${esc(first(prevName))}'s drafts, not yours: ${esc(listText(kept))}.` : `${esc(first(prevName))} left nothing unsaved.`}${back.length ? ` Back as you left it: your ${esc(listText(back))}.` : ''}`, icon: 'switch', ms: 12000 });
    }
    markActivity();
    const main = $('#view');
    if (main) main.focus({ preventScroll: true });
  }

  /* idle lock after 15 minutes; a warning in the rail during the last minute */
  const IDLE_MS = DEMO.idleLockMinutes * 60e3;
  function markActivity() { S.lastActivity = Date.now(); }
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, markActivity, { capture: true, passive: true }));
  setInterval(() => {
    const t = now();
    const cl = $('#clock-local'); if (cl) cl.textContent = `${DOW[loc(t).getUTCDay()]} ${fmt.dm(t)}, ${fmt.hm(t)} ${ZONE}`;
    const cu = $('#clock-utc'); if (cu) cu.textContent = `${fmt.hmUtc(t)} UTC`;
    const lt = $('#lock-time'); if (lt) lt.textContent = fmt.hm(t);
    if (S.locked || !S.userId) return;
    const idle = Date.now() - S.lastActivity;
    const line = $('#idle-line');
    if (idle >= IDLE_MS) { lock('idle'); return; }
    if (line) {
      const left = IDLE_MS - idle;
      if (left <= 60e3) { line.textContent = `Locking in 0:${p2(Math.ceil(left / 1000) % 60)}. Touch anywhere to stay.`; line.classList.add('who__idle--warn'); }
      else if (line.classList.contains('who__idle--warn')) { line.classList.remove('who__idle--warn'); line.textContent = `Signed in ${fmt.hm(S.sessionStart)}. Locks after 15 min idle.`; }
    }
  }, 1000);

  /* ---------- the signature prompt (shared by Test results and equipment Checks) ---------- */
  // spec: { meaning, role, record, version, sha256, title, contents (html), effects (html), onSigned(sig) }
  function openSign(spec) {
    // The signature records the signer's own role; nobody signs in a role they do not hold.
    if (!person(S.userId).roles.includes(spec.role)) { receipt({ title: 'Not signed', body: `${esc(person(S.userId).name)} does not hold the ${esc(spec.role)} role, so cannot sign ${esc(spec.meaning)} here.`, tone: 'bad', icon: 'fail' }); return; }
    const active = document.activeElement;
    S.sign = { spec, error: null, locked: false, method: 'typed', waiting: false, kb: 'sg-uid', opener: active, openerFk: spec.openerFk || (active && active.dataset ? active.dataset.fk : null) };
    renderLayer();
    const sheet = $('#sign-sheet');
    if (sheet && !spec.instant) { sheet.classList.add('enter'); requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.remove('enter'))); }
    const f = $('#sg-uid'); if (f) f.focus({ preventScroll: true });
  }
  function signHTML() {
    const { spec, error, method, waiting } = S.sign;
    const p = person(S.userId);
    const locked = S.lockedAccounts[p.username];
    const left = DEMO.lockoutAfterFailures - (S.failures[p.username] || 0);
    const cred = DEMO.users[p.username];
    return `
      <div class="signlayer">
        <div class="scrim scrim--sign" data-act="noop"></div>
        <section class="signsheet" id="sign-sheet" role="dialog" aria-modal="true" aria-labelledby="sg-title" aria-describedby="sg-statement">
          <div class="signsheet__body">
            <div class="signsheet__what">
              <h2 id="sg-title" class="signsheet__title">${esc(spec.title)}<span class="fict" title="${esc(L.meta.note)}">Fictional data</span></h2>
              <section class="manifest" aria-labelledby="mf-h">
                <h3 id="mf-h" class="manifest__h">What you are signing</h3>
                <dl class="manifest__id">
                  <div><dt>Record</dt><dd>${esc(spec.record)}</dd></div>
                  <div><dt>Record Version</dt><dd class="manifest__ver num">${spec.version}</dd></div>
                  <div class="manifest__hash"><dt>SHA-256 of this version</dt><dd class="mono"><b>${esc(spec.sha256.slice(0, 8))}</b> ${esc(fmt.hashGroups(spec.sha256.slice(8)))}</dd></div>
                </dl>
                <div class="manifest__contents">${spec.contents}</div>
              </section>
              <section class="effects" aria-labelledby="ef-h"><h3 id="ef-h" class="manifest__h">What signing does</h3>${spec.effects}</section>
            </div>
            <div class="signsheet__who">
              <h3 class="manifest__h">Who is signing</h3>
              <div class="signer">${monogram(p, 'mono-av--xl')}<div><p class="signer__name">${nameLine(p)}</p><p class="signer__meta"><span class="mono">${esc(p.username)}</span>, signing as ${esc(spec.role)}, Lab ${esc(L.lab.id)}, on ${esc(WORKSTATION.name)}</p></div></div>
              <div class="meaning">
                <p class="meaning__label">Signature Meaning</p>
                <p class="meaning__word">${ic('sig')}${esc(spec.meaning)}</p>
                <blockquote class="meaning__statement" id="sg-statement">${esc(L.signatureMeanings[spec.meaning])}</blockquote>
              </div>
              <form class="creds" id="sg-form" autocomplete="off" novalidate>
                <p class="creds__lead">Sign in again to sign. Being signed in does not count.</p>
                <div class="seg" role="radiogroup" aria-label="How to sign">
                  <button type="button" class="seg__opt" role="radio" aria-checked="${method !== 'passkey'}" data-act="sign-method" data-arg="typed">User ID, password and code</button>
                  <button type="button" class="seg__opt" role="radio" aria-checked="${method === 'passkey'}" data-act="sign-method" data-arg="passkey">${ic('key')}Passkey</button>
                </div>
                ${method === 'passkey' ? `
                <div class="passkey${waiting ? ' is-waiting' : ''}" role="status">
                  <p class="passkey__h">${ic('key', 'ic--lg')}${waiting ? `Waiting for ${esc(p.name)}'s passkey` : 'Sign with your passkey'}</p>
                  <p>${waiting ? 'Touch the security key or use Windows Hello now.' : `Pressing ${esc(spec.signLabel || `Sign as ${spec.meaning}`)} asks for the passkey registered to <span class="mono">${esc(p.username)}</span>: touch the security key or use Windows Hello.`}</p>
                  ${waiting ? `<div class="passkey__row"><button type="button" class="btn" data-act="sign-passkey-touch">${ic('key')}Simulate the key touch (demo)</button><button type="button" class="btn btn--quiet" data-act="sign-passkey-stop">Stop waiting</button></div>` : ''}
                </div>` : `
                <div class="creds__grid">
                  <div class="creds__fields">
                    <div class="field"><label for="sg-uid">User ID</label><input id="sg-uid" data-fk="sg-uid" data-cred="1" name="uid" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="sg-uid-hint"${locked ? ' disabled' : ''}><p class="field__hint" id="sg-uid-hint">Must be <span class="mono">${esc(p.username)}</span>, the person signed in</p></div>
                    <div class="field"><label for="sg-pw">Password</label><input id="sg-pw" data-fk="sg-pw" data-cred="1" name="pw" type="password" autocomplete="off"${locked ? ' disabled' : ''}></div>
                    <div class="field field--code"><label for="sg-code">Authenticator code</label><input id="sg-code" data-fk="sg-code" data-cred="1" name="code" inputmode="none" maxlength="6" autocomplete="off" aria-describedby="sg-code-hint"${locked ? ' disabled' : ''}><p class="field__hint" id="sg-code-hint">6 digits, new every 30 s</p></div>
                  </div>
                  ${locked ? '' : keypadHTML('digits', 'Number pad for the user ID, password and code: it types into the field that has focus')}
                </div>`}
                <p class="attempts${left <= 2 ? ' attempts--low' : ''}" id="sg-attempts">${locked ? `${ic('lock')}<span><b>${esc(p.username)} is locked.</b> An Admin must unlock the account before anyone can sign as ${esc(p.name)}.</span>` : `${ic('lock')}<span>Five failed attempts in a row lock the account. <b>${plural(left, 'attempt')} left.</b></span>`}</p>
                ${error ? `<p class="form-error" role="alert">${ic('fail')}<span>${error}</span></p>` : ''}
                ${cred && !locked && method !== 'passkey' ? `<div class="demo"><span>Demo only: password <b class="mono">${esc(cred.password)}</b>, code <b class="mono">${esc(cred.totp)}</b>. The user ID is always typed.</span><button type="button" class="btn btn--quiet btn--small" data-act="sign-demo">Fill demo password and code</button></div>` : ''}
              </form>
            </div>
          </div>
          <footer class="rail rail--sign">
            ${whoPlate(p, `<span class="who__idle">Signing as ${esc(spec.role)}</span>`)}
            <div class="rail__context"><span class="ctx__main">${esc(spec.meaning)} on ${esc(spec.record)}</span><span class="ctx__sub">Record Version ${spec.version}, SHA-256 <span class="mono">${esc(spec.sha256.slice(0, 8))}</span></span></div>
            <div class="rail__actions">
              <button type="button" class="rbtn rbtn--secondary" data-act="sign-cancel"><span>Cancel</span></button>
              <button type="submit" form="sg-form" class="rbtn ${spec.danger ? 'rbtn--danger' : 'rbtn--primary'} rbtn--sign" data-fk="sg-go"${locked ? ' aria-disabled="true"' : ''}>${ic('sig')}<span>${esc(spec.signLabel || `Sign as ${spec.meaning}`)}</span></button>
            </div>
          </footer>
        </section>
      </div>`;
  }
  function closeSign(result) {
    const sheet = $('#sign-sheet');
    const opener = S.sign && S.sign.opener; const fk = S.sign && S.sign.openerFk;
    // Focus goes back to the button that opened the prompt, found again by its key after any re-render.
    const done = () => { S.sign = null; renderLayer(); const back = (fk && $(`[data-fk="${fk}"]`)) || (opener && opener.isConnected ? opener : null); if (back) back.focus({ preventScroll: true }); };
    if (sheet && !matchMedia('(prefers-reduced-motion: reduce)').matches) { sheet.classList.add('leave'); $('.scrim--sign').classList.add('leave'); setTimeout(done, 180); } else done();
    return result;
  }
  App.act['sign-cancel'] = () => { const spec = S.sign.spec; closeSign(); if (spec.onCancel) spec.onCancel(); };
  App.act['sign-demo'] = () => {
    const p = person(S.userId); const cred = DEMO.users[p.username];
    $('#sg-pw').value = cred.password; $('#sg-code').value = cred.totp;
    const uid = $('#sg-uid'); (uid.value ? $('.rbtn--sign') : uid).focus();
  };
  App.act['noop'] = () => {};
  App.act['skip'] = (el) => { const v = viewFor(S.route); const to = el.dataset.arg === 'rail' ? $('#rail .rail__actions button') || $('#rail button') : (v.skipTarget && v.skipTarget()) || $('#view'); if (to) to.focus(); };
  App.act['sign-method'] = (el) => { S.sign.method = el.dataset.arg; S.sign.waiting = false; S.sign.error = null; renderLayer(); const f = el.dataset.arg === 'typed' ? $('#sg-uid') : $('.rbtn--sign'); if (f) f.focus(); };
  App.act['sign-passkey-stop'] = () => { S.sign.waiting = false; renderLayer(); };
  App.act['sign-passkey-touch'] = () => { if (S.sign && S.sign.waiting && !S.lockedAccounts[person(S.userId).username]) completeSign('passkey'); };
  function submitSign(form) {
    const s = S.sign; const p = person(S.userId);
    if (s.method === 'passkey') { if (!S.lockedAccounts[p.username]) { s.waiting = true; renderLayer(); const b = $('[data-act="sign-passkey-touch"]'); if (b) b.focus(); } return; }
    const uid = form.uid.value.trim().toLowerCase(); const pw = form.pw.value; const code = form.code.value.trim();
    const again = (msg, focusId) => { s.error = msg; renderLayer(); const f = $(focusId); if (f) f.focus(); };
    if (S.lockedAccounts[p.username]) return;
    if (!uid || !pw || !code) return again('Enter your user ID, password and authenticator code. Nothing has been signed.', !uid ? '#sg-uid' : !pw ? '#sg-pw' : '#sg-code');
    if (uid !== p.username) {
      const keep = { pw, code }; // mismatched user ID: not a credential attempt, keep what was typed
      again(`The user ID must be <span class="mono">${esc(p.username)}</span>. Only ${esc(p.name)}, who is signed in, can sign here. To sign as someone else, cancel and use Switch user. Nothing has been signed.`, '#sg-uid');
      $('#sg-pw').value = keep.pw; $('#sg-code').value = keep.code; $('#sg-uid').value = uid; $('#sg-uid').select();
      return;
    }
    const r = checkCredentials(uid, pw, code);
    if (r.locked) { const spec = s.spec; S.sign = null; if (spec.onCancel) spec.onCancel(); lock('lockout'); return; }
    if (!r.ok) { again(`${r.error} Nothing has been signed.`, '#sg-pw'); const u = $('#sg-uid'); if (u) u.value = uid; return; }
    completeSign('password and code');
  }
  function completeSign(method) {
    const s = S.sign; const p = person(S.userId);
    const at = now();
    const spec = s.spec;
    if (!p.roles.includes(spec.role)) return; // guarded in openSign; never record a role the signer does not hold
    const sig = {
      meaning: spec.meaning, statement: L.signatureMeanings[spec.meaning], name: p.name, nativeName: p.nativeName, username: p.username, role: spec.role,
      utc: `${fmt.isoUtc(at)} UTC`, local: `${fmt.isoLocal(at)} ${ZONE} (${IANA})`, at: at.toISOString(), record: spec.record, version: spec.version, sha256: spec.sha256,
    };
    audit(`${p.username} signed ${spec.meaning} on ${spec.record}, Record Version ${spec.version} (${spec.sha256.slice(0, 8)}), by ${method}`);
    closeSign();
    spec.onSigned(sig);
  }

  /* ---------- the keypad: one component for gloved entry, calculator-style (it always types at the end) ---------- */
  function keypadHTML(mode, label) {
    const keys = mode === 'digits' ? ['7', '8', '9', '4', '5', '6', '1', '2', '3'] : ['7', '8', '9', '4', '5', '6', '1', '2', '3', '\u2212', '0', '.'];
    const key = (k) => `<button type="button" class="key num" tabindex="-1" data-key="${k === '\u2212' ? '-' : k}" aria-label="${k === '\u2212' ? 'Change sign' : k === '.' ? 'Decimal point' : k}">${k === '\u2212' ? '\u00b1' : k}</button>`;
    const back = `<button type="button" class="key key--fn" tabindex="-1" data-key="back" aria-label="Delete the last character">${ic('back', 'ic--lg')}</button>`;
    const next = `<button type="button" class="key key--fn key--next" tabindex="-1" data-key="next" aria-label="Next field">Next ${ic('next')}</button>`;
    return `<div class="keypad keypad--${mode}" role="group" aria-label="${esc(label)}">${keys.map(key).join('')}${mode === 'digits' ? `${back}${key('0')}${next}` : `${back}${next}`}</div>`;
  }
  // Keys never take focus, so the field keeps its caret and a physical keyboard keeps working.
  document.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('.key')) e.preventDefault(); });
  document.addEventListener('focusin', (e) => { if (S.sign && e.target.dataset && e.target.dataset.cred) S.sign.kb = e.target.id; });
  document.addEventListener('click', (e) => {
    const key = e.target.closest && e.target.closest('#sign-sheet .key'); if (!key || !S.sign) return;
    const order = ['sg-uid', 'sg-pw', 'sg-code'];
    const input = $(`#${S.sign.kb || 'sg-uid'}`); if (!input || input.disabled) return;
    const k = key.dataset.key;
    if (k === 'next') { const i = order.indexOf(input.id); const nx = i < order.length - 1 ? $(`#${order[i + 1]}`) : $('.rbtn--sign'); if (nx) nx.focus(); return; }
    input.focus();
    if (k === 'back') input.value = input.value.slice(0, -1);
    else if (!input.maxLength || input.maxLength < 0 || input.value.length < input.maxLength) input.value += k;
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (err) { /* password inputs allow it; others may not */ }
  });

  /* ---------- events: one delegated handler for data-act, nav, forms, keys ---------- */
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      e.preventDefault();
      const target = nav.dataset.nav;
      if (viewFor(target) === viewFor(S.route) && target === S.route) return;
      App.views.queue.closeAssign && App.views.queue.closeAssign();
      go(target);
      return;
    }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.getAttribute('aria-disabled') === 'true') { e.preventDefault(); const why = el.getAttribute('title'); if (why) receipt({ title: 'Not yet', body: esc(why), tone: 'warn', icon: 'clock', ms: 5000, forAct: el.dataset.act }); return; }
    const fn = App.act[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  document.addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.target.id === 'sg-form') { const go_ = $('.rbtn--sign'); if (go_ && go_.getAttribute('aria-disabled') === 'true') return; submitSign(e.target); }
    else if (e.target.id === 'lock-form') submitLock(e.target);
    else { const fn = App.act[`submit:${e.target.dataset.form}`]; if (fn) fn(e.target, e); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (S.sign) { App.act['sign-cancel'](); e.preventDefault(); return; }
      if (S.locked) return;
      const v = viewFor(S.route);
      if (v.onEscape && v.onEscape()) e.preventDefault();
      return;
    }
    if (e.key === 'Tab') trapFocus(e);
  });
  function trapFocus(e) {
    let roots = null;
    if (S.locked) roots = [$('#layer .lock')];
    else if (S.sign) roots = [$('#sign-sheet')];
    else { const v = viewFor(S.route); roots = v.modalRoots ? v.modalRoots() : null; }
    if (!roots) return;
    const f = roots.filter(Boolean).flatMap((r) => $$('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])', r)).filter((el) => !el.disabled && el.offsetParent !== null);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
  }

  /* ---------- exports ---------- */
  Object.assign(App.lib, {
    L, DB, S, WORKSTATION, $, $$, esc, ic, plural, initials, fmt, now, ZONE, IANA, LAB_DAY, RISK_UNTIL, addBD, bdBetween, calDays, sha256, sha256Bytes, canon,
    MAIN_PATH, OPEN_STATES, PRE_REVIEW, dueStatus, stateSince, person, analysts, blocksText, deviation, fitnessOf, audit, openDeviation,
    track, stateTag, holdTag, holdTip, devTag, riskTag, gxpTag, fitTag, dueCell, sigBlock, monogram, nameLine, receipt, keypadHTML, listText,
  });
  Object.assign(App, { deepLink, go, visit, show, renderRail, renderTop, renderLayer, openSign, closeSign, lock, keepState, markActivity });
})();

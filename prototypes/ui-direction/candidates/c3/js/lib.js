/* lib.js: templating, time, hashing, DOM helpers. No app knowledge in here. */
(() => {
  'use strict';
  const LX = (window.LX = {});

  /* web fonts arrive without blocking the first paint: the link starts as media=print and is switched on here */
  const fontLink = document.querySelector('link[data-fonts]');
  if (fontLink) { const on = () => { fontLink.media = 'all'; }; if (fontLink.sheet) on(); else fontLink.addEventListener('load', on, { once: true }); }

  /* ---------- html templating: interpolations are escaped unless already Raw ---------- */
  class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);
  const ser = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(ser).join('') : v == null || v === false ? '' : esc(v));
  LX.h = (strings, ...vals) => new Raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? ser(vals[i]) : ''), ''));
  LX.raw = (s) => new Raw(s);
  LX.esc = esc;
  LX.mount = (el, tpl) => { el.innerHTML = String(tpl); return el; };

  /* ---------- dom ---------- */
  LX.$ = (sel, root = document) => root.querySelector(sel);
  LX.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  LX.FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  LX.visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  LX.clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------- time: the server clock starts at meta.now and keeps running ---------- */
  const T0 = performance.now();
  const BASE = Date.parse(window.LIMS.meta.now);
  const ZONE = window.LIMS.meta.labZone;
  const dtfLocal = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const dtfZone = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, timeZoneName: 'short' });
  const localParts = (d) => { const o = {}; for (const p of dtfLocal.formatToParts(d)) o[p.type] = p.value; return o; };
  const t = LX.t = {
    zoneId: ZONE,
    now: () => new Date(BASE + (performance.now() - T0)),
    mono: () => performance.now(),
    date: (d) => { const p = localParts(d); return `${p.year}-${p.month}-${p.day}`; },
    hm: (d) => { const p = localParts(d); return `${p.hour}:${p.minute}`; },
    hms: (d) => { const p = localParts(d); return `${p.hour}:${p.minute}:${p.second}`; },
    zone: (d) => dtfZone.formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? 'local',
    offset: (d) => {
      const p = localParts(d);
      const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
      const mins = Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
      const sign = mins < 0 ? '−' : '+'; const a = Math.abs(mins);
      return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
    },
    utcDate: (d) => d.toISOString().slice(0, 10),
    utcHms: (d) => d.toISOString().slice(11, 19),
    stamp: (d) => `${t.date(d)} ${t.hm(d)} ${t.zone(d)}`,
    stampS: (d) => `${t.date(d)} ${t.hms(d)} ${t.zone(d)}`,
    stampUtc: (d) => `${t.utcDate(d)} ${t.utcHms(d)} UTC`,
    /* "3 d 4 h", "5 h 12 min", "42 min" */
    age: (ms) => {
      const m = Math.max(0, Math.floor(ms / 60000));
      if (m < 1) return '<1 min';
      if (m < 60) return `${m} min`;
      const h = Math.floor(m / 60);
      if (h < 24) return h < 6 ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${h} h`;
      const d = Math.floor(h / 24);
      return d < 5 ? `${d} d ${h % 24} h` : `${d} d`;
    },
    /* calendar days between two YYYY-MM-DD strings (b - a) */
    dayDiff: (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5),
  };

  /* ---------- numbers ---------- */
  LX.num = (v, dp = 2) => Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp, useGrouping: false }).replace('-', '−');
  LX.int = (v) => Number(v).toLocaleString('en-US');

  /* ---------- sha-256, synchronous, so a Record Version's hash can follow what is typed ---------- */
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  LX.sha256 = (str) => {
    const bytes = new TextEncoder().encode(str);
    const l = bytes.length; const words = new Uint32Array((((l + 9 + 63) >> 6) << 4));
    for (let i = 0; i < l; i++) words[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
    words[l >> 2] |= 0x80 << (24 - (l & 3) * 8);
    words[words.length - 1] = (l * 8) >>> 0; words[words.length - 2] = Math.floor((l * 8) / 4294967296);
    const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const w = new Uint32Array(64); const rr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let i = 0; i < words.length; i += 16) {
      for (let j = 0; j < 16; j++) w[j] = words[i + j];
      for (let j = 16; j < 64; j++) { const s0 = rr(w[j-15], 7) ^ rr(w[j-15], 18) ^ (w[j-15] >>> 3); const s1 = rr(w[j-2], 17) ^ rr(w[j-2], 19) ^ (w[j-2] >>> 10); w[j] = (w[j-16] + s0 + w[j-7] + s1) | 0; }
      let [a, b, c, d, e, f, g, hh] = H;
      for (let j = 0; j < 64; j++) {
        const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (hh + S1 + ch + K[j] + w[j]) | 0;
        const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22); const mj = (a & b) ^ (a & c) ^ (b & c); const t2 = (S0 + mj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + hh) | 0;
    }
    return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  };

  /* ---------- actions: modules register handlers by name; app.js dispatches every [data-act] click ---------- */
  LX.actions = {};

  /* ---------- icons ---------- */
  LX.icon = (name, cls = '') => LX.raw(`<svg class="ico ${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`);
  LX.plural = (n, one, many) => `${n} ${n === 1 ? one : many ?? one + 's'}`;
})();

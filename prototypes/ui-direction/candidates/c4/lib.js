'use strict';
/* Ledger & Rail · shared helpers: templating, data indexes, the lab clock, formatting, rounding, SHA-256.
   window.LIMS is treated as the server's answers: read, never mutated. Local changes live in app state. */

const L = window.LIMS;

/* ---------- templating: h`` escapes every interpolation unless it is raw() ---------- */
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(String(s));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const flat = (v) => (v == null || v === false || v === true ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(flat).join('') : esc(v));
function h(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += flat(vals[i]) + strings[i + 1];
  return new Raw(out);
}
const tf = (b) => (b ? 'true' : 'false'); /* for aria-* attributes: h`` drops booleans */
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------- indexes ---------- */
const byId = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
const PEOPLE = byId(L.people);
const BY_USERNAME = Object.fromEntries(L.people.map((p) => [p.username, p]));
const CUSTOMERS = byId(L.customers);
const PRODUCTS = byId(L.products);
const METHODS = byId(L.methods);
const SAMPLES = byId(L.samples);
const SUBMISSIONS = byId(L.submissions);
const TESTS = byId(L.tests);
const EQUIPMENT = byId(L.equipment);
const ROOMS = byId(L.rooms);
const DEVIATIONS = byId(L.deviations);
const CHECKS = byId(L.checksToday);
const ANALYSTS = L.people.filter((p) => p.roles.includes('Analyst'));
const OPEN_STATES = ['Requested', 'Accepted', 'Ready', 'Assigned', 'In Progress', 'Submitted for Review', 'Reviewed'];
const FORWARD_STATES = [...OPEN_STATES, 'Reported'];
const FOCUS = L.focus.test;
const MEANINGS = L.signatureMeanings;
const MAX_FAILURES = L.demoCredentials.lockoutAfterFailures;
const IDLE_MS = L.demoCredentials.idleLockMinutes * 60e3;
const WORKSTATION = 'Bench PC RD-102-02';

/* ---------- people ---------- */
const NATIVE_LANG = { u03: 'zh-Hans', u13: 'ja', u14: 'zh-Hans', u19: 'zh-Hans', u23: 'ja', u29: 'ko' };
const initials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const BADGE_COLORS = ['#2F5D8A', '#6A3F8F', '#8A4B2F', '#2F7A5B', '#7A2F4F', '#4F6A2F', '#2F6F7A', '#5B4F8A'];
const badgeColor = (p) => BADGE_COLORS[parseInt(p.id.slice(1), 10) % BADGE_COLORS.length];
const firstName = (p) => p.name.split(' ')[0];
const roleOf = (p) => p.roles.join(' · ');

/* ---------- lab clock: server "now" from the data, advancing in real time ---------- */
const T0 = Date.parse(L.meta.now);
const P0 = performance.now();
const nowMs = () => Math.round(T0 + (performance.now() - P0));
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const OFFSET_H = L.meta.utcOffsetHours;
const ZONE = 'EDT';
const ZONE_LONG = `${L.meta.labZone}, UTC${OFFSET_H < 0 ? '−' : '+'}${String(Math.abs(OFFSET_H)).padStart(2, '0')}:00`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad2 = (n) => String(n).padStart(2, '0');
const toMs = (x) => (typeof x === 'number' ? x : Date.parse(x));
const localDate = (x) => new Date(toMs(x) + OFFSET_H * 3600e3); /* read with getUTC* */
function fmtTime(x, secs = false) { const d = localDate(x); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}${secs ? ':' + pad2(d.getUTCSeconds()) : ''}`; }
function fmtDayOf(x) { const d = localDate(x); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; }
const fmtLocal = (x) => `${fmtDayOf(x)} ${fmtTime(x)} ${ZONE}`;
function fmtUtcTime(x, secs = false) { const d = new Date(toMs(x)); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}${secs ? ':' + pad2(d.getUTCSeconds()) : ''} UTC`; }
function fmtUtcFull(x) { const d = new Date(toMs(x)); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${fmtUtcTime(x, true)}`; }
function fmtLocalFull(x) { const d = localDate(x); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${fmtTime(x, true)} ${ZONE}`; }
function fmtClock(x) { const d = localDate(x); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} · ${fmtTime(x)} ${ZONE} · ${fmtUtcTime(x)}`; }

/* ---------- calendar and business days (date strings are lab-local YYYY-MM-DD) ---------- */
const LAB_DAY = L.meta.labDay;
const HOLIDAYS = new Set(['2026-09-07']);
const dayObj = (s) => new Date(s + 'T12:00:00Z');
function fmtDate(s, withWeekday = false) { const d = dayObj(s); return `${withWeekday ? WD[d.getUTCDay()] + ' ' : ''}${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; }
const isBusinessDay = (s) => { const w = dayObj(s).getUTCDay(); return w !== 0 && w !== 6 && !HOLIDAYS.has(s); };
function addDays(s, n) { const d = dayObj(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function businessDaysFromToday(s) {
  let n = 0; let d = LAB_DAY;
  if (s >= LAB_DAY) { while (d < s) { d = addDays(d, 1); if (isBusinessDay(d)) n++; } return n; }
  while (d > s) { d = addDays(d, -1); if (isBusinessDay(d)) n--; } return n;
}
const calendarDaysLate = (s) => Math.round((dayObj(LAB_DAY) - dayObj(s)) / 864e5);
function fmtDuration(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return `${m} min`;
  const hh = Math.floor(m / 60);
  if (hh < 24) return `${hh} h ${m % 60} min`;
  return `${Math.floor(hh / 24)} d ${hh % 24} h`;
}

/* ---------- numbers ---------- */
const MINUS = '−';
const fmtFixed = (v, dp) => (v < 0 ? MINUS : '') + Math.abs(v).toFixed(dp);
const fmtSigned = (v, dp) => (Number(Math.abs(v).toFixed(dp)) === 0 ? '' : v > 0 ? '+' : MINUS) + Math.abs(v).toFixed(dp);
const fmtInt = (v) => Number(v).toLocaleString('en-US');
function parseNum(s) {
  const t = String(s ?? '').trim().replace(/−/g, '-');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
  return Number(t);
}
const decimalsOf = (s) => { const t = String(s); const i = t.indexOf('.'); return i < 0 ? 0 : t.length - i - 1; };
/* USP General Notices 7.20: round to the decimal places of the limit, half away from zero, then compare. */
const roundHalfAway = (v, dp) => { const f = 10 ** dp; return (Math.sign(v) * Math.round(Math.abs(v) * f + 1e-9)) / f; };
/* 10000.03 mg -> "10.00003" g, without floating-point noise */
function mgToG(mg) {
  const [i, f = ''] = String(mg).split('.');
  const whole = i.padStart(4, '0');
  const g = whole.slice(0, -3).replace(/^0+(?=\d)/, '');
  return `${g}.${whole.slice(-3)}${f}`;
}
const hashGroups = (hex) => hex.match(/.{1,8}/g);

/* ---------- SHA-256 (synchronous; works in any context, including plain-HTTP iframes) ---------- */
const SHA_K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
function sha256(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const len = bytes.length;
  const total = ((len + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(total);
  buf.set(bytes); buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 4, (len * 8) >>> 0);
  dv.setUint32(total - 8, Math.floor((len * 8) / 4294967296));
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + hh) >>> 0;
  }
  return H.map((x) => x.toString(16).padStart(8, '0')).join('');
}

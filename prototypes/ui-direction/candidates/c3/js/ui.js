/* ui.js: the status vocabulary and small shared components. Each returns Raw html. */
(() => {
  'use strict';
  const LX = window.LX, { h, raw, icon } = LX, M = LX.M, T = LX.t;
  const U = (LX.U = {});

  /* ---------- Test state: seven notches, lit up to the state, plus the word ---------- */
  U.notch = (n, cls = '') => h`<span class="notch ${cls}" data-n="${n}" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>`;
  U.state = (state, { large = false } = {}) => {
    const n = M.stateNo(state);
    return h`<span class="state ${large ? 'state--l' : ''}">${U.notch(n, !n ? 'is-void' : state === 'Reported' ? 'is-done' : '')}<span>${state}</span></span>`;
  };

  /* ---------- GxP Class: the exception (non-GMP) is the loud one ---------- */
  U.gxp = (g) => (g === 'GMP'
    ? h`<span class="gxp gxp--gmp" title="GxP Class: GMP">GMP</span>`
    : h`<span class="gxp gxp--non" title="GxP Class: non-GMP. No Reviewer or QA release; the Test Report carries no accreditation mark.">non-GMP</span>`);
  U.service = (s) => (s === 'Expedited' ? h`<span class="svc svc--exp">${icon('bolt')}Expedited</span>` : h`<span class="svc">Standard</span>`);

  /* ---------- due date: overdue, due today, at risk, in n days ---------- */
  U.due = (d) => {
    switch (d.kind) {
      case 'overdue': return h`<span class="due due--overdue">${icon('alert')}Overdue ${d.days} d</span>`;
      case 'today': return h`<span class="due due--today">${icon('clock')}Due today</span>`;
      case 'risk': return h`<span class="due due--risk" title="At risk: due within two days">${icon('clock')}At risk, ${d.days} d</span>`;
      case 'ok': return h`<span class="due due--ok">in ${d.days} d</span>`;
      default: return h`<span class="due due--none">Set when Ready</span>`;
    }
  };

  /* ---------- Holds are their own record, drawn as hazard tape, never as a state ---------- */
  U.hold = (n) => h`<span class="hold">${n} ${n === 1 ? 'Hold' : 'Holds'}</span>`;
  U.risk = (level) => { const n = { Minor: 1, Major: 2, Critical: 3 }[level] ?? 1; return h`<span class="risk risk--${n}" role="img" aria-label="Risk Level ${level}"><i></i><i></i><i></i></span>`; };
  U.dev = (id) => {
    const d = M.deviation.get(id);
    return h`<span class="dev" title="${id}: ${d ? `${d.kind}, Risk Level ${d.risk}, ${d.state}` : ''}">${d ? U.risk(d.risk) : ''}${id}</span>`;
  };

  /* ---------- Fitness Status, always with its reason ---------- */
  const FIT_ICON = { 'In use': 'ok', Quarantined: 'diamond', Suspended: 'pause', Expired: 'clock', Retired: 'minus-circle' };
  U.fitKey = (s) => s.toLowerCase().replace(/\s+/g, '');
  U.fit = (status) => h`<span class="chip fit fit--${U.fitKey(status)}">${icon(FIT_ICON[status] ?? 'ok')}${status}</span>`;
  /* chip on the first line, reason under it */
  U.fitLine = (status, reason, cls = '') => h`<div class="fitline ${cls}">${U.fit(status)}<span class="fitline__why">${reason}</span></div>`;

  /* ---------- people ---------- */
  U.av = (p, { size = 2, me = false } = {}) => h`<span class="av ${me ? 'av--me' : ''}" style="--av:${size}rem" aria-hidden="true">${M.initials(p)}</span>`;
  U.native = (p) => (p.nativeName ? h`<span class="native" lang="${M.lang[p.id] ?? 'zh'}">${p.nativeName}</span>` : '');
  U.name = (p) => h`<span class="pname">${p.name}${p.nativeName ? h` ${U.native(p)}` : ''}</span>`;

  /* ---------- Record Version seal: dashed pencil until signed, solid ink after ---------- */
  U.seal = ({ version, hash, signed = false, label = true }) => h`<span class="seal ${signed ? 'seal--signed' : ''}" title="Record Version ${version}, SHA-256 ${hash.slice(0, 8)}${'…'} ${signed ? 'Signed' : 'Not signed yet'}">${icon(signed ? 'seal' : 'pencil')}${label ? h`<span class="seal__lbl">${signed ? 'Signed' : 'Unsigned'}</span>` : ''}<b>v${version}</b><span>${hash.slice(0, 8)}</span></span>`;
  U.hash = (hash, { lead = 8 } = {}) => {
    const groups = hash.match(/.{1,8}/g);
    return h`<span class="hash mono">${groups.map((g, i) => (i === 0 ? h`<b class="hash__lead" title="These ${lead} characters appear in the signature block">${g}</b>` : h`<span>${g}</span>`))}</span>`;
  };

  /* ---------- interlock lamps ---------- */
  U.lamp = (kind) => h`<span class="lamp lamp--${kind}" aria-hidden="true">${icon(kind === 'fault' ? 'x' : kind === 'wait' ? 'clock' : 'check')}</span>`;

  /* ---------- rulers: where a number sits against its limits ---------- */
  const pctOf = (v, d0, d1) => LX.clamp(((v - d0) / (d1 - d0)) * 100, 0, 100);
  /* Window ruler for readings. domain [d0,d1], acceptance band [b0,b1]; markers {v, kind, out} */
  U.rulerWindow = ({ d0, d1, b0, b1, markers = [], label = '', ticks = true, tick = (v) => m4(v) }) => {
    const p0 = pctOf(b0, d0, d1), p1 = pctOf(b1, d0, d1);
    return h`<div class="ruler" role="img" aria-label="${label}">
      <span class="ruler__track"></span>
      <span class="ruler__band" style="left:${p0}%;width:${Math.max(p1 - p0, 1)}%"></span>
      ${markers.map((m) => h`<span class="rm rm--${m.kind}${m.out ? ' is-out' : ''}" style="left:${pctOf(m.v, d0, d1)}%"></span>`)}
      ${ticks ? h`<span class="ruler__tick ruler__tick--lo" style="left:${p0}%">${tick(b0)}</span><span class="ruler__tick ruler__tick--hi" style="left:${p1}%">${tick(b1)}</span>` : ''}
    </div>`;
  };
  const m4 = (v) => String(Number.isInteger(v) ? v : +v.toFixed(3)).replace('-', '−');
  U.m4 = m4;
  /* Limit ruler for Reportable Results: LOQ and the limit sit at the same place on every row, log scale between */
  const A = 24, B = 76;
  U.limitPos = (v, loq, limit) => {
    if (!(v > 0)) return 3;
    if (v < loq) return LX.clamp(3 + (A - 3) * (1 + Math.log10(v / loq)), 2, A - 1);
    return LX.clamp(A + ((B - A) * Math.log(v / loq)) / Math.log(limit / loq), A, 98);
  };
  U.rulerLimit = ({ v, loq, limit, label, kind }) => h`<div class="ruler ruler--limit" role="img" aria-label="${label}">
    <span class="rz rz--loq" style="width:${A}%"></span><span class="rz rz--ok" style="left:${A}%;width:${B - A}%"></span><span class="rz rz--over" style="left:${B}%;right:0"></span>
    <span class="rt" style="left:${A}%"></span><span class="rt" style="left:${B}%"></span>
    ${kind === 'value' ? h`<span class="rm rm--cur" style="left:${U.limitPos(v, loq, limit)}%"></span>` : kind === 'loq' ? h`<span class="rm rm--loq" style="left:11%"></span>` : ''}
  </div>`;

  /* ---------- Electronic Signature block ---------- */
  U.sig = (s, { animate = false, wide = false } = {}) => {
    const p = M.person.get(s.personId); const at = new Date(s.at);
    return h`<section class="sigblock ${animate ? 'stamp-in' : ''} ${wide ? 'sigblock--wide' : ''}" aria-label="Electronic Signature block">
      <header class="sigblock__top">
        <span class="sigblock__meaning">${icon('seal', 'ico--l')}Signed ${s.meaning}</span>
        ${U.seal({ version: s.version, hash: s.hash, signed: true, label: false })}
      </header>
      <dl class="sigblock__grid">
        <dt>Printed name</dt><dd><b>${p.name}</b> ${U.native(p)}</dd>
        <dt>UTC</dt><dd class="mono">${T.stampUtc(at)}</dd>
        <dt>Username, role</dt><dd><span class="mono">${p.username}</span>, ${M.role(p)}, Lab ${M.L.lab.id}</dd>
        <dt>Lab time</dt><dd class="mono">${T.stampS(at)} <span class="muted">(${T.offset(at)}, ${T.zoneId})</span></dd>
        <dt>Signature Meaning</dt><dd><b>${s.meaning}</b></dd>
        <dt>Hash, first 8</dt><dd class="mono"><b>${s.hash.slice(0, 8)}</b></dd>
        <dt>Record Version</dt><dd class="mono"><b>${s.version}</b></dd>
      </dl>
      <p class="sigblock__stmt">“${M.L.signatureMeanings[s.meaning]}”</p>
    </section>`;
  };

  /* ---------- interlock list: each precondition is a lamp with a label ---------- */
  U.interlocks = (items) => h`<ul class="ilk">${items.map((c) => h`<li class="ilk__i ilk__i--${c.kind}" ${c.id ? raw(`data-ilk="${c.id}"`) : ''}>${U.lamp(c.kind)}<span>${c.label}</span></li>`)}</ul>`;
})();

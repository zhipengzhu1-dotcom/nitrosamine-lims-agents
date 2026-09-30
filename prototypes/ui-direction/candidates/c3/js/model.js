/* model.js: the server's answers (window.LIMS), indexed and derived for the screens.
   Everything a real build would fetch lives here; everything else is presentation. */
(() => {
  'use strict';
  const LX = window.LX, L = window.LIMS, T = LX.t;
  const M = (LX.M = { L });

  const byId = (arr) => new Map(arr.map((x) => [x.id, x]));
  M.person = byId(L.people); M.customer = byId(L.customers); M.product = byId(L.products);
  M.method = byId(L.methods); M.sample = byId(L.samples); M.deviation = byId(L.deviations.map((d) => ({ ...d })));
  M.equipment = byId(L.equipment.map((e) => ({ ...e }))); M.room = byId(L.rooms);
  M.byUser = new Map(L.people.map((p) => [p.username, p]));
  M.analysts = L.people.filter((p) => p.roles.includes('Analyst'));
  M.today = L.meta.labDay;
  M.lang = { u03: 'zh-Hans', u13: 'ja', u14: 'zh-Hans', u19: 'zh-Hans', u23: 'ja', u29: 'ko' };
  M.initials = (p) => p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  M.firstName = (p) => p.name.split(/\s+/)[0];
  M.role = (p) => p.roles[0];

  /* ---------- Tests ---------- */
  M.OPEN_STATES = ['Requested', 'Accepted', 'Ready', 'Assigned', 'In Progress', 'Submitted for Review', 'Reviewed'];
  M.CLOSED = new Set(['Reported', 'Rejected', 'Cancelled', 'Invalidated']);
  const NO = { Requested: 1, Accepted: 2, Ready: 3, Assigned: 4, 'In Progress': 5, 'Submitted for Review': 6, Reviewed: 7, Reported: 7 };
  M.stateNo = (s) => NO[s] ?? 0;

  /* due: calendar days from the Lab day; at risk means due within two days */
  const dueOf = (t, open) => {
    if (!t.dueDate || !open) return { kind: 'none' };
    const d = T.dayDiff(M.today, t.dueDate);
    if (d < 0) return { kind: 'overdue', days: -d, date: t.dueDate };
    if (d === 0) return { kind: 'today', days: 0, date: t.dueDate };
    if (d <= 2) return { kind: 'risk', days: d, date: t.dueDate };
    return { kind: 'ok', days: d, date: t.dueDate };
  };

  function derive(r) {
    const t = r.t; const last = t.history[t.history.length - 1];
    r.state = t.state; r.no = M.stateNo(t.state); r.open = !M.CLOSED.has(t.state);
    r.since = new Date(last.at);
    r.assignee = t.assigneeId ? M.person.get(t.assigneeId) : null;
    r.holds = t.holds; r.nHolds = t.holds.length;
    r.due = dueOf(t, r.open);
    r.hay = [t.id, t.sampleId, t.submissionId, r.sample.lot, r.sample.customerRef, r.product.code, r.product.name, r.customer.name, t.methodNumber, r.method.title, ...t.deviationIds, t.retestOf ?? '', r.assignee?.name ?? '', r.assignee?.username ?? '']
      .join(' ').toLowerCase();
    return r;
  }
  M.derive = derive;
  const cloneTest = (t) => ({ ...t, history: t.history.map((e) => ({ ...e })), holds: t.holds.map((x) => ({ ...x })), deviationIds: [...t.deviationIds] });
  M.rows = L.tests.map((t0) => { const t = cloneTest(t0); return derive({ t, id: t.id, sample: M.sample.get(t.sampleId), product: M.product.get(t.productId), customer: M.customer.get(t.customerId), method: M.method.get(t.methodId) }); });
  M.rowById = new Map(M.rows.map((r) => [r.id, r]));
  M.focusRow = M.rowById.get(L.focus.test.testId);
  M.assignRowId = L.focus.assignTestId;
  M.openRows = () => M.rows.filter((r) => r.open);

  /* the next Ready Test to assign: the server's pick first, then Expedited, then earliest due */
  M.nextReady = () => {
    const ready = M.rows.filter((r) => r.state === 'Ready');
    const pinned = ready.find((r) => r.id === M.assignRowId);
    if (pinned) return pinned;
    return ready.sort((a, b) => (a.t.serviceLevel === b.t.serviceLevel ? 0 : a.t.serviceLevel === 'Expedited' ? -1 : 1) || String(a.t.dueDate).localeCompare(String(b.t.dueDate)))[0] ?? null;
  };

  /* workload of every Analyst: open means Assigned or In Progress, as the server counts it */
  M.workload = () => {
    const w = new Map(M.analysts.map((p) => [p.id, { p, assigned: 0, ip: 0, open: 0, overdue: 0, review: 0 }]));
    for (const r of M.rows) {
      const e = r.assignee && w.get(r.assignee.id); if (!e || !r.open) continue;
      if (r.state === 'Assigned') e.assigned++;
      else if (r.state === 'In Progress') e.ip++;
      else e.review++;
      if (r.due.kind === 'overdue' && (r.state === 'Assigned' || r.state === 'In Progress')) e.overdue++;
    }
    for (const e of w.values()) e.open = e.assigned + e.ip;
    return w;
  };

  /* Assignment refusals: the server's list for the Test awaiting assignment, the same rules for the rest */
  const reasonsFor = (p, method) => {
    const out = [];
    const tr = (n, v) => L.trainingRecords.find((x) => x.personId === p.id && x.documentNumber === n && x.version === v);
    if (!tr(method.number, method.version)) out.push(`No Training Record on ${method.number} v${method.version} (Effective ${method.effectiveDate})`);
    const pre = L.prerequisites;
    if (!tr(pre.documentNumber, pre.version)) out.push(`No Training Record on ${pre.documentNumber} v${pre.version}`);
    const au = L.authorisations.find((x) => x.personId === p.id && x.meaning === 'Performed' && x.scope === method.number);
    if (!au) out.push(`No Performed Authorisation for ${method.number}`);
    else if (au.status === 'Suspended') out.push(`Performed Authorisation suspended (${au.suspendedBy})`);
    else if (au.validUntil < M.today) out.push(`Performed Authorisation expired ${au.validUntil}`);
    return out;
  };
  M.eligibility = (row) => {
    const server = row.id === M.assignRowId ? new Map(L.focus.assignEligibility.map((e) => [e.personId, e.reasons])) : null;
    const load = M.workload();
    return M.analysts.map((p) => ({ p, reasons: server ? server.get(p.id) ?? [] : reasonsFor(p, row.method), load: load.get(p.id) }));
  };

  /* Assignment is audited, not signed */
  M.assign = (row, person, by, at) => {
    row.t.assigneeId = person.id; row.t.state = 'Assigned';
    row.t.history.push({ state: 'Assigned', at: at.toISOString(), by: by.id });
    derive(row);
  };
  M.submitForReview = (row, by, at) => {
    row.t.state = 'Submitted for Review';
    row.t.history.push({ state: 'Submitted for Review', at: at.toISOString(), by: by.id });
    derive(row);
  };

  /* ---------- holds and Deviations ---------- */
  M.blocksText = (b) => String(b ?? '').replace(/→\s*/g, 'moving to ').replace(/^./, (c) => c.toUpperCase());
  M.holdReleaser = (h) => (h.releasedBy ? `${h.releasedBy} releases it` : h.causedByCustomer ? 'The Customer’s answer releases it' : 'Released through its Deviation');

  /* ---------- equipment, Fitness Status, reasons ---------- */
  M.fitness = (id) => {
    const e = M.equipment.get(id); if (!e) return { status: 'In use', reason: '' };
    const reason = e.reason ?? `Approved into service, every blocking Check current. Next Check due ${e.nextDue}`;
    return { status: e.fitness, reason, e };
  };

  /* ---------- the focus Test's bench record ---------- */
  const F = (M.focus = L.focus.test);
  M.analytes = F.results.map((r) => r.analyte);
  M.ppm = (v) => (v == null ? '' : Number(v).toFixed(4));
  M.pg = (v) => (typeof v === 'number' ? Number(v).toFixed(3) : v === 'Below RL' ? '< LOQ' : v == null ? 'Not detected' : String(v));
  /* injection matrix: analyte -> prep -> inj -> injection */
  M.inj = (analyte, prep, inj) => F.injections.find((i) => i.analyte === analyte && i.prep === prep && i.inj === inj);
  M.flags = () => F.results.flatMap((r) => r.flags.map((f) => ({ ...f, analyte: r.analyte })));
  M.runChecksSummary = () => {
    const c = F.run.checks;
    const ccv = c.ccv.map((x) => x.recoveryPct);
    return {
      calibration: { pass: c.calibration.filter((x) => x.pass).length, of: c.calibration.length, range: [Math.min(...c.calibration.map((x) => x.r2)), Math.max(...c.calibration.map((x) => x.r2))] },
      ccv: { pass: c.ccv.filter((x) => x.pass).length, of: c.ccv.length, range: [Math.min(...ccv), Math.max(...ccv)], limits: c.ccv[0].limits },
      blanks: { pass: c.blanks.filter((x) => x.pass).length, of: c.blanks.length },
      loq: { pass: c.loqSignalToNoise.filter((x) => x.pass).length, of: c.loqSignalToNoise.length, low: Math.min(...c.loqSignalToNoise.map((x) => x.sn)), limit: c.loqSignalToNoise[0].limit },
    };
  };

  /* ---------- a failed Check acts on the rest of the lab ---------- */
  let devSeq = 93;
  M.openDeviation = ({ kind, risk, title, by, at }) => {
    const id = `DEV-26-${String(++devSeq).padStart(4, '0')}`;
    const d = { id, kind, risk, state: 'Open', title, openedAt: at.toISOString(), investigatorId: by.id, dueDate: T.date(new Date(at.getTime() + 28 * 864e5)) };
    M.deviation.set(id, d); return d;
  };
  M.holdTestsCiting = (equipmentId, n, dev, at) => {
    const pool = M.rows.filter((r) => (r.state === 'In Progress' || r.state === 'Submitted for Review') && !r.nHolds && r.t.methodId !== 'M10').sort((a, b) => a.id.localeCompare(b.id)).slice(0, n);
    for (const r of pool) { r.t.holds.push({ kind: 'Equipment Deviation', reason: `${equipmentId} failed its daily Check; Tests weighed on ${equipmentId} since its last passing Check`, blocks: '\u2192 Reviewed', deviationId: dev.id, openedAt: at.toISOString() }); r.t.deviationIds.push(dev.id); derive(r); }
    return pool.length;
  };

  /* ---------- today's Checks ---------- */
  const groupOf = (c) => (c.targetKind === 'Room' ? 'rooms' : /^(FRZ|CMB)/.test(c.target) ? 'storage' : /^BAL/.test(c.target) ? 'balances' : 'other');
  M.GROUPS = [['rooms', 'Rooms'], ['storage', 'Storage units'], ['balances', 'Balances'], ['other', 'Water and other Equipment']];
  const nameOf = (c) => {
    if (c.targetKind === 'Room') return M.room.get(c.target).name;
    const e = M.equipment.get(c.target);
    return c.compartment ? `Combination unit, ${c.compartment.charAt(0).toLowerCase()}${c.compartment.slice(1)}` : e.name;
  };
  M.checks = L.checksToday.map((c) => ({ ...c, group: groupOf(c), name: nameOf(c), values: c.values ? { ...c.values } : undefined }));
  M.checkById = new Map(M.checks.map((c) => [c.id, c]));
  M.CHECK_STATUSES = ['Done', 'Due', 'Due soon', 'Overdue', 'Blocked', 'Not used today'];
  M.alarm = { ...L.missedChecks[0], state: 'awaiting' };
  M.nextCheck = () => M.checks.find((c) => c.status === 'Due' && c.group !== 'balances') ?? M.checks.find((c) => c.status === 'Due');
})();

// Seeded generator for the fictional R&D lab dataset shared by every UI direction.
// node gen-data.mjs  ->  data.js (window.LIMS) + fixtures/*.txt
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SEED = 20260930;

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const uni = (a, b) => a + (b - a) * rnd();
const int = (a, b) => Math.floor(uni(a, b + 1));
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const chance = (p) => rnd() < p;
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const weighted = (pairs) => { const total = pairs.reduce((s, [, w]) => s + w, 0); let r = rnd() * total; for (const [x, w] of pairs) { if ((r -= w) <= 0) return x; } return pairs[pairs.length - 1][0]; };
const pad = (n, w) => String(n).padStart(w, '0');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

// ---------- clock: Lab RD is in America/New_York; Aug-Sep 2026 is EDT (UTC-4) ----------
const OFFSET_H = -4;
const NOW = new Date('2026-09-30T14:40:00Z'); // 10:40 local, Wednesday
const HOLIDAYS = new Set(['2026-09-07']); // Labor Day
const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const localDay = (d) => new Date(d.getTime() + OFFSET_H * 3600e3).toISOString().slice(0, 10);
const isBusinessDay = (day) => { const wd = new Date(day + 'T12:00:00Z').getUTCDay(); return wd !== 0 && wd !== 6 && !HOLIDAYS.has(day); };
const atLocal = (day, h, m = 0) => new Date(Date.parse(day + 'T00:00:00Z') + ((h - OFFSET_H) * 60 + m) * 60e3);
function addBusinessDays(day, n) {
  let d = new Date(day + 'T12:00:00Z'); let left = n;
  while (left > 0) { d = new Date(d.getTime() + 864e5); if (isBusinessDay(d.toISOString().slice(0, 10))) left--; }
  return d.toISOString().slice(0, 10);
}
// Advance a timestamp by fractional business days, landing inside 08:00-17:30 local.
function advance(t, bdays) {
  let day = localDay(t);
  let hour = (t.getTime() - Date.parse(day + 'T00:00:00Z')) / 3600e3 + OFFSET_H;
  let hours = bdays * 9.5;
  if (!isBusinessDay(day) || hour >= 17.5) { day = addBusinessDays(day, 1); hour = 8; }
  if (hour < 8) hour = 8;
  while (hour + hours > 17.5) { hours -= 17.5 - hour; day = addBusinessDays(day, 1); hour = 8; }
  hour += hours;
  return atLocal(day, Math.floor(hour), Math.floor((hour % 1) * 60));
}
const businessDaysBetween = (a, b) => { let n = 0; let d = a; while (d < b) { d = addBusinessDays(d, 1); n++; } return n; };

// ---------- people ----------
const people = [
  ['u01', 'hkowalski', 'Hannah Kowalski', null, ['Lab Manager']],
  ['u02', 'madeyemi', 'Marcus Adeyemi', null, ['Lab Manager']],
  ['u03', 'wzhang', 'Wei Zhang', '张伟', ['Lab Manager']],
  ['u04', 'gokafor', 'Grace Okafor', null, ['QA']],
  ['u05', 'treyes', 'Tomás Reyes', null, ['QA']],
  ['u06', 'ralvarez', 'Ruth Alvarez', null, ['Sample Custodian']],
  ['u07', 'kmensah', 'Kofi Mensah', null, ['Sample Custodian']],
  ['u10', 'praman', 'Priya Raman', null, ['Analyst']],
  ['u11', 'dcho', 'Daniel Cho', null, ['Analyst', 'Reviewer']],
  ['u12', 'abello', 'Aisha Bello', null, ['Analyst']],
  ['u13', 'kwatanabe', 'Kenji Watanabe', '渡辺 健二', ['Analyst']],
  ['u14', 'zling', 'Zhou Ling', '周玲', ['Analyst', 'Reviewer']],
  ['u15', 'smarino', 'Sofia Marino', null, ['Analyst']],
  ['u16', 'jfeld', 'Jonah Feld', null, ['Analyst']],
  ['u17', 'fhaddad', 'Fatima Haddad', null, ['Analyst', 'Reviewer']],
  ['u18', 'loconnor', "Liam O'Connor", null, ['Analyst']],
  ['u19', 'mchen', 'Mei Chen', '陈美', ['Analyst']],
  ['u20', 'riyer', 'Rahul Iyer', null, ['Analyst', 'Reviewer']],
  ['u21', 'ogrant', 'Olivia Grant', null, ['Analyst']],
  ['u22', 'msilva', 'Mateo Silva', null, ['Analyst']],
  ['u23', 'ytanaka', 'Yuki Tanaka', '田中 由紀', ['Analyst', 'Reviewer']],
  ['u24', 'sosei', 'Samuel Osei', null, ['Analyst']],
  ['u25', 'cdubois', 'Chloé Dubois', null, ['Analyst']],
  ['u26', 'amehta', 'Arjun Mehta', null, ['Analyst']],
  ['u27', 'nlindqvist', 'Nora Lindqvist', null, ['Analyst', 'Reviewer']],
  ['u28', 'ebrooks', 'Ethan Brooks', null, ['Analyst']],
  ['u29', 'hkim', 'Hana Kim', '김하나', ['Analyst']],
].map(([id, username, name, nativeName, roles]) => ({ id, username, name, nativeName, roles, lab: 'RD', signingEnabled: true }));
const analysts = people.filter((p) => p.roles.includes('Analyst'));
const byUsername = Object.fromEntries(people.map((p) => [p.username, p]));
const trainee = byUsername.amehta;

// ---------- customers, products ----------
const customers = [
  ['C01', 'Harlow & Finch Pharmaceuticals', 'US', 'external'],
  ['C02', 'Juniper Ridge APIs', 'US', 'external'],
  ['C03', 'Kestrel Bay Pharma', 'US', 'external'],
  ['C04', 'Larchmont Fine Chemicals', 'US', 'external'],
  ['C05', 'Meridian Crest Therapeutics', 'US', 'external'],
  ['C06', 'Orchard Vale Generics', 'IE', 'external'],
  ['C07', 'Pinewick Pharma GmbH', 'DE', 'external'],
  ['C08', 'Quarry Hill Pharma', 'US', 'external'],
  ['C09', 'Redfern Synthesis Ltd', 'GB', 'external'],
  ['C10', 'Hoshizora Pharma K.K.', 'JP', 'external'],
  ['C11', 'Yunhai Pharmaceutical Co., Ltd.', 'CN', 'external'],
  ['C12', 'Silverleaf Health', 'US', 'external'],
  ['C13', 'Process Development (internal)', 'US', 'internal'],
  ['C14', 'Formulation R&D (internal)', 'US', 'internal'],
].map(([id, name, country, kind]) => ({ id, name, country, kind }));

const METHODS = [
  { id: 'M01', number: 'CO-MTH-0003', version: 4, effectiveDate: '2026-09-14', technique: 'LC-MS/MS', title: 'Six nitrosamines in sartan APIs', analytes: ['NDMA', 'NDEA', 'NEIPA', 'NDIPA', 'NDBA', 'NMBA'], tat: { Standard: 10, Expedited: 5 }, price: { Standard: 950, Expedited: 1425 }, weight: 30 },
  { id: 'M02', number: 'CO-MTH-0005', version: 2, effectiveDate: '2026-03-02', technique: 'LC-MS/MS', title: 'NDMA in metformin HCl', analytes: ['NDMA'], tat: { Standard: 10, Expedited: 5 }, price: { Standard: 780, Expedited: 1170 }, weight: 16 },
  { id: 'M03', number: 'CO-MTH-0007', version: 3, effectiveDate: '2025-11-17', technique: 'LC-MS/MS', title: 'NDMA in ranitidine HCl', analytes: ['NDMA'], tat: { Standard: 10, Expedited: 5 }, price: { Standard: 780, Expedited: 1170 }, weight: 3 },
  { id: 'M04', number: 'CO-MTH-0011', version: 1, effectiveDate: '2026-05-11', technique: 'LC-MS/MS', title: 'NTTP in sitagliptin phosphate', analytes: ['NTTP'], tat: { Standard: 12, Expedited: 6 }, price: { Standard: 1150, Expedited: 1725 }, weight: 9 },
  { id: 'M05', number: 'CO-MTH-0012', version: 2, effectiveDate: '2026-01-19', technique: 'LC-MS/MS', title: 'MeNP in rifampicin', analytes: ['MeNP'], tat: { Standard: 12, Expedited: 6 }, price: { Standard: 1150, Expedited: 1725 }, weight: 6 },
  { id: 'M06', number: 'CO-MTH-0014', version: 1, effectiveDate: '2026-06-22', technique: 'LC-MS/MS', title: 'N-nitroso-varenicline in varenicline tartrate', analytes: ['NNV'], tat: { Standard: 12, Expedited: 6 }, price: { Standard: 1250, Expedited: 1875 }, weight: 5 },
  { id: 'M07', number: 'CO-MTH-0016', version: 1, effectiveDate: '2026-07-27', technique: 'LC-MS/MS', title: 'N-nitroso-propranolol in propranolol HCl', analytes: ['NNP'], tat: { Standard: 12, Expedited: 6 }, price: { Standard: 1250, Expedited: 1875 }, weight: 5 },
  { id: 'M08', number: 'CO-MTH-0009', version: 2, effectiveDate: '2025-10-06', technique: 'GC-MS/MS', title: 'Volatile nitrosamines by headspace GC-MS/MS', analytes: ['NDMA', 'NDEA', 'NEIPA', 'NDIPA', 'NDBA'], tat: { Standard: 10, Expedited: 5 }, price: { Standard: 890, Expedited: 1335 }, weight: 10 },
  { id: 'M09', number: 'CO-MTH-0018', version: 1, effectiveDate: '2026-04-06', technique: 'LC-MS/MS', title: 'Nitrite in excipients (DAN derivatisation)', analytes: ['Nitrite'], tat: { Standard: 8, Expedited: 4 }, price: { Standard: 620, Expedited: 930 }, weight: 8 },
  { id: 'M10', number: 'CO-MTH-0020', version: 1, effectiveDate: '2026-02-16', technique: 'ICP-MS', title: 'Elemental impurities, ICH Q3D Class 1 and 2A', analytes: ['Cd', 'Pb', 'As', 'Hg', 'Co', 'V', 'Ni'], tat: { Standard: 10, Expedited: 5 }, price: { Standard: 840, Expedited: 1260 }, weight: 8 },
];
const methodById = Object.fromEntries(METHODS.map((m) => [m.id, m]));

// FDA acceptable intakes (ng/day), as summarised in origin/research/nitrosamines:docs/research/nitrosamines.md.
// W = CDER Nitrosamine Impurity Acceptable Intake Limits web page, revision 30 (content current as of 2026-09-24).
// G = Control of Nitrosamine Impurities in Human Drugs, Guidance for Industry, Revision 2 (September 2024).
// NNV and NNP are left out: the research does not cover them, so they have no AI here.
const AI = {
  NDMA: 96, // W Table 2
  NDEA: 26.5, // W Table 2
  NEIPA: 400, // W Table 1, CPCA category 3
  NDIPA: 1500, // W Table 1, CPCA category 5
  NDBA: 26.5, // not listed on W; the 26.5 ng/day default, G p.13
  NMBA: 1500, // W Table 1, CPCA category 4
  NTTP: 100, // W Table 1, CPCA-based
  MeNP: 400, // W Table 1, CPCA-based (MNP in rifampin)
};
const AI_SOURCE = 'FDA CDER Nitrosamine Impurity Acceptable Intake Limits, revision 30 (2026-09-24); NDBA uses the 26.5 ng/day default of the Revision 2 guidance (Sep 2024)';

const API = [
  ['Valsartan', 320, ['M01', 'M08'], 'VAL'], ['Losartan potassium', 100, ['M01', 'M08'], 'LOS'], ['Irbesartan', 300, ['M01'], 'IRB'],
  ['Candesartan cilexetil', 32, ['M01'], 'CAN'], ['Olmesartan medoxomil', 40, ['M01'], 'OLM'], ['Telmisartan', 80, ['M01'], 'TEL'],
  ['Metformin HCl', 2550, ['M02', 'M08', 'M10'], 'MET'], ['Ranitidine HCl', 300, ['M03'], 'RAN'], ['Sitagliptin phosphate', 100, ['M04', 'M10'], 'SIT'],
  ['Rifampicin', 600, ['M05'], 'RIF'], ['Varenicline tartrate', 2, ['M06'], 'VAR'], ['Propranolol HCl', 640, ['M07'], 'PRO'],
  ['Microcrystalline cellulose', null, ['M09'], 'MCC'], ['Crospovidone', null, ['M09'], 'CRO'], ['Lactose monohydrate', null, ['M09'], 'LAC'],
];
const products = [];
for (const c of customers) {
  const n = c.kind === 'internal' ? 3 : int(2, 4);
  const pool = [...API].sort(() => rnd() - 0.5).slice(0, n);
  for (const [api, mdd, methods, code] of pool) {
    products.push({ id: `P${pad(products.length + 1, 3)}`, customerId: c.id, name: api, code: `${c.id}-${code}-${int(10, 99)}`, maxDailyDoseMg: mdd, methodIds: methods, kind: mdd ? 'API' : 'Excipient' });
  }
}
// Make sure the showcase product exists.
const focusProduct = { id: `P${pad(products.length + 1, 3)}`, customerId: 'C01', name: 'Valsartan', code: 'C01-VAL-27', maxDailyDoseMg: 320, methodIds: ['M01', 'M08'], kind: 'API' };
products.push(focusProduct);

// ---------- training records and Authorisations (Performed, per Method, Lab RD) ----------
const authorisations = []; const trainingRecords = []; const eligibilityNotes = {};
const authorisedOn = {
  M01: analysts.filter((a) => a !== trainee).map((a) => a.id),
  M02: ['u10', 'u11', 'u12', 'u13', 'u15', 'u17', 'u18', 'u19', 'u21', 'u22', 'u24', 'u27'],
  M03: ['u11', 'u14', 'u17', 'u20', 'u23', 'u28'],
  M04: ['u10', 'u12', 'u14', 'u19', 'u20', 'u22', 'u25', 'u29'],
  M05: ['u11', 'u15', 'u20', 'u22', 'u23', 'u27'],
  M06: ['u10', 'u14', 'u17', 'u25', 'u27'],
  M07: ['u12', 'u16', 'u20', 'u23', 'u29'],
  M08: ['u13', 'u18', 'u21', 'u24', 'u28'],
  M09: ['u12', 'u15', 'u16', 'u19', 'u24', 'u26'],
  M10: ['u18', 'u21', 'u25', 'u28'],
};
for (const m of METHODS) {
  for (const a of analysts) {
    const authorised = authorisedOn[m.id].includes(a.id);
    const trainedCurrent = authorised || chance(0.15);
    if (trainedCurrent || authorised) {
      trainingRecords.push({ personId: a.id, documentNumber: m.number, version: m.version, level: 'Demonstrated', signedAt: iso(atLocal(addBusinessDays(m.effectiveDate, -int(3, 12)), int(9, 16))) });
      if (m.version > 1) trainingRecords.push({ personId: a.id, documentNumber: m.number, version: m.version - 1, level: 'Demonstrated', signedAt: '2025-06-12T15:00:00Z' });
    }
    if (authorised) {
      const validUntil = addBusinessDays('2026-09-30', int(8, 230));
      authorisations.push({ personId: a.id, meaning: 'Performed', scope: m.number, lab: 'RD', validFrom: addBusinessDays(validUntil, -250), validUntil, status: 'Current' });
    }
  }
}
// Deliberate gate cases on the sartan Method (CO-MTH-0003 v4 became Effective on 14 Sep).
const noV4 = ['u16', 'u21', 'u24', 'u29'];
for (const pid of noV4) {
  const i = trainingRecords.findIndex((t) => t.personId === pid && t.documentNumber === 'CO-MTH-0003' && t.version === 4);
  if (i >= 0) trainingRecords.splice(i, 1);
}
const expire = authorisations.find((x) => x.personId === 'u18' && x.scope === 'CO-MTH-0003');
expire.validUntil = '2026-09-22'; expire.status = 'Expired';
const susp = authorisations.find((x) => x.personId === 'u22' && x.scope === 'CO-MTH-0003');
susp.status = 'Suspended'; susp.suspendedBy = 'DEV-26-0079';
for (const pid of ['u11', 'u14', 'u17', 'u20', 'u23', 'u27']) {
  for (const m of METHODS) if (authorisedOn[m.id].includes(pid) || chance(0.3)) authorisations.push({ personId: pid, meaning: 'Reviewed', scope: m.number, lab: 'RD', validFrom: '2026-01-05', validUntil: addBusinessDays('2026-09-30', int(20, 200)), status: 'Current' });
}
for (const pid of ['u04', 'u05']) authorisations.push({ personId: pid, meaning: 'Released', scope: 'Test Report', lab: 'RD', validFrom: '2026-01-05', validUntil: '2027-01-04', status: 'Current' });
const prerequisites = { documentNumber: 'RD-SOP-0004', version: 6, title: 'Use of the LIMS at the bench' };
for (const a of analysts) trainingRecords.push({ personId: a.id, documentNumber: prerequisites.documentNumber, version: prerequisites.version, level: 'Read and Understood', signedAt: '2026-02-03T14:00:00Z' });

function eligibility(personId, method, at) {
  const reasons = [];
  const tr = trainingRecords.find((t) => t.personId === personId && t.documentNumber === method.number && t.version === method.version);
  if (!tr) reasons.push(`No Training Record on ${method.number} v${method.version} (Effective ${method.effectiveDate})`);
  const au = authorisations.find((x) => x.personId === personId && x.meaning === 'Performed' && x.scope === method.number);
  if (!au) reasons.push(`No Performed Authorisation for ${method.number}`);
  else if (au.status === 'Suspended') reasons.push(`Performed Authorisation suspended (${au.suspendedBy})`);
  else if (au.validUntil < at) reasons.push(`Performed Authorisation expired ${au.validUntil}`);
  return reasons;
}

// ---------- equipment, rooms ----------
const rooms = [
  { id: 'RD-101', name: 'Sample receipt', storage: false, limits: { tempC: [18, 26], rhPct: [20, 70] } },
  { id: 'RD-102', name: 'Preparation lab', storage: false, limits: { tempC: [18, 25], rhPct: [25, 65] } },
  { id: 'RD-103', name: 'Instrument room', storage: false, limits: { tempC: [18, 24], rhPct: [25, 60] } },
  { id: 'RD-104', name: 'Balance room', storage: false, limits: { tempC: [19, 24], rhPct: [30, 60] } },
  { id: 'RD-105', name: 'Ambient storage', storage: true, limits: { tempC: [15, 25], rhPct: [20, 60] } },
];
const equipment = [
  { id: 'LCMS-01', kind: 'LC-MS/MS', name: 'Waters Xevo TQ-S micro', room: 'RD-103', fitness: 'Suspended', reason: 'Open Deviation DEV-26-0090 (failed CCV on RUN-LCMS01-260928-02)', nextDue: '2026-11-20' },
  { id: 'LCMS-02', kind: 'LC-MS/MS', name: 'Waters Xevo TQ-XS', room: 'RD-103', fitness: 'In use', nextDue: '2027-01-15', software: 'MassLynx 4.2 SCN1045' },
  { id: 'LCMS-03', kind: 'LC-MS/MS', name: 'Waters Xevo TQ Absolute', room: 'RD-103', fitness: 'In use', nextDue: '2026-12-02', software: 'MassLynx 4.2 SCN1045' },
  { id: 'GCMS-01', kind: 'GC-MS/MS', name: 'Agilent 8890/7010C', room: 'RD-103', fitness: 'In use', nextDue: '2026-10-28' },
  { id: 'ICPMS-01', kind: 'ICP-MS', name: 'Agilent 7900', room: 'RD-103', fitness: 'In use', nextDue: '2027-02-09' },
  { id: 'BAL-01', kind: 'Balance', name: 'Micro balance, 6-place', room: 'RD-104', fitness: 'In use', minWeightMg: 2.1, nextDue: '2027-03-01' },
  { id: 'BAL-02', kind: 'Balance', name: 'Semi-micro balance, 5-place', room: 'RD-104', fitness: 'In use', minWeightMg: 8.2, nextDue: '2027-03-01' },
  { id: 'BAL-03', kind: 'Balance', name: 'Analytical balance, 5-place', room: 'RD-104', fitness: 'Suspended', reason: 'Failed daily Check on 29 Sep (DEV-26-0091)', minWeightMg: 11.5, nextDue: '2027-03-01' },
  { id: 'BAL-04', kind: 'Balance', name: 'Analytical balance, 4-place', room: 'RD-102', fitness: 'In use', minWeightMg: 82, nextDue: '2027-03-01' },
  { id: 'BAL-05', kind: 'Balance', name: 'Top-loading balance, 2-place', room: 'RD-102', fitness: 'In use', minWeightMg: 2000, nextDue: '2027-03-01' },
  ...Array.from({ length: 12 }, (_, i) => ({ id: `PIP-${pad(i + 1, 2)}`, kind: 'Pipette', name: ['100–1000 µL single-channel', '10–100 µL single-channel', '1–10 mL single-channel'][i % 3], room: 'RD-102', fitness: i === 10 ? 'Expired' : 'In use', reason: i === 10 ? 'Quarterly gravimetric Check overdue since 2026-09-26' : undefined, nextDue: i === 10 ? '2026-09-26' : i === 6 ? '2026-10-05' : addBusinessDays('2026-09-30', int(8, 60)) })),
  { id: 'PH-01', kind: 'pH meter', name: 'Benchtop pH meter', room: 'RD-102', fitness: 'In use', nextDue: '2027-01-20' },
  { id: 'KF-01', kind: 'KF titrator', name: 'Volumetric Karl Fischer titrator', room: 'RD-102', fitness: 'In use', nextDue: '2026-12-14' },
  { id: 'FRZ-01', kind: 'Freezer', name: '−80 °C freezer', room: 'RD-105', fitness: 'In use', setpoint: '−80 °C', nextDue: '2027-04-10' },
  { id: 'FRZ-02', kind: 'Freezer', name: '−20 °C freezer', room: 'RD-105', fitness: 'In use', setpoint: '−20 °C', nextDue: '2027-04-10' },
  { id: 'FRZ-03', kind: 'Freezer', name: '−20 °C freezer', room: 'RD-102', fitness: 'Suspended', blocks: 'new placements', reason: 'Excursion since 29 Sep 08:06 (max −12.4 °C) · DEV-26-0093', setpoint: '−20 °C', nextDue: '2027-04-10' },
  { id: 'CMB-01', kind: 'Combination unit', name: '−20 °C / 3–8 °C combination unit', room: 'RD-105', fitness: 'In use', setpoint: '−20 °C and 3–8 °C', nextDue: '2027-04-10' },
  { id: 'DIW-01', kind: 'DI water dispenser', name: 'Type 1 water dispenser', room: 'RD-102', fitness: 'In use', nextDue: '2026-11-03' },
  { id: 'CW-01', kind: 'Check weights', name: 'Check-weight set, OIML E2 (1 mg–200 g)', room: 'RD-104', fitness: 'In use', certificate: 'CAL-26-0412', nextDue: '2027-05-18' },
  { id: 'THM-01', kind: 'Reference thermometer', name: 'Reference thermometer', room: 'RD-102', fitness: 'In use', certificate: 'CAL-26-0377', nextDue: '2027-02-02' },
];

// ---------- Deviations ----------
const deviations = [
  { id: 'DEV-26-0093', kind: 'Excursion', risk: 'Major', state: 'Investigating', title: 'FRZ-03 maximum −12.4 °C at 29 Sep reading (limit −15 °C)', openedAt: '2026-09-29T12:06:00Z', investigatorId: 'u03' },
  { id: 'DEV-26-0091', kind: 'Equipment', risk: 'Major', state: 'Open', title: 'BAL-03 failed daily verification: 100 g weight read +0.071 % (limit ±0.05 %)', openedAt: '2026-09-29T12:22:00Z', investigatorId: 'u02' },
  { id: 'DEV-26-0090', kind: 'Run Check Failure', risk: 'Major', state: 'Investigating', title: 'CCV-3 recovery 131 % for NDEA on RUN-LCMS01-260928-02 (limit 80–120 %)', openedAt: '2026-09-28T19:40:00Z', investigatorId: 'u01' },
  { id: 'DEV-26-0088', kind: 'OOS', risk: 'Major', state: 'Investigating', title: 'NDEA 0.31 ppm in Losartan potassium (limit 0.265 ppm: 26.5 ng/day ÷ 100 mg)', openedAt: '2026-09-25T15:10:00Z', investigatorId: 'u01' },
  { id: 'DEV-26-0087', kind: 'Procedure', risk: 'Minor', state: 'In QA Review', title: 'Sample left at room temperature 2 h before placement in CMB-01', openedAt: '2026-09-21T14:00:00Z', investigatorId: 'u06' },
  { id: 'DEV-26-0085', kind: 'Material', risk: 'Major', state: 'Investigating', title: 'NDEA-d10 internal standard Solution SOL-26-0419 used 1 day past its stability', openedAt: '2026-09-24T13:30:00Z', investigatorId: 'u02' },
  { id: 'DEV-26-0083', kind: 'Room', risk: 'Minor', state: 'In QA Review', title: 'RD-104 humidity 63 % on 18 Sep (limit 60 %)', openedAt: '2026-09-18T12:40:00Z', investigatorId: 'u03' },
  { id: 'DEV-26-0079', kind: 'Other', risk: 'Major', state: 'Investigating', title: 'Competence Assessment line failed: CO-MTH-0003, observed Run', openedAt: '2026-09-16T17:00:00Z', investigatorId: 'u02' },
  { id: 'DEV-26-0076', kind: 'Proficiency Testing', risk: 'Major', state: 'Investigating', title: 'PT scheme round NIT-26-2: NDMA z-score 3.4 (unsatisfactory); ANAB notified 15 Sep', openedAt: '2026-09-14T13:00:00Z', investigatorId: 'u01' },
  { id: 'DEV-26-0071', kind: 'Data Integrity', risk: 'Critical', state: 'In QA Review', title: 'Audit anchor missed 02:15–02:45 on 9 Sep (System Incident SI-26-0012)', openedAt: '2026-09-09T13:05:00Z', investigatorId: 'u04' },
];
for (const d of deviations) d.dueDate = addBusinessDays(localDay(new Date(d.openedAt)), 20);

// ---------- Submissions, Samples, Tests ----------
const submissions = []; const samples = []; const tests = [];
let subSeq = 300, sampleSeq = 1500, testSeq = 2900;
const START = '2026-08-03';
const capacity = Object.fromEntries(analysts.map((a) => [a.id, a === trainee ? 0.3 : uni(0.7, 1.3)]));
const load = Object.fromEntries(analysts.map((a) => [a.id, 0]));

function chooseAnalyst(method, at) {
  const pool = analysts.filter((a) => eligibility(a.id, method, localDay(at)).length === 0);
  if (!pool.length) return null;
  return weighted(pool.map((a) => [a, capacity[a.id] / (1 + load[a.id] * 0.35)]));
}

function makeTest({ sample, product, customer, method, submittedAt, serviceLevel, gxp, source }) {
  const id = `T26-${pad(++testSeq, 5)}`;
  const k = serviceLevel === 'Expedited' ? 0.55 : 1;
  const t = { id, sampleId: sample.id, submissionId: sample.submissionId, customerId: customer.id, productId: product.id, methodId: method.id, methodNumber: method.number, methodVersion: method.version, gxp, serviceLevel, price: method.price[serviceLevel], tatBusinessDays: method.tat[serviceLevel], source, holds: [], deviationIds: [], history: [] };
  const h = (state, at, by) => t.history.push({ state, at: iso(at), by: by ?? null });
  h('Requested', submittedAt, null);
  if (chance(0.02)) { h('Rejected', advance(submittedAt, uni(0.1, 1)), 'u06'); t.rejectReason = pick(['Method not offered for this Product', 'No accepted Specification', 'Quality Agreement not current']); return t; }
  const acceptedAt = source === 'Stability Pull' ? submittedAt : advance(submittedAt, uni(0.05, 1.2));
  h('Accepted', acceptedAt, pick(['u06', 'u07']));
  const readyAt = new Date(Math.max(acceptedAt, sample.receivedAt ?? Infinity));
  if (!Number.isFinite(readyAt.getTime())) return t;
  h('Ready', readyAt, null);
  t.dueDate = addBusinessDays(localDay(readyAt), t.tatBusinessDays);
  const assignedAt = advance(readyAt, uni(0.2, 2.0) * k);
  const analyst = chooseAnalyst(method, assignedAt);
  if (!analyst) return t;
  t.assigneeId = analyst.id;
  h('Assigned', assignedAt, pick(['u01', 'u02', 'u03']));
  const startedAt = advance(assignedAt, uni(0.3, 2.5) * k);
  h('In Progress', startedAt, analyst.id);
  const performedAt = advance(startedAt, uni(1.4, 4.6) * k * (method.technique === 'ICP-MS' ? 1.2 : 1));
  h('Submitted for Review', performedAt, analyst.id);
  if (gxp === 'non-GMP') { h('Reported', advance(performedAt, uni(0.2, 1.4)), pick(['u01', 'u02', 'u03'])); return t; }
  const reviewers = ['u11', 'u14', 'u17', 'u20', 'u23', 'u27'].filter((r) => r !== analyst.id);
  const reviewedAt = advance(performedAt, uni(0.5, 3.0) * k);
  t.reviewerId = pick(reviewers);
  h('Reviewed', reviewedAt, t.reviewerId);
  const releasedAt = advance(reviewedAt, uni(0.3, 1.9) * k);
  h('Reported', releasedAt, pick(['u04', 'u05']));
  return t;
}

let day = START;
while (day <= '2026-09-30') {
  if (isBusinessDay(day)) {
    const nSubs = Math.max(3, Math.round(10.6 + gauss() * 2.4));
    for (let s = 0; s < nSubs; s++) {
      const customer = weighted(customers.map((c) => [c, c.kind === 'internal' ? 0.5 : c.country === 'US' ? 1.4 : 0.8]));
      const cprods = products.filter((p) => p.customerId === customer.id && p !== focusProduct);
      const submittedAt = atLocal(day, int(7, 17), int(0, 59));
      if (submittedAt > NOW) continue;
      const stability = chance(0.06);
      const sub = { id: `SUB-26-${pad(++subSeq, 4)}`, customerId: customer.id, submittedAt: iso(submittedAt), serviceLevel: chance(0.15) ? 'Expedited' : 'Standard', via: stability ? 'Stability Pull' : chance(0.85) ? 'Portal' : 'Custodian on behalf' };
      submissions.push(sub);
      const nSamples = weighted([[1, 3], [2, 3], [3, 2.2], [4, 1.2], [6, 0.6], [8, 0.3]]);
      const product = pick(cprods);
      const lot = `${product.code.split('-')[1]}-${pad(int(2601, 2609), 4)}-${pad(int(1, 180), 3)}`;
      for (let i = 0; i < nSamples; i++) {
        const shippingDays = sub.via === 'Stability Pull' ? 0 : uni(0.6, 3.5);
        const receivedAtRaw = advance(submittedAt, shippingDays);
        const sample = { id: `RD-26-${pad(++sampleSeq, 5)}`, submissionId: sub.id, productId: product.id, lot, customerRef: `${product.code.split('-')[1]}-${int(100, 999)}-${String.fromCharCode(65 + i)}`, storage: pick(['CMB-01 (3–8 °C)', 'RD-105 ambient', 'RD-105 ambient', 'FRZ-02 (−20 °C)', 'FRZ-03 (−20 °C)']), receivedAt: receivedAtRaw <= NOW ? receivedAtRaw : null, stability: stability ? { protocol: `STB-P-${pad(int(3, 14), 4)}`, condition: pick(['25 °C/60 % RH', '40 °C/75 % RH', '30 °C/65 % RH']), timePoint: pick(['T3M', 'T6M', 'T9M', 'T12M']) } : null };
        const discrepancy = sample.receivedAt && chance(0.012);
        samples.push(sample);
        const nTests = weighted([[1, 6.5], [2, 2.8], [3, 0.7]]);
        const methods = [...product.methodIds].sort(() => rnd() - 0.5).slice(0, nTests);
        for (const mid of methods) {
          const method = methodById[mid];
          const gxp = customer.kind === 'internal' ? (chance(0.75) ? 'non-GMP' : 'GMP') : chance(0.05) ? 'non-GMP' : 'GMP';
          const t = makeTest({ sample, product, customer, method, submittedAt, serviceLevel: sub.serviceLevel, gxp, source: stability ? 'Stability Pull' : 'Submission' });
          if (gxp === 'non-GMP') t.nonGmpReason = pick(['Method development', 'Feasibility', 'Customer-labelled research sample']);
          if (discrepancy) t.holds.push({ kind: 'Receipt discrepancy', reason: pick(['Container seal broken on arrival', 'Lot number on label differs from Submission']), blocks: '→ In Progress', openedAt: iso(sample.receivedAt), releasedBy: 'Sample Custodian' });
          tests.push(t);
        }
      }
    }
  }
  day = addBusinessDays(day, 1) > day ? (() => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })() : day;
}

// Trim each Test's history to what has happened by NOW, derive state, and keep load counts.
for (const t of tests) {
  t.history = t.history.filter((e) => new Date(e.at) <= NOW);
  t.state = t.history[t.history.length - 1].state;
  if (!['Assigned', 'In Progress', 'Submitted for Review', 'Reviewed', 'Reported'].includes(t.state)) { delete t.assigneeId; }
  if (!['Reviewed', 'Reported'].includes(t.state)) delete t.reviewerId;
  if (['Assigned', 'In Progress'].includes(t.state)) load[t.assigneeId]++;
}

// Holds, placed on open Tests to match the Deviations above.
const openTests = () => tests.filter((t) => !['Reported', 'Rejected', 'Cancelled', 'Invalidated'].includes(t.state));
function holdOn(filter, n, hold, devId) {
  const pool = openTests().filter(filter).sort(() => rnd() - 0.5).slice(0, n);
  for (const t of pool) { t.holds.push({ ...hold }); if (devId && !t.deviationIds.includes(devId)) t.deviationIds.push(devId); }
  return pool.length;
}
holdOn((t) => ['In Progress', 'Submitted for Review'].includes(t.state) && t.methodId !== 'M10', 9, { kind: 'Equipment Deviation', reason: 'BAL-03 failed its daily Check; Tests weighed on BAL-03 since its last passing Check', blocks: '→ Reviewed', deviationId: 'DEV-26-0091', openedAt: '2026-09-29T12:22:00Z' }, 'DEV-26-0091');
holdOn((t) => t.methodId === 'M01' && ['In Progress', 'Submitted for Review'].includes(t.state), 12, { kind: 'Failed Run check', reason: 'CCV-3 outside 80–120 % on RUN-LCMS01-260928-02', blocks: '→ Reviewed', deviationId: 'DEV-26-0090', openedAt: '2026-09-28T19:40:00Z' }, 'DEV-26-0090');
holdOn((t) => ['Ready', 'Assigned', 'In Progress'].includes(t.state) && samples.find((s) => s.id === t.sampleId).storage.startsWith('FRZ-03'), 7, { kind: 'Excursion', reason: 'Sample stored in FRZ-03 during the Excursion', blocks: '→ Reviewed', deviationId: 'DEV-26-0093', openedAt: '2026-09-29T12:06:00Z' }, 'DEV-26-0093');
holdOn((t) => t.methodId === 'M01' && ['Submitted for Review', 'In Progress'].includes(t.state), 5, { kind: 'Material', reason: 'Expired NDEA-d10 internal standard Solution used', blocks: '→ Reviewed', deviationId: 'DEV-26-0085', openedAt: '2026-09-24T13:30:00Z' }, 'DEV-26-0085');
holdOn((t) => ['Accepted', 'Ready'].includes(t.state) && t.gxp === 'GMP', 3, { kind: 'Customer query', reason: 'Awaiting Customer confirmation of maximum daily dose', blocks: '→ In Progress', openedAt: '2026-09-28T15:00:00Z', causedByCustomer: true });
// One OOS on a losartan Test, and one training lapse after assignment.
const oos = openTests().find((t) => t.methodId === 'M01' && t.state === 'In Progress' && products.find((p) => p.id === t.productId).name === 'Losartan potassium' && !t.holds.length)
  ?? openTests().find((t) => t.methodId === 'M01' && t.state === 'In Progress' && !t.holds.length);
oos.holds.push({ kind: 'OOS', reason: 'NDEA 0.31 ppm above the 0.265 ppm limit; Phase I investigation', blocks: 'New Preparations; → Reviewed', deviationId: 'DEV-26-0088', openedAt: '2026-09-25T15:10:00Z' }); oos.deviationIds.push('DEV-26-0088'); oos.flags = ['OOS'];
const lapse = openTests().find((t) => t.methodId === 'M01' && t.assigneeId && noV4.includes(t.assigneeId) && ['Assigned', 'In Progress'].includes(t.state));
if (lapse) lapse.holds.push({ kind: 'Training lapsed', reason: `${people.find((p) => p.id === lapse.assigneeId).name} has no Training Record on CO-MTH-0003 v4`, blocks: 'Further Performed signatures', openedAt: '2026-09-14T12:00:00Z' });
// Retest example.
const retest = openTests().find((t) => t.state === 'Ready' && t.methodId === 'M02');
if (retest) { retest.retestOf = `T26-${pad(int(3000, 3300), 5)}`; retest.flags = ['Retest']; }

// Held and stuck Tests have been open longer: move their timeline back so some are overdue.
function subBusinessDays(dayStr, n) { let d = new Date(dayStr + 'T12:00:00Z'); let left = n; while (left > 0) { d = new Date(d.getTime() - 864e5); if (isBusinessDay(d.toISOString().slice(0, 10))) left--; } return d.toISOString().slice(0, 10); }
function shiftBack(t, n) {
  t.history = t.history.map((e) => { const at = new Date(e.at); const day = localDay(at); const ms = at.getTime() - Date.parse(day + 'T00:00:00Z'); return { ...e, at: iso(new Date(Date.parse(subBusinessDays(day, n) + 'T00:00:00Z') + ms)) }; });
  const ready = t.history.find((e) => e.state === 'Ready');
  if (ready) t.dueDate = addBusinessDays(localDay(new Date(ready.at)), t.tatBusinessDays);
}
for (const t of openTests()) {
  if (t.holds.length && chance(0.6)) shiftBack(t, int(4, 9));
  else if (['In Progress', 'Submitted for Review'].includes(t.state) && chance(0.07)) shiftBack(t, int(3, 6));
}

// ---------- the showcase Tests ----------
function showcaseTest({ state, assigneeId, lot, readyDay, history, serviceLevel = 'Standard' }) {
  const sub = { id: `SUB-26-${pad(++subSeq, 4)}`, customerId: 'C01', submittedAt: iso(atLocal(addBusinessDays(readyDay, -2), 9, 14)), serviceLevel, via: 'Portal' };
  submissions.push(sub);
  const sample = { id: `RD-26-${pad(++sampleSeq, 5)}`, submissionId: sub.id, productId: focusProduct.id, lot, customerRef: `VAL-${int(100, 999)}-A`, storage: 'RD-105 ambient', receivedAt: atLocal(readyDay, 8, 41), stability: null };
  samples.push(sample);
  const m = methodById.M01;
  const t = { id: `T26-${pad(++testSeq, 5)}`, sampleId: sample.id, submissionId: sub.id, customerId: 'C01', productId: focusProduct.id, methodId: 'M01', methodNumber: m.number, methodVersion: m.version, gxp: 'GMP', serviceLevel, price: m.price[serviceLevel], tatBusinessDays: m.tat[serviceLevel], source: 'Submission', holds: [], deviationIds: [], history, state, assigneeId, dueDate: addBusinessDays(readyDay, m.tat[serviceLevel]) };
  tests.push(t);
  return { t, sample, sub };
}
const focus = showcaseTest({
  state: 'In Progress', assigneeId: 'u10', lot: 'VAL-2607-114', readyDay: '2026-09-24',
  history: [
    { state: 'Requested', at: '2026-09-22T13:14:00Z', by: null }, { state: 'Accepted', at: '2026-09-22T15:02:00Z', by: 'u06' },
    { state: 'Ready', at: '2026-09-24T12:41:00Z', by: null }, { state: 'Assigned', at: '2026-09-24T14:05:00Z', by: 'u01' },
    { state: 'In Progress', at: '2026-09-29T13:10:00Z', by: 'u10' },
  ],
});
load.u10++;
const toAssign = showcaseTest({
  state: 'Ready', assigneeId: undefined, lot: 'VAL-2608-021', readyDay: '2026-09-30', serviceLevel: 'Expedited',
  history: [{ state: 'Requested', at: '2026-09-28T14:30:00Z', by: null }, { state: 'Accepted', at: '2026-09-28T16:12:00Z', by: 'u07' }, { state: 'Ready', at: '2026-09-30T12:41:00Z', by: null }],
});

// ---------- the Run and the TargetLynx Compound Summary export ----------
const RUN_ID = 'RUN-LCMS02-260929-01';
const QLD = `C:\\MassLynx\\Nitrosamines.PRO\\Data\\${RUN_ID}.qld`;
const ANALYTES = ['NDMA', 'NDEA', 'NEIPA', 'NDIPA', 'NDBA', 'NMBA'];
const IS_OF = { NDMA: 'NDMA-d6', NDEA: 'NDEA-d10', NEIPA: 'NEIPA-d10', NDIPA: 'NDIPA-d14', NDBA: 'NDBA-d18', NMBA: 'NMBA-d3' };
const RT = { NDMA: 2.41, NDEA: 4.18, NEIPA: 5.02, NDIPA: 5.87, NDBA: 8.63, NMBA: 3.36 };
const REF_RATIO = { NDMA: 0.76, NDEA: 0.58, NEIPA: 0.44, NDIPA: 0.63, NDBA: 0.81, NMBA: 0.52 };
const CAL = [0.5, 1, 2, 5, 10, 20, 50];
const LOQ = 0.5; // pg/µL, lowest reportable standard
const LOD = 0.15;
const IS_CONC = 10;
const runOthers = openTests().filter((t) => t.methodId === 'M01' && t !== focus.t && ['In Progress', 'Submitted for Review'].includes(t.state)).slice(0, 7);
const truth = { NDMA: [1.62, 1.58], NDEA: [0.31, 0.27], NEIPA: [0, 0], NDIPA: [0, 0], NDBA: [0.64, 0.61], NMBA: [0, 0] };
const seq = [];
let vial = 1;
const acq0 = new Date('2026-09-29T22:12:00Z'); // 18:12 local
const push = (name, text, kind, extra = {}) => { seq.push({ name: `R260929_${pad(seq.length + 1, 3)}`, text, vial: `1:${String.fromCharCode(65 + Math.floor((vial - 1) / 8))},${((vial - 1) % 8) + 1}`, kind, at: new Date(acq0.getTime() + seq.length * 7.5 * 60e3), ...extra }); vial++; };
push('', 'Blank', 'blank');
CAL.forEach((c, i) => push('', `STD L${i + 1}`, 'std', { conc: c }));
push('', 'Blank', 'blank');
push('', 'CCV-1', 'ccv', { conc: 2 });
for (const [pi, w] of [[1, 100.42], [2, 99.87]]) for (const inj of [1, 2]) push('', `${focus.t.id}-P${pi}`, 'unknown', { test: focus.t.id, prep: pi, inj });
for (const o of runOthers.slice(0, 4)) for (const pi of [1, 2]) push('', `${o.id}-P${pi}`, 'unknown', { test: o.id, prep: pi, inj: 1 });
push('', 'CCV-2', 'ccv', { conc: 2 });
for (const o of runOthers.slice(4)) for (const pi of [1, 2]) push('', `${o.id}-P${pi}`, 'unknown', { test: o.id, prep: pi, inj: 1 });
push('', 'CCV-3', 'ccv', { conc: 2 });
push('', 'Blank', 'blank');

const fmtDate = (d) => { const l = new Date(d.getTime() + OFFSET_H * 3600e3); return `${pad(l.getUTCDate(), 2)}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][l.getUTCMonth()]}-${String(l.getUTCFullYear()).slice(2)}`; };
const fmtTime = (d) => new Date(d.getTime() + OFFSET_H * 3600e3).toISOString().slice(11, 19);
const HEAD = ['', 'Name', 'Sample Text', 'Vial', 'Inj. Vol', 'RT', 'Std. Conc', 'Height', 'Area', 'IS Area', 'pguL', 'Response', '%Rec', 'Peak Ratio', 'Acq.Date', 'Acq.Time', 'BS/Conc.', 'S/N'];
const lines = ['Quantify Compound Summary Report ', '', `Printed Wed Sep 30 09:52:13 2026`, '', `Dataset: ${QLD}`, '', 'Last Altered: Wed Sep 30 09:50:02 2026', 'Printed: Wed Sep 30 09:52:13 2026', ''];
const injections = []; // parsed view for the focus Test
const runChecks = { calibration: [], ccv: [], blanks: [], loqSignalToNoise: [] };
ANALYTES.forEach((an, ci) => {
  lines.push(`Compound ${ci + 1}:  ${an}`, '', HEAD.join('\t'));
  const slope = uni(0.9, 1.1); const isBase = uni(9.5e4, 1.6e5);
  const calFound = [];
  seq.forEach((s, ri) => {
    let conc = 0;
    if (s.kind === 'std' || s.kind === 'ccv') conc = s.conc * (s.kind === 'ccv' && s.text === 'CCV-3' && an === 'NDEA' ? 1.12 : 1) * (1 + gauss() * 0.025);
    if (s.kind === 'unknown') conc = s.test === focus.t.id ? truth[an][s.prep - 1] * (1 + gauss() * 0.02) : (chance(0.45) ? uni(0.2, 3.2) : 0);
    const isArea = Math.round(isBase * (1 + gauss() * 0.06));
    const detected = conc >= LOD * 1.05;
    const response = detected ? conc * slope : 0;
    const area = detected ? Math.round((response / IS_CONC) * isArea) : null;
    const height = detected ? Math.round(area * uni(0.18, 0.24)) : null;
    const pguL = detected ? (conc < LOQ ? 'Below RL' : round(response / slope, 3)) : null;
    let ratio = detected ? REF_RATIO[an] * (1 + gauss() * 0.04) : null;
    if (s.test === focus.t.id && an === 'NDMA' && s.prep === 2 && s.inj === 2) ratio = 0.52;
    const rec = (s.kind === 'std' || s.kind === 'ccv') && typeof pguL === 'number' ? round((pguL / s.conc) * 100, 1) : null;
    const sn = detected ? Math.round(conc * uni(38, 52)) : null;
    const row = [String(ri + 1), s.name, s.text, s.vial, '10.0', detected ? (RT[an] + gauss() * 0.01).toFixed(2) : '', s.conc != null ? String(s.conc) : '', height ?? '', area ?? '', String(isArea), pguL ?? '', detected ? (response).toFixed(4) : '', rec ?? '', ratio != null ? ratio.toFixed(3) : '', fmtDate(s.at), fmtTime(s.at), '', sn ?? ''];
    lines.push(row.join('\t'));
    if (s.kind === 'std') calFound.push(typeof pguL === 'number' ? pguL : null);
    if (s.kind === 'ccv') runChecks.ccv.push({ analyte: an, name: s.text, recoveryPct: rec, limits: [80, 120], pass: rec >= 80 && rec <= 120 });
    if (s.kind === 'blank' && ri > 0) runChecks.blanks.push({ analyte: an, name: s.name, found: pguL, pass: !detected || pguL === 'Below RL' });
    if (s.kind === 'std' && s.conc === LOQ) runChecks.loqSignalToNoise.push({ analyte: an, sn, limit: 10, pass: sn >= 10 });
    if (s.test === focus.t.id) injections.push({ analyte: an, prep: s.prep, inj: s.inj, name: s.name, sampleText: s.text, rt: detected ? round(RT[an], 2) : null, area, isArea, pguL, peakRatio: ratio != null ? round(ratio, 3) : null, sn, acquiredAt: iso(s.at) });
  });
  runChecks.calibration.push({ analyte: an, internalStandard: IS_OF[an], levels: CAL.length, rangePguL: [CAL[0], CAL[CAL.length - 1]], weighting: '1/x', r2: round(0.9990 + rnd() * 0.0009, 4), pass: true });
  lines.push('');
});
const txt = lines.join('\r\n');
mkdirSync(join(ROOT, 'fixtures'), { recursive: true });
const TXT_NAME = `${RUN_ID}_CompoundSummary.txt`;
writeFileSync(join(ROOT, 'fixtures', TXT_NAME), txt);

// Focus Test: Preparations, draft Results and the Reportable Result.
const preps = [
  { id: `${focus.t.id}-P1`, n: 1, weightMg: 100.42, volumeMl: 1.0, balance: 'BAL-02', pipettes: ['PIP-04'], diWater: 'DIW-01', diluent: 'SOL-26-0932', enteredBy: 'u10', enteredAt: '2026-09-29T13:44:00Z', verifiedBy: 'u11', verifiedAt: '2026-09-29T14:02:00Z' },
  { id: `${focus.t.id}-P2`, n: 2, weightMg: 99.87, volumeMl: 1.0, balance: 'BAL-02', pipettes: ['PIP-04'], diWater: 'DIW-01', diluent: 'SOL-26-0932', enteredBy: 'u10', enteredAt: '2026-09-29T13:51:00Z', verifiedBy: 'u11', verifiedAt: '2026-09-29T14:02:00Z' },
];
const toPpm = (pguL, prep) => (pguL * prep.volumeMl) / (prep.weightMg / 1000) / 1000; // ng/mL * mL / g = ng/g; /1000 = ppm (µg/g)
const loqPpm = round(toPpm(LOQ, { volumeMl: 1, weightMg: 100 }), 4);
const results = ANALYTES.map((an) => {
  const limitPpm = round(AI[an] / focusProduct.maxDailyDoseMg, 4);
  const perPrep = preps.map((p) => {
    const inj = injections.filter((i) => i.analyte === an && i.prep === p.n);
    const numeric = inj.filter((i) => typeof i.pguL === 'number');
    const below = inj.some((i) => i.pguL === 'Below RL');
    const meanPguL = numeric.length === inj.length ? numeric.reduce((s, i) => s + i.pguL, 0) / numeric.length : null;
    return { prep: p.n, injections: inj.map((i) => i.name), meanPguL: meanPguL != null ? round(meanPguL, 3) : null, ppm: meanPguL != null ? round(toPpm(meanPguL, p), 4) : null, display: meanPguL != null ? null : below ? '< LOQ' : 'Not detected' };
  });
  const both = perPrep.every((p) => p.ppm != null);
  const reportablePpm = both ? round((perPrep[0].ppm + perPrep[1].ppm) / 2, 4) : null;
  const flags = [];
  const bad = injections.find((i) => i.analyte === an && i.peakRatio != null && Math.abs(i.peakRatio - REF_RATIO[an]) / REF_RATIO[an] > 0.2);
  if (bad) flags.push({ kind: 'Ion ratio outside window', injection: bad.name, prep: bad.prep, found: bad.peakRatio, window: [round(REF_RATIO[an] * 0.8, 3), round(REF_RATIO[an] * 1.2, 3)], detail: `Peak Ratio ${bad.peakRatio} vs calibration mean ${REF_RATIO[an]} ± 20 %` });
  return { analyte: an, acceptableIntakeNgPerDay: AI[an], acceptableIntakeSource: AI_SOURCE, limitPpm, loqPpm, lodPpm: round(toPpm(LOD, { volumeMl: 1, weightMg: 100 }), 4), perPrep, reportablePpm, reportableDisplay: both ? null : perPrep.some((p) => p.display === '< LOQ') ? '< LOQ' : 'Not detected', pctOfLimit: reportablePpm != null ? round((reportablePpm / limitPpm) * 100, 1) : null, flags };
});

const recordContent = JSON.stringify({ test: focus.t.id, version: 2, preps, injections, results });
const focusBlock = {
  testId: focus.t.id,
  notebookEntry: 'RD-NB-0019-0187',
  recordVersion: 2,
  contentSha256: sha256(recordContent),
  preparations: preps,
  run: {
    id: RUN_ID, instrument: 'LCMS-02', column: { pack: 'PK-26-0147', material: 'C18 1.8 µm 2.1 × 100 mm column', fitness: 'In use' },
    acquiredFrom: iso(seq[0].at), acquiredTo: iso(seq[seq.length - 1].at), injections: seq.length, testsInRun: 1 + runOthers.length,
    solutions: [
      { id: 'SOL-26-0911', what: 'Calibration standards L1–L7', madeOn: '2026-09-25', expires: '2026-10-09', fitness: 'In use' },
      { id: 'SOL-26-0915', what: 'Internal standard mix (6 × deuterated)', madeOn: '2026-09-25', expires: '2026-10-23', fitness: 'In use' },
      { id: 'SOL-26-0918', what: 'CCV, 2 pg/µL', madeOn: '2026-09-25', expires: '2026-10-09', fitness: 'In use' },
      { id: 'SOL-26-0930', what: 'Mobile phase A, 0.1 % formic acid in water', madeOn: '2026-09-29', expires: '2026-10-06', fitness: 'In use' },
      { id: 'SOL-26-0931', what: 'Mobile phase B, 0.1 % formic acid in methanol', madeOn: '2026-09-29', expires: '2026-10-06', fitness: 'In use' },
      { id: 'SOL-26-0932', what: 'Diluent, methanol:water 1:1', madeOn: '2026-09-29', expires: '2026-10-13', fitness: 'In use' },
    ],
    checks: runChecks,
  },
  import: {
    file: TXT_NAME, fixturePath: `fixtures/${TXT_NAME}`, sha256: sha256(txt), bytes: Buffer.byteLength(txt), dataset: QLD,
    pdf: { file: `${RUN_ID}_CompoundSummary.pdf`, sha256: sha256('pdf:' + txt), crossCheck: { cellsCompared: ANALYTES.length * seq.length * 16, mismatches: 0 } },
    parser: 'targetlynx-txt 0.4.1', uploadedBy: 'u10', uploadedAt: '2026-09-30T13:58:00Z', rowsForThisTest: injections.length,
  },
  injections, results,
  units: { pguL: 'pg/µL (as exported)', result: 'ppm (µg/g API)' },
  limitsNote: 'Limits: FDA acceptable intake ÷ maximum daily dose (320 mg). AIs from the FDA CDER acceptable-intake page, revision 30 (24 Sep 2026); NDBA uses the 26.5 ng/day default. How a Specification applies them is set by Decide the specification and limits model (#29).',
  performedChecklist: [
    'Every flag on the draft is handled (accepted with a comment, or a Reinjection is requested)',
    'Manual integrations in MassLynx: none, or each is listed with its reason',
    'Injections match the Preparations and the Run sequence',
  ],
};

// ---------- today's Checks at the bench ----------
const doneBy = 'u13';
const checksToday = [
  ...rooms.map((r, i) => ({ id: `CHK-${r.id}`, planId: `CP-${r.id}-ENV`, target: r.id, targetKind: 'Room', type: 'Reading', schedule: 'Daily', fields: r.storage ? ['tempC', 'tempMinC', 'tempMaxC', 'rhPct', 'reset'] : ['tempC', 'rhPct'], limits: r.limits, plausible: { tempC: [5, 40], rhPct: [5, 95] }, signed: false, ...(i === 0 ? { status: 'Done', at: '2026-09-30T11:58:00Z', by: doneBy, values: { tempC: 21.4, rhPct: 44 } } : i === 2 ? { status: 'Done', at: '2026-09-30T12:03:00Z', by: doneBy, values: { tempC: 22.1, rhPct: 38 } } : { status: 'Due' }) })),
  { id: 'CHK-FRZ-01', planId: 'CP-FRZ-01-TEMP', target: 'FRZ-01', targetKind: 'Equipment', type: 'Reading', schedule: 'Daily', fields: ['tempC', 'tempMinC', 'tempMaxC', 'reset'], limits: { tempC: [-90, -70] }, plausible: { tempC: [-100, 30] }, signed: false, status: 'Due', last: { at: '2026-09-29T12:01:00Z', tempC: -79.2, tempMinC: -81.0, tempMaxC: -77.4 } },
  { id: 'CHK-FRZ-02', planId: 'CP-FRZ-02-TEMP', target: 'FRZ-02', targetKind: 'Equipment', type: 'Reading', schedule: 'Daily', fields: ['tempC', 'tempMinC', 'tempMaxC', 'reset'], limits: { tempC: [-25, -15] }, plausible: { tempC: [-40, 30] }, signed: false, status: 'Done', at: '2026-09-30T12:10:00Z', by: doneBy, values: { tempC: -20.6, tempMinC: -22.1, tempMaxC: -18.9, reset: true } },
  { id: 'CHK-FRZ-03', planId: 'CP-FRZ-03-TEMP', target: 'FRZ-03', targetKind: 'Equipment', type: 'Reading', schedule: 'Daily', fields: ['tempC', 'tempMinC', 'tempMaxC', 'reset'], limits: { tempC: [-25, -15] }, plausible: { tempC: [-40, 30] }, signed: false, status: 'Due', note: 'Open Excursion DEV-26-0093: new placements refused', last: { at: '2026-09-29T12:06:00Z', tempC: -19.8, tempMinC: -21.5, tempMaxC: -12.4 } },
  { id: 'CHK-CMB-01-F', planId: 'CP-CMB-01-F', target: 'CMB-01', compartment: 'Freezer (−20 °C)', targetKind: 'Equipment', type: 'Reading', schedule: 'Daily', fields: ['tempC', 'tempMinC', 'tempMaxC', 'reset'], limits: { tempC: [-25, -15] }, plausible: { tempC: [-40, 30] }, signed: false, status: 'Due' },
  { id: 'CHK-CMB-01-R', planId: 'CP-CMB-01-R', target: 'CMB-01', compartment: 'Fridge (3–8 °C)', targetKind: 'Equipment', type: 'Reading', schedule: 'Daily', fields: ['tempC', 'tempMinC', 'tempMaxC', 'reset'], limits: { tempC: [3, 8] }, plausible: { tempC: [-10, 30] }, signed: false, status: 'Due' },
  { id: 'CHK-DIW-01', planId: 'CP-DIW-01', target: 'DIW-01', targetKind: 'Equipment', type: 'Reading', schedule: 'Daily', fields: ['resistivityMOhmCm', 'tocPpb'], limits: { resistivityMOhmCm: [18.0, 18.3], tocPpb: [0, 10] }, plausible: { resistivityMOhmCm: [0, 18.3], tocPpb: [0, 1000] }, signed: false, status: 'Done', at: '2026-09-30T12:15:00Z', by: doneBy, values: { resistivityMOhmCm: 18.2, tocPpb: 4 } },
  { id: 'CHK-BAL-01', planId: 'CP-BAL-01-DAILY', target: 'BAL-01', targetKind: 'Equipment', type: 'Verification', schedule: 'Before first use each day', weights: [{ nominal: '10 mg', certifiedMg: 10.0012 }, { nominal: '1 g', certifiedMg: 1000.0021 }], tolerancePct: 0.05, signed: true, status: 'Done', at: '2026-09-30T12:05:00Z', by: doneBy, values: { readingsMg: [10.0019, 1000.0102] } },
  { id: 'CHK-BAL-02', planId: 'CP-BAL-02-DAILY', target: 'BAL-02', targetKind: 'Equipment', type: 'Verification', schedule: 'Before first use each day', weights: [{ nominal: '20 mg', certifiedMg: 20.0018 }, { nominal: '10 g', certifiedMg: 10000.009 }], tolerancePct: 0.05, signed: true, status: 'Done', at: '2026-09-30T12:12:00Z', by: doneBy, values: { readingsMg: [20.004, 10000.21] } },
  { id: 'CHK-BAL-03', planId: 'CP-BAL-03-DAILY', target: 'BAL-03', targetKind: 'Equipment', type: 'Verification', schedule: 'Before first use each day', weights: [{ nominal: '50 mg', certifiedMg: 50.0021 }, { nominal: '100 g', certifiedMg: 100000.07 }], tolerancePct: 0.05, signed: true, status: 'Blocked', note: 'Suspended: failed Check 29 Sep (DEV-26-0091). Returns to service only through the Deviation.' },
  { id: 'CHK-BAL-04', planId: 'CP-BAL-04-DAILY', target: 'BAL-04', targetKind: 'Equipment', type: 'Verification', schedule: 'Before first use each day', weights: [{ nominal: '10 g', certifiedMg: 10000.03 }, { nominal: '200 g', certifiedMg: 200000.2 }], tolerancePct: 0.05, plausiblePct: 5, signed: true, status: 'Due', lastPass: '2026-09-29T12:20:00Z', testsSinceLastPass: 14 },
  { id: 'CHK-BAL-05', planId: 'CP-BAL-05-DAILY', target: 'BAL-05', targetKind: 'Equipment', type: 'Verification', schedule: 'Before first use each day', weights: [{ nominal: '100 g', certifiedMg: 100000.1 }, { nominal: '2 kg', certifiedMg: 2000000.9 }], tolerancePct: 0.1, signed: true, status: 'Due' },
  { id: 'CHK-PH-01', planId: 'CP-PH-01-CAL', target: 'PH-01', targetKind: 'Equipment', type: 'Verification', schedule: 'Before first use each day', buffers: [4.01, 7.0, 10.01], signed: true, status: 'Not used today' },
  { id: 'CHK-PIP-07', planId: 'CP-PIP-07-GRAV', target: 'PIP-07', targetKind: 'Equipment', type: 'Verification', schedule: 'Every 3 months', signed: true, status: 'Due soon', dueDate: '2026-10-05' },
  { id: 'CHK-PIP-11', planId: 'CP-PIP-11-GRAV', target: 'PIP-11', targetKind: 'Equipment', type: 'Verification', schedule: 'Every 3 months', signed: true, status: 'Overdue', dueDate: '2026-09-26', note: 'Fitness Status Expired: cannot be cited until a passing Check' },
];
const missed = [{ checkPlanId: 'CP-RD-102-ENV', target: 'RD-102', day: '2026-09-29', alarm: 'Awaiting acknowledgement', raisedTo: ['u13', 'u02'] }];
// The 14 open Tests whose Preparations cited BAL-04 since its last passing Check (chosen without the RNG, so nothing else shifts).
const citedBal04 = openTests().filter((t) => ['In Progress', 'Submitted for Review'].includes(t.state) && t.methodId !== 'M10' && !t.holds.some((h) => h.deviationId === 'DEV-26-0091')).sort((a, b) => a.id.localeCompare(b.id)).filter((_, i) => i % 5 === 2).slice(0, 14).map((t) => t.id);
const failDemo = { checkId: 'CHK-BAL-04', typed: { readingsMg: [10000.4, 200183.4] }, errorPct: [round((10000.4 - 10000.03) / 10000.03 * 100, 4), round((200183.4 - 200000.2) / 200000.2 * 100, 4)], consequence: { deviationKind: 'Equipment', deviationId: 'DEV-26-0094', suspends: 'BAL-04', holdsOnTests: citedBal04.length, testIds: citedBal04, since: '2026-09-29T12:20:00Z' } };

// ---------- metrics for scale ----------
const inSep = (ts) => ts && ts >= '2026-09-01' && ts < '2026-10-01';
const reportedSep = tests.filter((t) => t.state === 'Reported' && inSep(t.history.at(-1).at));
const tat = reportedSep.map((t) => businessDaysBetween(localDay(new Date(t.history.find((e) => e.state === 'Ready').at)), localDay(new Date(t.history.at(-1).at)))).sort((a, b) => a - b);
const metrics = {
  samplesReceivedSeptember: samples.filter((s) => s.receivedAt && inSep(iso(s.receivedAt))).length,
  testsReportedSeptember: reportedSep.length,
  medianTatBusinessDays: tat[Math.floor(tat.length / 2)],
  onTimePctSeptember: round((reportedSep.filter((t) => localDay(new Date(t.history.at(-1).at)) <= t.dueDate).length / reportedSep.length) * 100, 1),
  openTests: openTests().length,
};

const signatureMeanings = {
  Performed: 'I performed this work and recorded it completely and accurately.',
  Verified: 'I checked this entry against its source and it is correct.',
  Reviewed: 'I reviewed these records, including their audit trail, and they are complete and correct.',
  Approved: 'I approve this record for use.',
  Released: 'I release this Test Report to the Customer.',
  Authored: 'I wrote this draft and submit it for review.',
  Acknowledged: 'I have read and understood this.',
};

const out = {
  meta: { note: 'All data is fictional except the FDA acceptable intakes, which cite their source and revision.', seed: SEED, now: iso(NOW), labDay: localDay(NOW), labZone: 'America/New_York', utcOffsetHours: OFFSET_H, generatedBy: 'gen-data.mjs' },
  lab: { id: 'RD', name: 'R&D Laboratory', company: 'Fictional company (demo)' },
  personas: { queue: 'u01', test: 'u10', checks: 'u13' },
  demoCredentials: { note: 'Demo only. The TOTP code stands in for a fresh authenticator code.', users: { praman: { password: 'bench-demo-2026', totp: '314159' }, kwatanabe: { password: 'bench-demo-2026', totp: '271828' }, hkowalski: { password: 'bench-demo-2026', totp: '161803' } }, lockoutAfterFailures: 5, idleLockMinutes: 15 },
  signatureMeanings,
  states: {
    test: ['Requested', 'Accepted', 'Rejected', 'Ready', 'Assigned', 'In Progress', 'Submitted for Review', 'Reviewed', 'Reported', 'Cancelled', 'Invalidated'],
    sample: ['Expected', 'Received', 'Rejected at receipt', 'Retained', 'Returned to Customer', 'Disposed'],
    deviation: ['Open', 'Investigating', 'In QA Review', 'Closed'],
    fitness: ['Quarantined', 'In use', 'Suspended', 'Expired', 'Retired'],
    riskLevel: ['Minor', 'Major', 'Critical'],
  },
  people, customers, products, methods: METHODS.map(({ weight, ...m }) => m), prerequisites,
  trainingRecords, authorisations,
  rooms, equipment, deviations,
  submissions, samples: samples.map((s) => ({ ...s, receivedAt: s.receivedAt ? iso(s.receivedAt) : null, state: s.receivedAt ? 'Received' : 'Expected' })),
  tests,
  focus: { assignTestId: toAssign.t.id, test: focusBlock, checkFail: failDemo },
  checksToday, missedChecks: missed,
  metrics,
};

// Samples whose Tests are all finished are Retained.
const bySample = {};
for (const t of tests) (bySample[t.sampleId] ??= []).push(t);
for (const s of out.samples) if (s.state === 'Received' && bySample[s.id]?.every((t) => ['Reported', 'Rejected', 'Cancelled'].includes(t.state))) s.state = 'Retained';

// Eligibility of every Analyst for the Test awaiting assignment, as the server would compute it.
out.focus.assignEligibility = analysts.map((a) => ({ personId: a.id, reasons: eligibility(a.id, methodById.M01, '2026-09-30'), openAssigned: tests.filter((t) => t.assigneeId === a.id && ['Assigned', 'In Progress'].includes(t.state)).length }));

const header = `// Fictional dataset for the UI-direction prototypes (ticket #23). Generated by gen-data.mjs, seed ${SEED}. Do not edit by hand.\n`;
writeFileSync(join(ROOT, 'data.js'), header + 'window.LIMS = ' + JSON.stringify(out) + ';\n');
console.log(JSON.stringify({ metrics, tests: tests.length, samples: samples.length, submissions: submissions.length, focus: focus.t.id, assign: toAssign.t.id, byState: Object.entries(tests.reduce((m, t) => ((m[t.state] = (m[t.state] ?? 0) + 1), m), {})), holds: tests.filter((t) => t.holds.length).length, bytes: Buffer.byteLength(JSON.stringify(out)), eligibleForAssign: out.focus.assignEligibility.filter((e) => !e.reasons.length).length }, null, 1));

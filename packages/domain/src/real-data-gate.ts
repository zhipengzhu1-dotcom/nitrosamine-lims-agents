import type { Sentence } from './sentence.ts';

/** One row of the control list in docs/real-data-gate.md: a control that must be built before the data class can be real. */
export interface Control {
  phase: number;
  control: string;
  built: 'yes' | 'partly' | 'no';
}

/** Parses the control table of docs/real-data-gate.md, so that the registry below can be checked against the document. */
export function parseControlList(markdown: string): Control[] {
  const controls: Control[] = [];
  for (const line of markdown.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    const phase = Number(cells[1]);
    if (cells.length !== 5 || !Number.isInteger(phase) || cells[2] === undefined || cells[3] === undefined) continue;
    const built = cells[3] === '' ? 'no' : cells[3].startsWith('Partly') ? 'partly' : 'yes';
    controls.push({ phase, control: cells[2], built });
  }
  return controls;
}

/** The control list the gate reads. docs/real-data-gate.md is the same list for people; a test holds the two together. */
export const controls: Control[] = [
  { phase: 1, control: 'Closed schemas', built: 'yes' },
  { phase: 1, control: 'Refusal kinds', built: 'yes' },
  { phase: 1, control: 'Commit keys', built: 'yes' },
  {
    phase: 1,
    control: 'System Incidents with log volume, redaction and the unwritten-incident check',
    built: 'partly',
  },
  {
    phase: 1,
    control:
      "A chain-verify failure opens a System Incident (QA's Verify chain names every failing entry and how far the chain is intact, [#111](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/111), opens one System Incident per break, and raises the alarm when it opens one)",
    built: 'partly',
  },
  { phase: 1, control: 'Access Events with the expiry sweep', built: 'yes' },
  {
    phase: 1,
    control:
      'A lockout, a burst of failed sign-ins from one address or against one unknown-ID hash, or repeats against a locked account open a System Incident',
    built: 'yes',
  },
  { phase: 1, control: 'Counters', built: 'yes' },
  { phase: 1, control: 'Transaction IDs', built: 'yes' },
  { phase: 2, control: 'Signing function and Signature fields', built: 'yes' },
  { phase: 2, control: 'Record Versions', built: 'yes' },
  { phase: 2, control: 'Lab at sign-in', built: 'yes' },
  { phase: 2, control: 'Workstations', built: 'yes' },
  { phase: 2, control: 'Identity Verification', built: 'yes' },
  { phase: 2, control: 'Unlock', built: 'no' },
  { phase: 2, control: 'Admin constraint', built: 'yes' },
  {
    phase: 2,
    control:
      'Decided login (TOTP, password rules, lockout 5, pepper) behind the data class; TOTP covers sign-in, signing and the Lab switch, which until then re-authenticates with user ID and password only ([#98](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/98))',
    built: 'no',
  },
  { phase: 2, control: 'Release Log, service identities, real-data gate and banner', built: 'yes' },
  { phase: 3, control: 'Critical Data Change', built: 'no' },
  { phase: 3, control: 'Return', built: 'no' },
  { phase: 3, control: 'Holds', built: 'no' },
  { phase: 3, control: 'Picklist reasons', built: 'no' },
  { phase: 3, control: 'Record Type Register', built: 'no' },
  { phase: 3, control: 'Calculation Versions', built: 'no' },
  { phase: 3, control: 'Review Checklists', built: 'no' },
  { phase: 3, control: 'Readable Audit Trail panel', built: 'yes' },
  { phase: 3, control: 'QA audit export', built: 'yes' },
  { phase: 4, control: 'Document vault', built: 'no' },
  { phase: 4, control: 'Training Records', built: 'no' },
  { phase: 4, control: 'Authorisations', built: 'no' },
  { phase: 4, control: 'Appointments', built: 'no' },
  { phase: 4, control: 'Competence Assessments', built: 'no' },
  { phase: 7, control: 'Equipment', built: 'no' },
  { phase: 7, control: 'Rooms', built: 'no' },
  { phase: 7, control: 'Check Plans', built: 'no' },
  { phase: 7, control: 'Checks', built: 'no' },
  { phase: 7, control: 'Unconfirmed Values', built: 'no' },
  { phase: 7, control: 'Excursions', built: 'no' },
  { phase: 7, control: 'Suppliers', built: 'no' },
  { phase: 7, control: 'Materials', built: 'no' },
  { phase: 7, control: 'Packs', built: 'no' },
  { phase: 7, control: 'Solutions', built: 'no' },
  { phase: 8, control: 'Acceptance', built: 'no' },
  { phase: 8, control: 'Receipt', built: 'no' },
  { phase: 8, control: 'Assignment gate', built: 'no' },
  { phase: 8, control: 'Preparations', built: 'no' },
  { phase: 8, control: 'Runs', built: 'no' },
  { phase: 8, control: 'Typed entry', built: 'no' },
  { phase: 8, control: 'Python worker Import', built: 'no' },
  { phase: 8, control: 'Raw-Data Manifest', built: 'no' },
  { phase: 8, control: 'Run Checks', built: 'no' },
  { phase: 8, control: 'Verdicts', built: 'no' },
  { phase: 8, control: 'Reviewed', built: 'no' },
  { phase: 9, control: 'Deviations', built: 'no' },
  { phase: 9, control: 'OOS', built: 'no' },
  { phase: 9, control: 'CAPA Actions', built: 'no' },
  { phase: 9, control: 'Planned Deviations', built: 'no' },
  { phase: 9, control: 'Complaints', built: 'no' },
  { phase: 9, control: 'PT Plan and Rounds', built: 'no' },
  { phase: 13, control: 'Test Report format', built: 'no' },
  { phase: 13, control: 'Release past the slice', built: 'no' },
  { phase: 13, control: 'Amended Reports', built: 'no' },
  { phase: 13, control: 'Withdrawal notices', built: 'no' },
  { phase: 13, control: 'Downloads', built: 'no' },
  { phase: 13, control: 'Check a copy', built: 'no' },
];

/** The login configurations the API runs under; `decided` is the one ADR 0002 decided for real data. */
export type LoginConfiguration = 'demo' | 'decided';

/** The decided login values (spec #85, ADR 0002), which the `decided` configuration must carry. */
export const DECIDED_LOGIN = {
  secondFactor: 'TOTP',
  passwordMinLength: 15,
  lockoutAfterFailures: 5,
  idleMinutes: 15,
  perPersonPassword: true,
  pepper: true,
} as const;

/** What the gate knows about the deployment; each fact is a record or a server constant, never a claim typed in. */
export interface DeploymentFacts {
  login: LoginConfiguration;
  anchoringLive: boolean;
  fileVaultPersonalKey: boolean;
  /** Demo exceptions recorded by an approved Release Log entry and not yet lapsed by one. */
  openExceptions: string[];
  /** The tables holding a record created under the fictional data class, from `lims.fictional_records()`. */
  fictionalRecords: string[];
}

export type GateVerdict = { allowed: true } | { allowed: false; conditions: Sentence[] };

/** Refuses the real data class while any condition of ADR 0002 and the control list is unmet, naming each unmet one. */
export function realDataGate(facts: DeploymentFacts, list: Control[] = controls): GateVerdict {
  const conditions: Sentence[] = [];
  const unbuilt = list.filter((c) => c.built !== 'yes');
  if (unbuilt.length > 0)
    conditions.push(
      `Every control on the list is built; ${unbuilt.length} are not, the first being ${unbuilt[0]?.control}.`,
    );
  if (facts.login !== 'decided')
    conditions.push(
      `The login runs at its decided values (${DECIDED_LOGIN.secondFactor}, ${DECIDED_LOGIN.passwordMinLength}-character passwords, lockout at ${DECIDED_LOGIN.lockoutAfterFailures}, ${DECIDED_LOGIN.idleMinutes}-minute idle limit, a password per person, a pepper); it runs as ${facts.login}.`,
    );
  if (facts.openExceptions.length > 0)
    conditions.push(`Every demo exception is recorded as lapsed; ${facts.openExceptions.join(', ')} still stand.`);
  if (!facts.anchoringLive) conditions.push('Anchoring of the Audit Trail is live.');
  if (!facts.fileVaultPersonalKey) conditions.push('The host holds a personal FileVault key.');
  if (facts.fictionalRecords.length > 0)
    conditions.push(`No record was created under fictional; ${facts.fictionalRecords.join(', ')} hold one.`);
  return conditions.length === 0 ? { allowed: true } : { allowed: false, conditions };
}

import type { FitnessStatus, Meaning, Role } from './http.ts';
import type { Sentence } from './sentence.ts';
import type { Refusal } from './steps.ts';

/** A Fitness Status the database stores. Expired is never stored: `fitnessOf` derives it from the due date. */
export type StoredFitnessStatus = Exclude<FitnessStatus, 'Expired'>;

/**
 * The Fitness Status a person sees: Expired once the stored status is In use and its due date has passed, else the
 * stored one. `expiresOn` and `today` are ISO dates (YYYY-MM-DD), which compare as strings; until Calibrations
 * arrive (#130) no Equipment has a due date.
 */
export function fitnessOf(stored: StoredFitnessStatus, expiresOn: string | null, today: string): FitnessStatus {
  return stored === 'InUse' && expiresOn !== null && expiresOn < today ? 'Expired' : stored;
}

/** What a piece of Equipment is asked to do: serve a Test, take an item into storage, or give one up. */
export type EquipmentUse = 'use' | 'place' | 'remove';

export type Fitness = { fit: true } | { fit: false; reason: Sentence };

const unfit: { [S in Exclude<FitnessStatus, 'InUse'>]: Sentence } = {
  Quarantined: 'This Equipment is Quarantined: QA has not approved it for use.',
  Suspended: 'This Equipment is Suspended: it must be checked and approved again before use.',
  Expired: 'This Equipment is Expired: its Calibration is past due.',
  Retired: 'This Equipment is Retired.',
};

/**
 * Whether Equipment in `status` may do `use`. Only In use Equipment serves a Test or takes an item into storage; an
 * item may always be taken out of a storage location, so that nothing is trapped in a unit that failed.
 */
export function fitFor(status: FitnessStatus, use: EquipmentUse): Fitness {
  if (status === 'InUse' || use === 'remove') return { fit: true };
  return { fit: false, reason: unfit[status] };
}

export type EquipmentStepName = 'approve' | 'markSuspect' | 'recordEvent' | 'move' | 'retire';

export interface EquipmentStep {
  from: readonly StoredFitnessStatus[];
  /** The roles that may take the step; the first one a person holds is the role they act in. */
  roles: readonly Role[];
  signs: Meaning | null;
}

/** The roles of the Lab's staff who do its work: any of them may mark Equipment suspect. */
export const labStaff: readonly Role[] = ['SampleCustodian', 'Analyst', 'Reviewer', 'QA', 'LabManager'];
const notRetired: readonly StoredFitnessStatus[] = ['Quarantined', 'InUse', 'Suspended'];

/** The role that registers Equipment, before there is a record for the step registry to read. */
export const equipmentRegistrar: Role = 'LabManager';

/** Whether someone holding `roles` reads Equipment and its Logbook: any of the Lab's staff. */
export const mayReadEquipment = (roles: readonly Role[]): boolean => roles.some((role) => labStaff.includes(role));

/**
 * The steps on Equipment once it is registered: QA approves it for use, anyone on the Lab's staff marks it suspect,
 * an Analyst or the Lab Manager records an Equipment Event and signs it Performed, and the Lab Manager moves and
 * retires it. The API refuses and the web offers by this table, and the database holds the same rules.
 */
export const equipmentSteps: { [K in EquipmentStepName]: EquipmentStep } = {
  approve: { from: ['Quarantined', 'Suspended'], roles: ['QA'], signs: 'Approved' },
  markSuspect: { from: notRetired, roles: labStaff, signs: null },
  recordEvent: { from: notRetired, roles: ['Analyst', 'LabManager'], signs: 'Performed' },
  move: { from: notRetired, roles: ['LabManager'], signs: null },
  retire: { from: notRetired, roles: ['LabManager'], signs: null },
};
export const equipmentStepNames = Object.keys(equipmentSteps).filter((key): key is EquipmentStepName =>
  Object.hasOwn(equipmentSteps, key),
);

/** The role someone holding `roles` acts in to take `name`, or null when they hold none of its roles. */
export function equipmentActingRole(name: EquipmentStepName, roles: readonly Role[]): Role | null {
  return equipmentSteps[name].roles.find((role) => roles.includes(role)) ?? null;
}

const stepWords: { [K in EquipmentStepName]: string } = {
  approve: 'approving Equipment for use',
  markSuspect: 'marking Equipment suspect',
  recordEvent: 'recording an Equipment Event',
  move: 'moving Equipment',
  retire: 'retiring Equipment',
};
const roleWords: { [R in Role]: string } = {
  Admin: 'Admin',
  Analyst: 'Analyst',
  Customer: 'Customer',
  LabManager: 'the Lab Manager',
  PlatformOperator: 'Platform Operator',
  QA: 'QA',
  Reviewer: 'Reviewer',
  SampleCustodian: 'Sample Custodian',
};
const statusWords: { [S in FitnessStatus]: string } = {
  Quarantined: 'Quarantined',
  InUse: 'In use',
  Suspended: 'Suspended',
  Expired: 'Expired',
  Retired: 'Retired',
};

/** Whether `name` may be taken, and in which role; or why not: the role first, then the status. */
export type EquipmentAccess = { refused: Refusal; role: null } | { refused: null; role: Role };

/** Whether someone holding `roles` may take `name` on Equipment in `status`, and the role they act in when they may. */
export function equipmentAccess(
  name: EquipmentStepName,
  status: StoredFitnessStatus,
  roles: readonly Role[],
): EquipmentAccess {
  const step = equipmentSteps[name];
  const role = equipmentActingRole(name, roles);
  if (role === null)
    return {
      refused: {
        kind: 'role',
        message: `Only ${step.roles.map((r) => roleWords[r]).join(' or ')} may take the step of ${stepWords[name]}.`,
      },
      role,
    };
  if (!step.from.includes(status))
    return {
      refused: {
        kind: 'state',
        message: `The step of ${stepWords[name]} is not open on ${statusWords[status]} Equipment.`,
      },
      role: null,
    };
  return { refused: null, role };
}

/** Why `name` may not be taken on Equipment in `status` by someone holding `roles`, or null when it may. */
export const equipmentRefusal = (name: EquipmentStepName, status: StoredFitnessStatus, roles: readonly Role[]) =>
  equipmentAccess(name, status, roles).refused;

/** The steps someone holding `roles` may take on Equipment in `status` now, in registry order; the web offers these. */
export function openEquipmentSteps(status: StoredFitnessStatus, roles: readonly Role[]): EquipmentStepName[] {
  return equipmentStepNames.filter((name) => equipmentRefusal(name, status, roles) === null);
}

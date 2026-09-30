// Identities the migrations install. The branded id types themselves live in @lims/domain/ids.

import type { LabId, LedgerId, PersonId } from '@lims/domain/ids';

/** A Lab's ledger id is the Lab id. */
export const ledgerOf = (lab: LabId): LedgerId => lab as string as LedgerId;

export const COMPANY_LEDGER = '00000000-0000-4000-8000-000000000001' as LedgerId;

/** The service identities the migrations install; each is a person holding one svc: role. */
export const SERVICE = {
  seed: { person: '00000000-0000-4000-8000-000000000002' as PersonId, role: 'svc:seed' },
  auth: { person: '00000000-0000-4000-8000-000000000003' as PersonId, role: 'svc:auth' },
  sessionSweeper: { person: '00000000-0000-4000-8000-000000000004' as PersonId, role: 'svc:session-sweeper' },
} as const;

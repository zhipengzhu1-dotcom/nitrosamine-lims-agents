import type { RefusalKind, Role } from './http.ts';

export interface StaffRefusal {
  kind: Extract<RefusalKind, 'role' | 'guard'>;
  message: string;
}

/** Staff accounts are managed by the Admin of the session's Lab, and by no one else. */
export function staffRefusal(roles: readonly Role[]): StaffRefusal | null {
  return roles.includes('Admin') ? null : { kind: 'role', message: 'Staff accounts are managed by the Admin.' };
}

/** What the database says when a grant would put Admin or Platform Operator beside a business role. */
export const administrationApart: StaffRefusal = {
  kind: 'guard',
  message: 'A person who holds Admin or Platform Operator holds no business role, in any Lab.',
};

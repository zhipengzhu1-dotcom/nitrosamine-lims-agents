import type { Meaning, Role, StepName, TestState } from '@lims/domain';
import { useEffect, useState } from 'react';

export interface Me {
  person: { id: string; username: string; displayName: string; customerId: string | null };
  lab: { id: string; code: string; name: string };
  roles: Role[];
}

export interface TestRow {
  id: string;
  state: TestState;
  gxpClass: string;
  sampleNumber: string;
  description: string;
  receivedAt: string | null;
  customer: string;
  methodCode: string;
  methodVersion: string;
  methodTitle: string;
  assignee: string | null;
}

export interface Result {
  analyte: string;
  value: string;
  unit: string;
  injectionSequenceRef: string;
  notebookRef: string;
  performedOn: string;
}

export interface Signature {
  meaning: Meaning;
  signer: string;
  signedAt: string;
  record: string;
  contentHash: string;
}

export type Row = Record<string, unknown>;
export interface AuditEntry {
  seq: string;
  at: string;
  actor: string;
  role: string;
  reason: string;
  table: string;
  op: string;
  oldRow: Row | null;
  newRow: Row | null;
}

export interface TestView {
  test: TestRow;
  report: { number: string } | null;
  result: Result | null;
  signatures: Signature[];
  auditTrail: AuditEntry[];
  next: StepName | null;
}

export type TestReport = Pick<TestView, 'test' | 'result' | 'signatures'> & { report: { number: string } };

export interface Lookups {
  methods: { id: string; code: string; version: string; title: string }[];
  analysts: { id: string; displayName: string }[];
}

export class Refused extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let signedOut = (_message: string) => {};
export const onSignedOut = (fn: (message: string) => void) => {
  signedOut = fn;
};

/**
 * GET when there is no body, POST otherwise. A 401 returns to sign-in once `/api/me` confirms the session is gone,
 * because a wrong password on a signature is also a 401 and leaves the session open.
 */
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(
    path,
    body === undefined
      ? {}
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  );
  const json = await res.json().catch(() => ({}));
  if (res.ok) return json as T;
  const message: string = json.message ?? res.statusText;
  if (res.status === 401 && path !== '/api/login' && (path === '/api/me' || !(await fetch('/api/me')).ok))
    signedOut(message);
  throw new Refused(res.status, message);
}

export async function signOut(): Promise<void> {
  await api('/api/logout', {}).catch(() => {});
  location.hash = '';
  signedOut('');
}

export function useApi<T>(path: string): { data?: T; error?: string; reload: () => void } {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    api<T>(path).then(
      (data) => live && setState({ data }),
      (e: Error) => live && setState({ error: e.message }),
    );
    return () => {
      live = false;
    };
  }, [path, version]);
  return { ...state, reload: () => setVersion((v) => v + 1) };
}

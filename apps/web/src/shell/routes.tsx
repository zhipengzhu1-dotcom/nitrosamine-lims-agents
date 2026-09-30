import type { ReactNode } from 'react';
import { AdminPeople } from '../screens/AdminPeople';
import { Assignment } from '../screens/chain/Assignment';
import { Intake } from '../screens/chain/Intake';
import { Queue } from '../screens/chain/Queue';
import { ReportScreen } from '../screens/chain/ReportScreen';
import { Reports } from '../screens/chain/Reports';
import { ReviewScreen } from '../screens/chain/ReviewScreen';
import { TestWorkbench } from '../screens/chain/TestWorkbench';
import { Portal } from '../screens/portal/Portal';
import { SubmitSubmission } from '../screens/portal/SubmitSubmission';
import { RoughScreen } from '../screens/rough/RoughScreen';
import { ROUGH_MODULES } from '../screens/rough/modules';

/** Who a screen is for: staff act in a Lab, a Customer User in the portal, the Admin for the company (decision 13). */
export type Audience = 'staff' | 'customer' | 'admin';

export type Params = Readonly<Record<string, string>>;

export type Route = {
  /** A path, with `:name` segments for record ids, e.g. "/tests/:id". */
  readonly path: string;
  /** The destination as a person reads it, printed on the sign-in screen for a deep link. */
  readonly title: string;
  readonly audience: Audience;
  readonly nav: boolean;
  readonly render: (params: Params) => ReactNode;
};

const ROUTES: readonly Route[] = [
  { path: '/', title: 'Work', audience: 'staff', nav: true, render: () => <Queue /> },
  { path: '/intake', title: 'Intake', audience: 'staff', nav: true, render: () => <Intake /> },
  { path: '/assign', title: 'Assignment', audience: 'staff', nav: true, render: () => <Assignment /> },
  { path: '/reports', title: 'Reports', audience: 'staff', nav: true, render: () => <Reports /> },
  { path: '/tests/:id', title: 'the Test', audience: 'staff', nav: false, render: (p) => <TestWorkbench testId={p['id'] ?? ''} /> },
  { path: '/review/:kind/:id', title: 'the Review', audience: 'staff', nav: false, render: (p) => <ReviewScreen kind={p['kind'] === 'run' ? 'run' : 'test'} recordId={p['id'] ?? ''} /> },
  { path: '/reports/:id', title: 'the Test Report', audience: 'staff', nav: false, render: (p) => <ReportScreen reportId={p['id'] ?? ''} /> },
  ...ROUGH_MODULES.map((m): Route => ({ path: `/${m.slug}`, title: m.title, audience: 'staff', nav: true, render: () => <RoughScreen module={m} /> })),
  { path: '/', title: 'Submissions', audience: 'customer', nav: true, render: () => <Portal /> },
  { path: '/submit', title: 'New Submission', audience: 'customer', nav: true, render: () => <SubmitSubmission /> },
  { path: '/admin/people', title: 'People', audience: 'admin', nav: true, render: () => <AdminPeople /> },
];

/** Dev-only screens, registered by main.tsx under import.meta.env.DEV so they never ship. */
const extra: Route[] = [];
export function registerDevRoute(route: Route): void {
  extra.push(route);
}

export function routes(): readonly Route[] {
  return [...ROUTES, ...extra];
}

const ID = /^[0-9a-zA-Z-]{1,64}$/;

/** A path's `:name` segments as params, or null when the path does not fit the pattern. */
export function match(pattern: string, path: string): Params | null {
  const want = pattern.split('/');
  const got = path.split('/');
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (const [i, w] of want.entries()) {
    const g = got[i] ?? '';
    if (w.startsWith(':')) {
      if (!ID.test(g)) return null;
      params[w.slice(1)] = g;
    } else if (w !== g) return null;
  }
  return params;
}

export type Resolved = { readonly route: Route; readonly params: Params };

/** Every route this path fits, one per audience at most; the Workspace picks the session's. */
export function resolveAll(path: string): readonly Resolved[] {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return routes().flatMap((route) => {
    const params = match(route.path, clean);
    return params ? [{ route, params }] : [];
  });
}

export function resolve(path: string, audience?: Audience): Resolved | null {
  const all = resolveAll(path);
  return all.find((r) => r.route.audience === audience) ?? all[0] ?? null;
}

/** Where each audience lands at "/". */
export function homeFor(audience: Audience): string {
  return audience === 'admin' ? '/admin/people' : '/';
}

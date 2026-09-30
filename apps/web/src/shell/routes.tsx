import type { ReactNode } from 'react';
import { AdminPeople } from '../screens/AdminPeople';
import { Home } from '../screens/Home';
import { RoughScreen } from '../screens/rough/RoughScreen';
import { ROUGH_MODULES } from '../screens/rough/modules';

/** Who a screen is for: staff act in a Lab, the Admin acts for the company (decision 13). */
export type Audience = 'staff' | 'admin';

export type Route = {
  readonly path: string;
  /** The destination as a person reads it, printed on the sign-in screen for a deep link. */
  readonly title: string;
  readonly audience: Audience;
  readonly nav: boolean;
  readonly render: () => ReactNode;
};

const ROUTES: readonly Route[] = [
  { path: '/', title: 'Work', audience: 'staff', nav: true, render: () => <Home /> },
  ...ROUGH_MODULES.map((m): Route => ({ path: `/${m.slug}`, title: m.title, audience: 'staff', nav: true, render: () => <RoughScreen module={m} /> })),
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

export function resolve(path: string): Route | null {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return routes().find((r) => r.path === clean) ?? null;
}

/** Where each audience lands at "/". */
export function homeFor(audience: Audience): string {
  return audience === 'admin' ? '/admin/people' : '/';
}

// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../api/client';
import { ApiContext } from '../api/hooks';
import { SessionContext } from '../session/context';
import type { ActiveSession, SessionStore } from '../session/store';
import { Workspace } from './Workspace';

const ZONE = 'America/New_York';

const staff = (idleInMs: number): ActiveSession => ({
  person: { printedName: 'Mei Chen', nativeName: '陈梅', username: 'mchen', role: 'Analyst, Reviewer' },
  roles: ['Analyst', 'Reviewer'],
  lab: { id: 'lab-1', code: 'RD', zone: ZONE },
  workstation: 'Bench PC RD-102-02',
  zone: ZONE,
  signedInAt: { utc: '2026-09-30T13:02:00Z', zone: ZONE },
  idleLockAt: { utc: new Date(Date.now() + idleInMs).toISOString(), zone: ZONE },
  epoch: 's1:0',
  dataClass: 'fictional',
  customer: null,
});

function mount(active: ActiveSession, path: string) {
  render(
    <ApiContext value={createApi({ fetch: vi.fn() as never, onSessionLost: () => {} })}>
      <SessionContext value={{ active, store: { skewMs: () => 0 } as unknown as SessionStore }}>
        <Workspace path={path} />
      </SessionContext>
    </ApiContext>,
  );
}

describe('Workspace', () => {
  it('names the person, roles and PC from the server session, with the Fictional data banner', () => {
    mount(staff(10 * 60_000), '/deviations');
    const rail = screen.getByRole('contentinfo', { name: 'Signed-in person and actions' });
    expect(within(rail).getByText('Mei Chen')).toBeInTheDocument();
    expect(within(rail).getByText(/Analyst, Reviewer,/)).toBeInTheDocument();
    expect(screen.getByText('Bench PC RD-102-02')).toBeInTheDocument();
    expect(screen.getByText('Fictional data')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Deviations' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Deviations' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'People' })).toBeNull();
  });

  it('counts down the idle lock in its last minute, from the server\'s deadline', () => {
    mount(staff(42_000), '/');
    expect(screen.getByText(/Locks in 4[12] s without input/)).toBeInTheDocument();
  });

  it('keeps the Admin out of Lab screens', () => {
    mount({ ...staff(600_000), lab: null, roles: ['Admin'], person: { printedName: 'Adam Admin', nativeName: null, username: 'adam', role: 'Admin' } }, '/deviations');
    expect(screen.getByRole('heading', { name: 'Not for this account' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'People' })).toBeInTheDocument();
  });
});

describe('the Fictional data banner (#34)', () => {
  it('reads the deployment\'s data class from the server session', () => {
    mount({ ...staff(600_000), dataClass: 'real' }, '/deviations');
    expect(screen.queryByText('Fictional data')).toBeNull();
  });

  it('is never hidden by any stylesheet, at any width', () => {
    const src = join(import.meta.dirname, '..');
    const css = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.css'))
      .map((f) => readFileSync(join(src, f), 'utf8'))
      .join('\n');
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector?.trim() ?? '', body: body ?? '' }));
    const hiding = rules.filter((r) => /\.fict\b/.test(r.selector) && /display:\s*none|visibility:\s*hidden/.test(r.body));
    expect(hiding).toEqual([]);
  });
});

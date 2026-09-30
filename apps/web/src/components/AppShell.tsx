import type { ReactNode } from 'react';
import type { DataClass } from '@lims/contract';
import type { ServerInstant, Workstation } from '../model';
import { labTime } from '../time';
import { Glyph } from './Glyph';
import './shell.css';

export type NavItem = { readonly label: string; readonly href: string; readonly current: boolean };

export function LabClock({ now }: { now: ServerInstant }) {
  const t = labTime(now);
  return (
    <span className="clock">
      <span className="clock__local">
        {t.time} {t.zone}
      </span>
      <span className="clock__utc">{t.utcTime} UTC</span>
    </span>
  );
}

/** The header belongs to the PC, not the person, so Switch user never changes it. */
export function TopBar(props: { workstation: Workstation; now: ServerInstant; nav: readonly NavItem[]; dataClass: DataClass }) {
  return (
    <header className="top">
      <span className="brand">
        <span className="brand__mark" aria-hidden="true">
          RD
        </span>
        <span className="brand__name">Nitrosamine LIMS</span>
      </span>
      <nav className="nav" aria-label="Screens">
        {props.nav.map((item) => (
          <a key={item.href} className="nav__tab" href={item.href} aria-current={item.current ? 'page' : undefined}>
            {item.label}
          </a>
        ))}
      </nav>
      <span className="station">
        <Glyph name="pc" size={18} />
        {props.workstation.name}
      </span>
      <LabClock now={props.now} />
      {props.dataClass === 'fictional' && <span className="fict">Fictional data</span>}
    </header>
  );
}

/**
 * Read above, act below: a 48 px header naming the workstation, the dense reading plane, and the
 * dark rail along the bottom edge.
 */
export function AppShell(props: { top: ReactNode; rail: ReactNode; children: ReactNode }) {
  return (
    <>
      <a className="skip" href="#view">
        Skip to the main content
      </a>
      <a className="skip" href="#rail">
        Skip to the actions in the rail
      </a>
      <div className="frame">
        {props.top}
        <main className="view" id="view" tabIndex={-1}>
          {props.children}
        </main>
        {props.rail}
      </div>
    </>
  );
}

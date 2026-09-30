import type { ReactElement } from 'react';

// Each status has its own shape, so colour is never the only signal.
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const GLYPHS = {
  check: (
    <g {...stroke}>
      <circle cx="10" cy="10" r="7.6" />
      <path d="M6.6 10.2l2.3 2.3 4.6-4.9" />
    </g>
  ),
  tick: <path {...stroke} strokeWidth={2.2} d="M4.5 10.5l3.6 3.6 7.4-8" />,
  fail: (
    <g {...stroke}>
      <circle cx="10" cy="10" r="7.6" />
      <path d="M7.2 7.2l5.6 5.6M12.8 7.2l-5.6 5.6" />
    </g>
  ),
  hold: (
    <g fill="currentColor">
      <rect x="4.5" y="4" width="4" height="12" rx="1.2" />
      <rect x="11.5" y="4" width="4" height="12" rx="1.2" />
    </g>
  ),
  dev: (
    <g {...stroke}>
      <path d="M10 2.8l7.6 13.4H2.4z" />
      <path d="M10 8v3.6" />
      <circle cx="10" cy="14" r=".6" fill="currentColor" />
    </g>
  ),
  clock: (
    <g {...stroke}>
      <circle cx="10" cy="10" r="7.6" />
      <path d="M10 5.8V10l2.8 1.8" />
    </g>
  ),
  noentry: (
    <g {...stroke}>
      <circle cx="10" cy="10" r="7.6" />
      <path d="M6 10h8" strokeWidth={2.6} />
    </g>
  ),
  hourglass: <path {...stroke} d="M5.5 3h9M5.5 17h9M6.5 3c0 4 7 4 7 7s-7 3-7 7M13.5 3c0 4-7 4-7 7s7 3 7 7" />,
  quarantine: (
    <g {...stroke}>
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <path d="M3 11l8-8M7 17L17 7M13 17l4-4" />
    </g>
  ),
  retired: (
    <g {...stroke}>
      <circle cx="10" cy="10" r="7.6" />
      <path d="M4.8 15.2L15.2 4.8" />
    </g>
  ),
  todo: <circle {...stroke} cx="10" cy="10" r="7.6" />,
  dash: <path {...stroke} strokeWidth={2.2} d="M4.5 10h11" />,
  provisional: (
    <g {...stroke}>
      <circle cx="10" cy="10" r="7.6" strokeDasharray="3 2.4" />
      <path d="M10 2.4a7.6 7.6 0 010 15.2z" fill="currentColor" stroke="none" />
    </g>
  ),
  unknown: (
    <g {...stroke}>
      <circle cx="10" cy="10" r="7.6" />
      <path d="M7.8 7.8a2.3 2.3 0 114 1.5c-.8.6-1.8 1.1-1.8 2.2" />
      <circle cx="10" cy="14.1" r=".7" fill="currentColor" />
    </g>
  ),
  pencil: (
    <g {...stroke}>
      <path d="M12.8 3.8l3.4 3.4-9 9H3.8v-3.4z" />
      <path d="M11 5.6l3.4 3.4" />
    </g>
  ),
  sig: (
    <g {...stroke}>
      <path d="M10 2.5l4.5 6.2L10 17.5 5.5 8.7z" />
      <path d="M10 9.6v7.9" />
      <circle cx="10" cy="9" r="1.3" />
    </g>
  ),
  lock: (
    <g {...stroke}>
      <rect x="4" y="8.6" width="12" height="8.6" rx="1.8" />
      <path d="M6.8 8.6V6.2a3.2 3.2 0 016.4 0v2.4" />
    </g>
  ),
  switch: <path {...stroke} d="M3.5 7h12l-3-3M16.5 13h-12l3 3" />,
  search: (
    <g {...stroke}>
      <circle cx="8.6" cy="8.6" r="5.4" />
      <path d="M12.6 12.6l4 4" />
    </g>
  ),
  back: (
    <g {...stroke}>
      <path d="M7.2 4.5H16a1.5 1.5 0 011.5 1.5v8a1.5 1.5 0 01-1.5 1.5H7.2L2.5 10z" />
      <path d="M9.5 8l4 4M13.5 8l-4 4" />
    </g>
  ),
  file: (
    <g {...stroke}>
      <path d="M5 2.5h6.5L15.5 6.5v11H5z" />
      <path d="M11.5 2.5v4h4" />
    </g>
  ),
  key: (
    <g {...stroke}>
      <circle cx="6.5" cy="10" r="3.5" />
      <path d="M10 10h7.5M15 10v3M17.5 10v2" />
    </g>
  ),
  pc: (
    <g {...stroke}>
      <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" />
      <path d="M7.5 17h5M10 13.5V17" />
    </g>
  ),
  next: <path {...stroke} d="M3.5 10h12M11.5 6l4 4-4 4" />,
  sortUp: <path {...stroke} d="M6 12l4-4 4 4" />,
  sortDown: <path {...stroke} d="M6 8l4 4 4-4" />,
  sortNone: <path {...stroke} d="M7 8l3-3 3 3M7 12l3 3 3-3" />,
} satisfies Record<string, ReactElement>;

export type GlyphName = keyof typeof GLYPHS;

export function Glyph({ name, size = 18, className }: { name: GlyphName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `ic ${className}` : 'ic'}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      data-glyph={name}
    >
      {GLYPHS[name]}
    </svg>
  );
}

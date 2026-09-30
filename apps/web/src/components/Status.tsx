import type { DeviationRef, GxpClass, Hold, NonEmpty, RiskLevel, Tone } from '../model';
import { Glyph, type GlyphName } from './Glyph';
import './status.css';

const TONE_GLYPH: Record<Tone, GlyphName> = {
  ok: 'check',
  warn: 'clock',
  bad: 'fail',
  idle: 'dash',
  provisional: 'provisional',
  neutral: 'todo',
};

/** A status reads as a word, then a glyph, then colour. The word comes from the server (rule 14). */
export function StatusWord({ word, tone, glyph }: { word: string; tone: Tone; glyph?: GlyphName }) {
  return (
    <span className={`status status--${tone}`}>
      <Glyph name={glyph ?? TONE_GLYPH[tone]} size={16} />
      <span className="status__word">{word}</span>
    </span>
  );
}

export function GxpBadge({ gxpClass }: { gxpClass: GxpClass }) {
  return gxpClass === 'GMP' ? (
    <span className="gxp gxp--gmp">GMP</span>
  ) : (
    <span className="gxp gxp--non">Non-GMP</span>
  );
}

/**
 * A Hold is its own tag, never a state (decision 23). Where a Test is worked, each Hold's reason
 * and the steps it blocks print as text (rule 17); `compact` is for queue rows, whose detail band
 * carries the reason.
 */
export function HoldTag({ holds, compact = false }: { holds: NonEmpty<Hold>; compact?: boolean }) {
  const count = holds.length === 1 ? '1 Hold' : `${holds.length} Holds`;
  return (
    <span className="hold">
      <span className="tag tag--hold">
        <Glyph name="hold" size={14} />
        {count}
      </span>
      {compact ? (
        <span className="hold__kinds">{holds.map((h) => h.kind).join(', ')}</span>
      ) : (
        <ul className="hold__list">
          {holds.map((h) => (
            <li key={h.id}>
              <b>{h.kind}</b> <span className="mono">{h.id}</span>
              <span className="hold__reason">{h.reason}</span>
              {h.blocks.length > 0 && <span className="hold__blocks">Blocks {h.blocks.join(', ')}</span>}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

export function RiskTag({ level }: { level: RiskLevel }) {
  return <span className={`risk risk--${level.toLowerCase()}`}>{level}</span>;
}

/** A Deviation shows its ID, Kind and Risk Level; the fill grows with the risk. */
export function DeviationTag({ deviation }: { deviation: DeviationRef }) {
  return (
    <span className="devtag">
      <span className={`tag tag--dev${deviation.riskLevel === 'Critical' ? ' tag--critical' : ''}`}>
        <Glyph name="dev" size={14} />
        {deviation.id}
      </span>
      <span className="devtag__kind">
        {deviation.kind}
        <RiskTag level={deviation.riskLevel} />
      </span>
    </span>
  );
}

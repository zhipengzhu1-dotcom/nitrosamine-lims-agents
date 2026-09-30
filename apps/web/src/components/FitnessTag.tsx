import type { Fitness, FitnessStatus } from '../model';
import { Glyph, type GlyphName } from './Glyph';
import './status.css';

const LOOK: Record<FitnessStatus, { tone: 'ok' | 'warn' | 'bad' | 'idle'; glyph: GlyphName }> = {
  'In use': { tone: 'ok', glyph: 'check' },
  Quarantined: { tone: 'warn', glyph: 'quarantine' },
  Suspended: { tone: 'bad', glyph: 'noentry' },
  Expired: { tone: 'bad', glyph: 'hourglass' },
  Retired: { tone: 'idle', glyph: 'retired' },
};

const UNKNOWN = { tone: 'bad', glyph: 'unknown', word: 'Status unknown', note: 'Cannot be used until its status is known' } as const;

/**
 * Prints the Fitness Status word and its reason or validity date as text, always (rule 19).
 * The compact form is smaller and drops the tint; it never hides either. A status the UI does not
 * know renders "Status unknown" and reads as blocking.
 */
export function FitnessTag({ fitness, compact = false }: { fitness: Fitness; compact?: boolean }) {
  // The lookup can still miss at runtime if a caller skipped parseFitness and cast a raw string.
  const look: (typeof LOOK)[FitnessStatus] | undefined = fitness.status === 'unknown' ? undefined : LOOK[fitness.status];
  const shown =
    look === undefined || fitness.status === 'unknown'
      ? UNKNOWN
      : { tone: look.tone, glyph: look.glyph, word: fitness.status, note: fitness.note };
  return (
    <span className={`fit fit--${shown.tone}${compact ? ' fit--compact' : ''}`} data-blocks={shown === UNKNOWN || undefined}>
      <Glyph name={shown.glyph} size={16} />
      <span className="fit__word">{shown.word}</span>
      <span className="fit__note">{shown.note}</span>
    </span>
  );
}

/** Status at the time of use, plus the current status and its Deviation when it changed since (rule 19). */
export function FitnessAtUse(props: {
  atUse: Fitness;
  changedSince: { now: Fitness; deviationId: string | null } | null;
}) {
  return (
    <span className="fit-use">
      <span className="fit-use__row">
        <span className="fit-use__label">At use</span>
        <FitnessTag fitness={props.atUse} compact />
      </span>
      {props.changedSince && (
        <span className="fit-use__row">
          <span className="fit-use__label">Now</span>
          <FitnessTag fitness={props.changedSince.now} compact />
          {props.changedSince.deviationId && <span className="mono">{props.changedSince.deviationId}</span>}
        </span>
      )}
    </span>
  );
}

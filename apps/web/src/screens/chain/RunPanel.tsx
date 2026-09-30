import type { RunDetailDto, ValueDto } from '@lims/contract';
import { StatusWord } from '../../components/Status';
import { Hash } from '../../components/Hash';
import { decimalString, sha256Hex, type LimitLine } from '../../model';
import { RecordedValueField, type SavedValue } from '../../values/RecordedValueField';
import { Signatures } from './common';

export const savedOf = (v: ValueDto | undefined): SavedValue | null =>
  v ? { valueId: v.valueId, text: v.text, versionNo: v.version.versionNo, standing: v.pending ? 'pending' : 'effective', pendingText: v.pending?.text ?? null } : null;

const limitOf = (c: RunDetailDto['runChecks'][number]): LimitLine => ({
  label: `Criterion (${c.source})`,
  limit: c.limit.op === 'range'
    ? { kind: 'range', low: decimalString(c.limit.low), high: decimalString(c.limit.high), unit: c.unit }
    : { kind: c.limit.op, value: decimalString(c.limit.limit), unit: c.unit },
});

const OUTCOME: Readonly<Record<string, { word: string; tone: 'ok' | 'bad' | 'neutral' }>> = {
  conforms: { word: 'Passes', tone: 'ok' },
  'does-not-conform': { word: 'Failed', tone: 'bad' },
  'not-recorded': { word: 'Missing', tone: 'bad' },
};

/**
 * A typed Run: its Run Version, the instrument, sequence ID and True Copy, and each Run Check with
 * its criterion as written and its source (rule 15). The acquirer types each Run Check value here.
 */
export function RunPanel({ run, editable, onSaved }: { run: RunDetailDto; editable: boolean; onSaved: () => void }) {
  const value = (field: string, subject = '') => run.values.find((v) => v.field === field && v.subject === subject);
  const trueCopy = value('run.trueCopy');
  return (
    <section className="panel" aria-label={`Run ${run.run.number}`}>
      <h2 className="h-sec">
        Run {run.run.number}
        <StatusWord word={run.run.state} tone={run.run.state === 'Open' ? 'neutral' : 'ok'} />
      </h2>
      <dl className="facts">
        <div>
          <dt>Run Version</dt>
          <dd>{run.run.version ? <>Version {run.run.version.versionNo}, {run.run.version.versionId}, SHA-256 <Hash value={sha256Hex(run.run.version.hash)} /></> : 'Not sealed yet: a version is sealed when a signing prompt opens.'}</dd>
        </div>
        <div>
          <dt>Instrument</dt>
          <dd>{run.instrument ? `${run.instrument.code} (${run.instrument.kind}), ${run.instrument.fitness}` : 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Sequence ID</dt>
          <dd className="mono">{value('run.sequence')?.text ?? 'Not recorded'}</dd>
        </div>
        <div>
          <dt>True Copy</dt>
          <dd>{trueCopy ? <>SHA-256 <Hash value={sha256Hex(trueCopy.text)} /></> : 'Not attached'}</dd>
        </div>
      </dl>
      <h3 className="h-mini">Run Checks</h3>
      <ul className="checks">
        {run.runChecks.map((c) => (
          <li key={c.name} className="checks__row">
            {editable ? (
              <RecordedValueField
                parent={run.run.id}
                field="runcheck.value"
                subject={c.name}
                label={`Run Check ${c.name}`}
                unit={c.unit}
                role="Analyst"
                critical
                limits={[limitOf(c)]}
                saved={savedOf(value('runcheck.value', c.name))}
                onSaved={onSaved}
              />
            ) : (
              <p>
                <b>Run Check {c.name}</b>: {c.value === null ? 'not recorded' : `${c.value} ${c.unit}`}
                <span className="sub">
                  Criterion {c.criterion} {c.unit}, from {c.source}
                </span>
              </p>
            )}
            <StatusWord word={OUTCOME[c.outcome]?.word ?? c.outcome} tone={OUTCOME[c.outcome]?.tone ?? 'bad'} />
          </li>
        ))}
      </ul>
      <Signatures lines={run.signatures} record={`Run ${run.run.number}`} title="Signatures on the Run" />
    </section>
  );
}

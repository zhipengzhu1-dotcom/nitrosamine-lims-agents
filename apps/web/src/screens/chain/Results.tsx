import type { TestDetailDto } from '@lims/contract';
import { StatusWord } from '../../components/Status';
import type { Tone } from '../../model';

const VERDICT: Readonly<Record<string, { word: string; tone: Tone }>> = {
  conforms: { word: 'Conforms', tone: 'ok' },
  'does-not-conform': { word: 'Does not conform', tone: 'bad' },
  'not-judged': { word: 'Not judged', tone: 'bad' },
};

/** "Conforms" never shows while the verdict is Provisional (rule 22). */
function Verdict({ outcome, provisional }: { outcome: string; provisional: boolean }) {
  if (provisional) return <StatusWord word={outcome === 'conforms' ? 'Provisional' : `Provisional: ${VERDICT[outcome]?.word ?? outcome}`} tone="provisional" />;
  const v = VERDICT[outcome] ?? { word: outcome, tone: 'neutral' as const };
  return <StatusWord word={v.word} tone={v.tone} />;
}

const ROUNDING: Readonly<Record<string, string>> = { 'half-away-from-zero': 'half away from zero', 'half-even': 'half to even' };

/**
 * Results grouped by Specification Section (rule 22): each Preparation and the mean at full
 * precision, labelled as such; the value rounded once by the Section's Rule Set beside the limit as
 * written; the share of the limit. Until Performed stands on this version every verdict reads
 * Provisional, in word, glyph and colour.
 */
export function Results({ detail }: { detail: TestDetailDto }) {
  const j = detail.judgement;
  const provisional = !detail.performedStands;
  if (!j) {
    return (
      <section className="panel" aria-label="Results">
        <h2 className="h-sec">Results by Specification Section</h2>
        <p className="sub">{detail.missingValues.length > 0 ? `No judgement until every value is in: ${detail.missingValues.join(', ')}.` : 'No judgement yet.'}</p>
      </section>
    );
  }
  const spec = detail.specification;
  return (
    <section className="panel results" aria-label="Results">
      <h2 className="h-sec">
        Results by Specification Section
        {provisional && <StatusWord word="Provisional until the Test is signed Performed" tone="provisional" />}
      </h2>
      {j.variability.map((v) => (
        <p key={v.analyte} className="results__var">
          {v.analyte} variability between Preparations{v.limit && `, NMT ${v.limit} %`}:{' '}
          {v.pairs.map((p) => `${p.preparations} ${p.compared} % (full precision ${p.fullPrecision} %)`).join('; ')} <Verdict outcome={v.outcome} provisional={provisional} />
        </p>
      ))}
      {j.sections.map((s) => (
        <div key={s.jurisdiction} className="results__section">
          <h3 className="h-mini">
            {s.jurisdiction} Section, Specification {spec?.purpose ?? ''} version {spec?.versionNo ?? ''}, Rule Set {s.ruleSetVersion}, rounding {ROUNDING[s.rounding] ?? s.rounding}
          </h3>
          <table className="results__table">
            <thead>
              <tr>
                <th scope="col">Analyte</th>
                <th scope="col">Preparation</th>
                <th scope="col">Full precision</th>
                <th scope="col">Rounded once</th>
                <th scope="col">Limit as written</th>
                <th scope="col">Share of limit</th>
                <th scope="col">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {s.lines.flatMap((l) => [
                ...l.preparations.map((p) => (
                  <tr key={`${l.analyte}-${p.preparation}`}>
                    <td>{l.analyte}</td>
                    <td>{p.preparation}</td>
                    <td className="num">
                      {p.fullPrecision} {l.unit}
                      <span className="sub">full precision</span>
                    </td>
                    <td className="num">
                      {p.compared} {l.unit}
                    </td>
                    <td className="num">
                      NMT ≤ {l.limit} {l.unit}
                    </td>
                    <td className="num">{p.sharePercent} %</td>
                    <td>
                      <Verdict outcome={p.conforms ? 'conforms' : 'does-not-conform'} provisional={provisional} />
                    </td>
                  </tr>
                )),
                <tr key={`${l.analyte}-mean`} className="results__mean">
                  <td>{l.analyte}</td>
                  <td>Reportable Result (mean)</td>
                  <td className="num">
                    {l.fullPrecision} {l.unit}
                    <span className="sub">full precision</span>
                  </td>
                  <td className="num">{l.compared === null ? 'not judged' : `${l.compared} ${l.unit}`}</td>
                  <td className="num">
                    NMT ≤ {l.limit} {l.unit}
                  </td>
                  <td className="num">{l.sharePercent === null ? '' : `${l.sharePercent} %`}</td>
                  <td>
                    <Verdict outcome={l.outcome} provisional={provisional} />
                    {l.because && <span className="sub">Not judged because of the {l.because}</span>}
                  </td>
                </tr>,
              ])}
            </tbody>
          </table>
          <p className="results__outcome">
            {s.jurisdiction} Section: <Verdict outcome={s.outcome} provisional={provisional} />
          </p>
        </div>
      ))}
    </section>
  );
}

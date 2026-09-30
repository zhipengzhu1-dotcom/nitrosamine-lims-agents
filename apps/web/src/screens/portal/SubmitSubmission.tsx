import { useId, useState } from 'react';
import type { PortalCatalogueDto } from '@lims/contract';
import { useCommand, useView } from '../../api/hooks';
import { useRail } from '../../shell/rail';
import { Reading, Refusal, useAct } from '../chain/common';

type SampleDraft = { readonly productId: string; readonly lotNumber: string; readonly methods: readonly string[] };
type SubmitInput = { labId: string; samples: { productId: string; lotNumber: string; tests: { methodId: string }[] }[] };

const emptySample = (): SampleDraft => ({ productId: '', lotNumber: '', methods: [''] });

/**
 * A Customer User submits a Submission: the Lab, and for each Sample its Product, lot and the
 * Tests wanted, each on a Method from the catalogue. The Samples are Expected and the Tests
 * Requested until the Lab's Sample Custodian accepts and receives them.
 */
export function SubmitSubmission() {
  const id = useId();
  const catalogue = useView<PortalCatalogueDto>('portal.catalogue', {});
  const submit = useCommand<SubmitInput, { number: string }>('submission.submit');
  const { refusal, act } = useAct();
  const [labId, setLabId] = useState('');
  const [samples, setSamples] = useState<readonly SampleDraft[]>([emptySample()]);

  const c = catalogue.status === 'ok' ? catalogue.data : null;
  const lab = labId || c?.labs[0]?.id || '';
  const missing = [
    lab === '' && 'the Lab',
    samples.some((s) => s.productId === '') && 'a Product for every Sample',
    samples.some((s) => s.lotNumber.trim() === '') && 'a lot number for every Sample',
    samples.some((s) => s.methods.some((m) => m === '')) && 'a Method for every Test',
  ].filter((m): m is string => typeof m === 'string');

  const set = (i: number, next: SampleDraft) => setSamples(samples.map((s, j) => (j === i ? next : s)));

  useRail({
    context: { main: 'New Submission', sub: `${samples.length} Sample${samples.length === 1 ? '' : 's'}, ${samples.reduce((n, s) => n + s.methods.length, 0)} Tests` },
    primary: missing.length === 0
      ? { kind: 'commit', label: 'Submit the Submission', onCommit: () => act(submit, { labId: lab, samples: samples.map((s) => ({ productId: s.productId, lotNumber: s.lotNumber.trim(), tests: s.methods.map((methodId) => ({ methodId })) })) }, () => window.location.assign('/')) }
      : { kind: 'blocked', label: 'Submit the Submission', reason: `Still needed: ${missing.join('; ')}.` },
  });

  return (
    <div className="screen">
      <header className="screen__head">
        <h1 className="h-screen">New Submission</h1>
        <p className="screen__lede">Name each Sample by Product and lot, and the Tests you want on it.</p>
      </header>
      <Refusal text={refusal} />
      <Reading view={catalogue}>
        {(cat) => (
          <div className="submit">
            <div className="field submit__lab">
              <label htmlFor={`${id}-lab`}>Lab</label>
              <select id={`${id}-lab`} value={lab} onChange={(e) => setLabId(e.target.value)}>
                {cat.labs.map((l) => (
                  <option key={l.id} value={l.id}>
                    Lab {l.code}
                  </option>
                ))}
              </select>
            </div>
            {samples.map((s, i) => (
              <fieldset key={i} className="panel submit__sample">
                <legend className="h-sec">Sample {i + 1}</legend>
                <div className="submit__grid">
                  <div className="field">
                    <label htmlFor={`${id}-p${i}`}>Product</label>
                    <select id={`${id}-p${i}`} value={s.productId} onChange={(e) => set(i, { ...s, productId: e.target.value })}>
                      <option value="">Choose the Product</option>
                      {cat.products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`${id}-l${i}`}>Lot number</label>
                    <input id={`${id}-l${i}`} autoComplete="off" value={s.lotNumber} onChange={(e) => set(i, { ...s, lotNumber: e.target.value })} />
                  </div>
                </div>
                {s.methods.map((m, k) => (
                  <div key={k} className="field">
                    <label htmlFor={`${id}-m${i}-${k}`}>
                      Test {k + 1} on Sample {i + 1}: Method
                    </label>
                    <select id={`${id}-m${i}-${k}`} value={m} onChange={(e) => set(i, { ...s, methods: s.methods.map((x, j) => (j === k ? e.target.value : x)) })}>
                      <option value="">Choose the Method</option>
                      {cat.methods.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.number} {x.title}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                <button type="button" className="linkbtn" onClick={() => set(i, { ...s, methods: [...s.methods, ''] })}>
                  Add a Test to Sample {i + 1}
                </button>
              </fieldset>
            ))}
            <button type="button" className="linkbtn" onClick={() => setSamples([...samples, emptySample()])}>
              Add a Sample
            </button>
          </div>
        )}
      </Reading>
    </div>
  );
}

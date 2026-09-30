import { useId, useState } from 'react';
import type { LabReferenceDto, RunDetailDto, TestDetailDto, ValueDto } from '@lims/contract';
import { useCommand, useView } from '../../api/hooks';
import { CommitButton } from '../../components/CommitButton';
import { FitnessTag } from '../../components/FitnessTag';
import { StatusWord } from '../../components/Status';
import { parseFitness } from '../../model';
import type { RailPrimary } from '../../components/Rail';
import { useSession } from '../../session/context';
import { useRail } from '../../shell/rail';
import { useSigning } from '../../signing/useSigning';
import { RecordAuditTrail } from '../../values/RecordAuditTrail';
import { RecordedValueField } from '../../values/RecordedValueField';
import { blockedReasons, Reading, Refusal, Signatures, TestPlate, useAct, useRoles } from './common';
import { Results } from './Results';
import { RunPanel, savedOf } from './RunPanel';

type RunForm = { readonly equipmentId: string; readonly sequenceId: string; readonly file: File | null };

async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Every Recorded Value on the Test and its Run with its Verified state, for the second person. */
function ValuesToVerify({ values }: { values: readonly (ValueDto & { readonly on: string })[] }) {
  return (
    <section className="panel" aria-label="Values and their verification">
      <h2 className="h-sec">Values and their verification</h2>
      <table className="results__table">
        <thead>
          <tr>
            <th scope="col">Record</th>
            <th scope="col">Field</th>
            <th scope="col">Value</th>
            <th scope="col">Verified</th>
          </tr>
        </thead>
        <tbody>
          {values.map((v) => (
            <tr key={v.valueId}>
              <td>{v.on}</td>
              <td>{v.label}</td>
              <td className="num">
                {v.type === 'blob' ? `File ${v.text.slice(0, 8)}` : v.text}
                {v.unit && ` ${v.unit}`}
                {v.pending && <span className="sub">Change to {v.pending.text} pending approval</span>}
              </td>
              <td>{v.verified && !v.pending ? <StatusWord word="Verified" tone="ok" /> : <StatusWord word={v.pending ? 'Change pending' : 'Not verified'} tone="warn" />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** The typed Run's first save: the instrument, the sequence ID and the True Copy, all Verified later. */
function NewRun({ lab, form, onChange }: { lab: LabReferenceDto; form: RunForm; onChange: (f: RunForm) => void }) {
  const id = useId();
  return (
    <section className="panel run-form" aria-label="New typed Run">
      <h2 className="h-sec">Typed Run</h2>
      <p className="sub">Choose the instrument, type the sequence ID from the printout and attach the printout as the True Copy. Each is Verified by a second person.</p>
      <div className="run-form__grid">
        <div className="field">
          <label htmlFor={`${id}-eq`}>Instrument</label>
          <select id={`${id}-eq`} value={form.equipmentId} onChange={(e) => onChange({ ...form, equipmentId: e.target.value })}>
            <option value="">Choose the instrument</option>
            {lab.equipment.map((e) => (
              <option key={e.id} value={e.id}>
                {e.code} ({e.kind}), {e.fitness}
              </option>
            ))}
          </select>
          {lab.equipment.find((e) => e.id === form.equipmentId) && <FitnessTag fitness={parseFitness(lab.equipment.find((e) => e.id === form.equipmentId)?.fitness, 'as recorded on the Equipment')} />}
        </div>
        <div className="field">
          <label htmlFor={`${id}-seq`}>Sequence ID</label>
          <input id={`${id}-seq`} autoComplete="off" value={form.sequenceId} onChange={(e) => onChange({ ...form, sequenceId: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-file`}>True Copy (the printout)</label>
          <input id={`${id}-file`} type="file" accept="application/pdf,image/*" onChange={(e) => onChange({ ...form, file: e.target.files?.[0] ?? null })} />
        </div>
      </div>
    </section>
  );
}

/**
 * The Test workbench: the Analyst starts the Test, creates the typed Run and records Preparations
 * and Run Check values as they are made; a second person signs the values Verified; the Analyst
 * signs the Run and then the Test Performed. The rail offers the next act for this person, or
 * refuses it with the server's reason (rule 15).
 */
export function TestWorkbench({ testId }: { testId: string }) {
  const { active } = useSession();
  const roles = useRoles();
  const detail = useView<TestDetailDto>('test.detail', { testId });
  const runId = detail.status === 'ok' ? (detail.data.runs[0]?.id ?? null) : null;
  const run = useView<RunDetailDto>('run.detail', runId ? { runId } : null);
  const lab = useView<LabReferenceDto>('lab.reference', {});
  const start = useCommand<{ testId: string }>('test.start');
  const createRun = useCommand<{ methodVersionId: string; equipmentId: string; sequenceId: string; trueCopy: { mediaType: string; base64: string } }, { runId: string }>('run.create');
  const linkTest = useCommand<{ runId: string; testId: string }>('run.linkTest');
  const addPreparation = useCommand<{ testId: string }>('preparation.create');
  const signing = useSigning();
  const { refusal, act } = useAct();
  const [form, setForm] = useState<RunForm>({ equipmentId: '', sequenceId: '', file: null });
  const [generation, setGeneration] = useState(0);

  const reload = () => {
    detail.reload();
    run.reload();
    setGeneration((g) => g + 1);
  };

  const d = detail.status === 'ok' ? detail.data : null;
  const r = run.status === 'ok' ? run.data : null;
  const test = d?.test ?? null;
  const assignee = test?.assignedAnalyst?.username === active.person.username;
  const allValues = [...(d?.values ?? []).map((v) => ({ ...v, on: test?.label ?? 'Test' })), ...(r?.values ?? []).map((v) => ({ ...v, on: `Run ${r?.run.number ?? ''}` }))];
  const toVerify = allValues.filter((v) => !v.verified || v.pending);
  const verifierRole = roles.has('Analyst') ? 'Analyst' : roles.has('Reviewer') ? 'Reviewer' : null;

  const submitRun = async () => {
    if (!d?.test.methodVersionId || !form.file) return;
    const trueCopy = { mediaType: form.file.type || 'application/pdf', base64: await base64Of(form.file) };
    await act(createRun, { methodVersionId: d.test.methodVersionId, equipmentId: form.equipmentId, sequenceId: form.sequenceId.trim(), trueCopy }, async (made) => {
      await act(linkTest, { runId: made.runId, testId }, reload);
    });
  };

  const primary = ((): RailPrimary | null => {
    if (!test || !d) return null;
    if (assignee && test.state === 'Assigned') return { kind: 'commit', label: `Start ${test.label}`, onCommit: () => act(start, { testId }, reload) };
    if (assignee && test.state === 'InProgress' && d.runs.length === 0) {
      return form.equipmentId && form.sequenceId.trim() && form.file
        ? { kind: 'commit', label: 'Create the typed Run', onCommit: submitRun }
        : { kind: 'blocked', label: 'Create the typed Run', reason: 'Choose the instrument, type the sequence ID and attach the True Copy.' };
    }
    if (!assignee && verifierRole && toVerify.length > 0 && test.state === 'InProgress') {
      const label = `Sign ${toVerify.length} value${toVerify.length === 1 ? '' : 's'} as Verified`;
      return { kind: 'commit', label, onCommit: () => signing.open({ meaning: 'Verified', role: verifierRole, targets: toVerify.map((v) => v.valueId), attestation: null, actionLabel: label, onSigned: reload }) };
    }
    if (assignee && r && r.run.state === 'Open') {
      const label = `Sign Run ${r.run.number} as Performed`;
      const why = test.steps.find((s) => s.name === 'Run' && s.state === 'blocked');
      return why ? { kind: 'blocked', label, reason: why.reasons.join(' ') } : { kind: 'commit', label, onCommit: () => signing.open({ meaning: 'Performed', targets: [r.run.id], attestation: null, actionLabel: label, onSigned: reload }) };
    }
    if (assignee && test.state === 'InProgress') {
      const label = `Sign ${test.label} as Performed`;
      const why = blockedReasons(test.steps);
      return why ? { kind: 'blocked', label, reason: why } : { kind: 'commit', label, onCommit: () => signing.open({ meaning: 'Performed', targets: [testId], attestation: null, actionLabel: label, onSigned: reload }) };
    }
    return null;
  })();

  useRail({ context: test ? { main: test.label, sub: `${test.stateLabel}, ${test.method}` } : { main: 'Test', sub: 'Reading' }, primary });

  const editable = assignee && test?.state === 'InProgress';
  return (
    <div className="screen">
      <Reading view={detail}>
        {(dd) => (
          <>
            <TestPlate test={dd.test} />
            <Refusal text={refusal ?? signing.refusal} />
            {(dd.test.state === 'Requested' || dd.test.state === 'Accepted') && <p className="screen__note">This Test is at intake. <a href="/intake">Open Intake</a>.</p>}
            {dd.test.state === 'Ready' && <p className="screen__note">This Test is Ready to assign. <a href={`/assign?test=${dd.test.id}`}>Open Assignment</a>.</p>}
            {(dd.runs.some((x) => x.state === 'Performed') || dd.test.state === 'SubmittedForReview') && (
              <nav className="screen__note reviews-to-do" aria-label="Reviews">
                {dd.runs.filter((x) => x.state === 'Performed').map((x) => (
                  <a key={x.id} href={`/review/run/${x.id}`}>
                    Review Run {x.number}
                  </a>
                ))}
                {dd.test.state === 'SubmittedForReview' && <a href={`/review/test/${dd.test.id}`}>Review {dd.test.label}</a>}
              </nav>
            )}
            {editable && dd.runs.length === 0 && lab.status === 'ok' && <NewRun lab={lab.data} form={form} onChange={setForm} />}
            {r && <RunPanel run={r} editable={editable === true && r.run.state === 'Open'} onSaved={reload} />}
            {(editable || dd.preparations.length > 0) && (
              <section className="panel" aria-label="Preparations">
                <h2 className="h-sec">Preparations</h2>
                {dd.method && <p className="sub">{dd.method.number} v{dd.method.version} asks for {dd.method.preparationCount} Preparations. The dilution factor comes from the Method.</p>}
                <div className="preps">
                  {dd.preparations.map((p) => {
                    const v = (field: string, subject: string) => savedOf(dd.values.find((x) => x.field === field && x.subject === subject));
                    return (
                      <div key={p.id} className="prep" aria-label={`Preparation ${p.subject}`} role="group">
                        <h3 className="h-mini">Preparation {p.subject}</h3>
                        {editable ? (
                          <>
                            <RecordedValueField parent={dd.test.id} field="prep.weight" subject={p.subject} label={`${p.subject} weight`} unit="mg" role="Analyst" critical limits={[]} saved={v('prep.weight', p.subject)} onSaved={reload} />
                            <RecordedValueField parent={dd.test.id} field="prep.dilution" subject={p.subject} label={`${p.subject} dilution volume`} unit="mL" role="Analyst" critical limits={[]} saved={v('prep.dilution', p.subject)} onSaved={reload} />
                            {(dd.method?.analytes ?? []).map((a) => (
                              <RecordedValueField key={a} parent={dd.test.id} field="prep.result" subject={`${p.subject}/${a}`} label={`${p.subject} ${a} result`} unit="pg/µL" role="Analyst" critical limits={[]} saved={v('prep.result', `${p.subject}/${a}`)} onSaved={reload} />
                            ))}
                          </>
                        ) : (
                          <ul className="replist">
                            {dd.values.filter((x) => x.subject === p.subject || x.subject.startsWith(`${p.subject}/`)).map((x) => (
                              <li key={x.valueId}>
                                <span className="replist__label">{x.label}</span>
                                <span className="v-ink">
                                  {x.text} {x.unit}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
                {editable && (
                  <CommitButton tone="secondary" onCommit={() => act(addPreparation, { testId }, reload)}>
                    Add Preparation P{dd.preparations.length + 1}
                  </CommitButton>
                )}
              </section>
            )}
            <Results detail={dd} />
            {allValues.length > 0 && <ValuesToVerify values={allValues} />}
            <Signatures lines={dd.signatures} record={dd.test.label} title="Signatures on the Test" />
            <RecordAuditTrail key={`trail-${generation}`} recordId={dd.test.id} zone={active.zone} title={`Audit Trail of ${dd.test.label}`} />
          </>
        )}
      </Reading>
      {signing.sheet}
    </div>
  );
}

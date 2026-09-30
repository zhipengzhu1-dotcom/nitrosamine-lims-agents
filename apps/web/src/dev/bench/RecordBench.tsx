// Dev-only. A host for the wired Recorded Value field, the signing prompt and the inline Audit
// Trail over any record kind that carries a `prep.weight` field, until the sample chain's Test
// screens exist. The e2e run points it at the API tests' `widget` kind. It never ships: main.tsx
// registers it only under import.meta.env.DEV, and bundle.test.ts looks for BENCH_MARKER.
import type { StandingDto } from '@lims/contract';
import { useState } from 'react';
import { useView } from '../../api/hooks';
import { SignatureLine } from '../../components/Signature';
import { useSession } from '../../session/context';
import { useRail } from '../../shell/rail';
import { signaturesOf } from '../../signing/standing';
import { useSigning } from '../../signing/useSigning';
import { RecordAuditTrail } from '../../values/RecordAuditTrail';
import { RecordedValueField, type SavedValue } from '../../values/RecordedValueField';
import { BENCH_MARKER } from './marker';
import '../../screens/screens.css';

const FIELD = { field: 'prep.weight', subject: 'P1', label: 'Preparation P1 weight', unit: 'mg' } as const;

/** The bench keeps the ids it works on in the address, so a remount after a lock finds them again. */
function useAddressIds() {
  const read = () => new URLSearchParams(window.location.search);
  const [ids, setIds] = useState(() => ({ parent: read().get('parent'), value: read().get('value') }));
  const set = (next: Partial<typeof ids>) => {
    const merged = { ...ids, ...next };
    const params = new URLSearchParams(Object.entries(merged).filter((e): e is [string, string] => e[1] !== null));
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    setIds(merged);
  };
  return [ids, set] as const;
}

function Signatures({ versionId, record, lab, zone }: { versionId: string; record: string; lab: string; zone: string }) {
  const standing = useView<StandingDto>('signing.standing', { versionId });
  if (standing.status !== 'ok') return null;
  const lines = signaturesOf(standing.data, record, lab, zone);
  return (
    <section className="panel" aria-label="Signatures">
      <h2 className="h-sec">Signatures</h2>
      {lines.length === 0 ? <p className="sub">Not signed.</p> : lines.map((s) => <SignatureLine key={`${s.version.versionId}-${s.meaning}-${s.signedAt.utc}`} signature={s} />)}
    </section>
  );
}

export function RecordBench() {
  const { active } = useSession();
  const [ids, setIds] = useAddressIds();
  const [saved, setSaved] = useState<SavedValue | null>(null);
  const [generation, setGeneration] = useState(0);
  const signing = useSigning();
  const zone = active.zone;
  const lab = active.lab?.code ?? '';
  const record = `${FIELD.field} (${FIELD.subject})`;

  useRail({
    context: { main: 'Record bench', sub: ids.value ? `Value ${ids.value}` : 'No value saved yet' },
    primary: ids.value
      ? {
          kind: 'commit',
          label: `Sign ${record} as Verified`,
          onCommit: () =>
            signing.open({
              meaning: 'Verified',
              targets: [ids.value as string],
              attestation: null,
              actionLabel: `Sign ${record} as Verified`,
              onSigned: () => setGeneration((g) => g + 1),
            }),
        }
      : { kind: 'blocked', label: `Sign ${record} as Verified`, reason: 'Save the value first.' },
  });

  if (!ids.parent) {
    return (
      <div className="screen" data-marker={BENCH_MARKER}>
        <h1 className="h-screen">Record bench</h1>
        <p>Open it with ?parent=&lt;record id&gt;.</p>
      </div>
    );
  }

  return (
    <div className="screen" data-marker={BENCH_MARKER}>
      <header className="screen__head">
        <h1 className="h-screen">Record bench</h1>
        <p className="screen__lede">Dev only. Record {ids.parent}.</p>
      </header>
      <section className="panel" aria-label="Recorded Value">
        {saved || !ids.value ? (
          <RecordedValueField
            parent={ids.parent}
            {...FIELD}
            role="Analyst"
            critical
            limits={[]}
            saved={saved}
            onSaved={(s) => {
              setSaved(s);
              setIds({ value: s.valueId });
              setGeneration((g) => g + 1);
            }}
          />
        ) : (
          <p>
            {FIELD.label} was saved as value {ids.value}. Its current value is in the Audit Trail below and in the signing prompt.
          </p>
        )}
      </section>
      {signing.refusal && (
        <p className="refusal" role="alert">
          {signing.refusal}
        </p>
      )}
      {ids.value && <VersionSignatures key={generation} valueId={ids.value} record={record} lab={lab} zone={zone} />}
      {ids.value && <RecordAuditTrail key={generation} recordId={ids.value} zone={zone} title={`Audit Trail of ${record}`} />}
      {signing.sheet}
    </div>
  );
}

/** The signatures on the value's versions, read through the value's own trail of versions. */
function VersionSignatures({ valueId, record, lab, zone }: { valueId: string; record: string; lab: string; zone: string }) {
  const trail = useView<{ entries: { table: string; changes: Record<string, [unknown, unknown]> }[] }>('record.audit', { recordId: valueId });
  if (trail.status !== 'ok') return null;
  const versions = trail.data.entries.filter((e) => e.table === 'record_version').map((e) => e.changes['id']?.[1]).filter((v): v is string => typeof v === 'string');
  const latest = versions.at(-1);
  return latest ? <Signatures versionId={latest} record={record} lab={lab} zone={zone} /> : null;
}

import { useId, useRef, useState } from 'react';
import { mapNonEmpty } from '../model';
import type {
  CommitKey,
  CommitOutcome,
  Credentials,
  EligibilityAnswer,
  NonEmpty,
  Person,
  Sha256Hex,
  SignatureMeaning,
  SignedValue,
  SigningItem,
} from '../model';
import { CommitButton, useCommitKeyOnce } from './CommitButton';
import { clearSecrets, CredentialFields, emptyDraft, toCredentials, type CredentialDraft } from './CredentialFields';
import { Glyph } from './Glyph';
import { Hash } from './Hash';
import { Sheet, useSheetExit } from './Sheet';
import './signing.css';

export type SignRequest = {
  readonly commitKey: CommitKey;
  readonly credentials: Credentials;
  /** Exactly the versions and hashes the sheet showed (rule 11). */
  readonly versions: NonEmpty<{ readonly versionId: string; readonly hash: string }>;
};

export type SignaturePromptProps = {
  meaning: SignatureMeaning;
  /** The meaning's fixed statement, from the server. */
  statement: string;
  items: NonEmpty<SigningItem>;
  /** The Review a Reviewed or Released signature cites, with who made each tick (decision 13). */
  attestation?: { readonly record: string; readonly versionNo: number; readonly hash: Sha256Hex; readonly values: readonly SignedValue[] } | null;
  /** What signing will do, rendered by the server. */
  consequences: readonly string[];
  signer: Person;
  lab: string;
  workstation: string;
  eligibility: EligibilityAnswer;
  attemptsLeft: number;
  /** The server's refusal of the last attempt, if any. */
  refusal: string | null;
  /** The final button names the act, e.g. "Sign failed Check as Performed". */
  actionLabel: string;
  /** A failing record signs with a red button. */
  failing?: boolean;
  passkeyAllowed: boolean;
  commitKey: CommitKey;
  onSign: (request: SignRequest) => Promise<CommitOutcome>;
  /** Called once the sheet has finished closing; the owner unmounts it then. */
  onClosed: () => void;
};

function ValueList({ values }: { values: readonly SignedValue[] }) {
  if (values.length === 0) return null;
  return (
    <ul className="replist">
      {values.map((v, i) => (
        <li key={`${i}-${v.label}`}>
          <span className="replist__label">
            {v.label}
            {v.by && <span className="sub">by {v.by}</span>}
          </span>
          <span className={v.draft ? 'v-draft' : 'v-ink'}>
            {v.value}
            {v.unit && ` ${v.unit}`}
            {v.draft && <span className="sr-only"> (draft)</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The signature prompt (decision 23): what is being signed first, then who is signing with the
 * server's eligibility answer before any credential is asked for (rule 5), then the typed user ID,
 * password and second factor. It carries the commit key it was given and sends each key at most
 * once; a press while the sheet closes does nothing (rule 25).
 */
export function SignaturePrompt(props: SignaturePromptProps) {
  const [draft, setDraft] = useState<CredentialDraft>(emptyDraft);
  const { leaving, close } = useSheetExit(props.onClosed);
  const key = useCommitKeyOnce(props.commitKey);
  const signRef = useRef<HTMLDivElement>(null);
  const credentials = toCredentials(draft);
  const eligible = props.eligibility.eligible;

  const sign = async () => {
    if (leaving || !credentials || !eligible || !key.spend()) return;
    const outcome = await props.onSign({
      commitKey: props.commitKey,
      credentials,
      versions: mapNonEmpty(props.items, (i) => ({ versionId: i.version.versionId, hash: i.version.hash })),
    });
    setDraft(clearSecrets);
    if (outcome === 'done') close();
  };

  const lowAttempts = props.attemptsLeft <= 2;
  const id = useId();

  return (
    <Sheet
      title={
        <>
          <Glyph name="sig" size={22} />
          Sign as {props.meaning}
        </>
      }
      leaving={leaving}
      onEscape={close}
      footer={
        <>
          <div className="sheet__rail-who">
            <b>{props.signer.printedName}</b>
            <span>
              {props.signer.role}, {props.workstation}
            </span>
          </div>
          {eligible && (
            <div className={`sheet__rail-answer${props.refusal ? ' is-refused' : ''}`}>
              {props.refusal && (
                <p className="sheet__rail-refusal" role="alert">
                  <Glyph name="fail" size={18} />
                  <span>{props.refusal} Nothing has been signed.</span>
                </p>
              )}
              <p className={`attempts${lowAttempts ? ' attempts--low' : ''}`}>
                <Glyph name="key" size={16} />
                {props.attemptsLeft === 1 ? '1 attempt' : `${props.attemptsLeft} attempts`} left before this account locks.
              </p>
            </div>
          )}
          <button type="button" className="rbtn rbtn--secondary" onClick={close}>
            Cancel
          </button>
          {eligible && (
            <div ref={signRef} className="signing__commit">
              <CommitButton
                tone={props.failing ? 'danger' : 'primary'}
                className="rbtn--commit"
                disabled={leaving || !credentials || key.spent}
                onCommit={sign}
              >
                <Glyph name="sig" size={20} />
                {props.actionLabel}
              </CommitButton>
            </div>
          )}
        </>
      }
    >
      <div className="signing">
        <div className="signing__what">
          <section className="manifest" aria-labelledby={`${id}-what`}>
            <h3 className="manifest__h" id={`${id}-what`}>
              What you are signing
            </h3>
            {props.items.map((item) => (
              <div className="manifest__item" key={item.version.versionId}>
                <dl className="manifest__id">
                  <div>
                    <dt>Record</dt>
                    <dd>{item.version.record}</dd>
                  </div>
                  <div>
                    <dt>Record Version</dt>
                    <dd className="manifest__ver">{item.version.versionNo}</dd>
                  </div>
                  <div className="manifest__hash">
                    <dt>SHA-256 of this version</dt>
                    <dd>
                      <Hash value={item.version.hash} />
                    </dd>
                  </div>
                </dl>
                <ValueList values={item.values} />
                {item.sourceFiles.map((f) => (
                  <p className="manifest__line" key={f.name}>
                    <Glyph name="file" size={16} />
                    <span>
                      <span className="mono">{f.name}</span>
                      {f.sha256 && (
                        <span className="sub">
                          SHA-256 <Hash value={f.sha256} />
                        </span>
                      )}
                    </span>
                  </p>
                ))}
              </div>
            ))}
            {props.attestation && (
              <section className="manifest__item manifest__attest" aria-label="The Review you attest">
                <h4 className="h-mini">The Review you attest</h4>
                <p className="manifest__line">
                  {props.attestation.record}, Record Version {props.attestation.versionNo}
                </p>
                <p className="manifest__line">
                  SHA-256 <Hash value={props.attestation.hash} />
                </p>
                <ValueList values={props.attestation.values} />
              </section>
            )}
            <p className="manifest__note">The server computed each hash from exactly the content listed. Your signature binds to it.</p>
          </section>
          {props.consequences.length > 0 && (
            <section className="effects" aria-labelledby={`${id}-effects`}>
              <h3 className="manifest__h" id={`${id}-effects`}>
                What signing will do
              </h3>
              <ul className={`effects__list${props.failing ? ' effects__list--bad' : ''}`}>
                {props.consequences.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <section className="signing__who" aria-labelledby={`${id}-who`}>
          <h3 className="manifest__h" id={`${id}-who`}>
            Who is signing
          </h3>
          <div className="signer">
            <div className="signer__name">
              {props.signer.printedName}
              {props.signer.nativeName && <span className="signer__native">{props.signer.nativeName}</span>}
            </div>
            <div className="signer__meta">
              <span className="mono">{props.signer.username}</span>, {props.signer.role}, {props.lab}, on {props.workstation}
            </div>
          </div>
          <div className="meaning">
            <span className="meaning__label">Signature Meaning</span>
            <span className="meaning__word">
              <Glyph name="sig" size={22} />
              {props.meaning}
            </span>
            <p className="meaning__statement">{props.statement}</p>
          </div>
          {props.eligibility.eligible ? (
            <>
              <dl className="eligibility">
                {props.eligibility.authorisation && (
                  <>
                    <dt>Authorisation</dt>
                    <dd>
                      {props.eligibility.authorisation.meaning} for {props.eligibility.authorisation.scope}, valid until{' '}
                      {props.eligibility.authorisation.validUntil}
                    </dd>
                  </>
                )}
                {props.eligibility.trainingRecord && (
                  <>
                    <dt>Training Record</dt>
                    <dd>
                      {props.eligibility.trainingRecord.document}, version {props.eligibility.trainingRecord.version}
                    </dd>
                  </>
                )}
              </dl>
              <CredentialFields
                draft={draft}
                onChange={setDraft}
                passkeyAllowed={props.passkeyAllowed}
                surface="sheet"
                onDone={() => signRef.current?.querySelector('button')?.focus()}
              />
            </>
          ) : (
            <p className="refusal" role="alert">
              <Glyph name="noentry" size={18} />
              <span>
                {props.signer.printedName} cannot sign this as {props.meaning}. {props.eligibility.reason}
              </span>
            </p>
          )}
        </section>
      </div>
    </Sheet>
  );
}

import { useId, useState } from 'react';
import type { Signature, SignatureStanding } from '../model';
import { labTime, shortLabTime } from '../time';
import { Glyph } from './Glyph';
import { Hash } from './Hash';
import './signature.css';

const FAILED: Record<Exclude<SignatureStanding, 'stands'>, string> = {
  'changed-after-signature': 'UNSIGNED — changed after signature',
  invalid: 'SIGNATURE INVALID',
};

/**
 * The full manifestation of one Electronic Signature (decision 13, rule 11). Signature blue is kept
 * for a signature that stands; the two failure states replace it with their words.
 */
export function SignatureBlock({ signature }: { signature: Signature }) {
  const { signer, version } = signature;
  const t = labTime(signature.signedAt, { seconds: true });
  const stands = signature.standing === 'stands';
  return (
    <section className={`sig ${stands ? 'sig--stands' : 'sig--failed'}`} aria-label={`${signature.meaning} signature`}>
      <header className="sig__head">
        {stands ? (
          <>
            <Glyph name="sig" size={20} />
            <span className="sig__meaning">{signature.meaning}</span>
            <span className="sig__kind">Electronic Signature</span>
          </>
        ) : (
          <>
            <Glyph name={signature.standing === 'invalid' ? 'fail' : 'dev'} size={20} />
            <span className="sig__meaning">{FAILED[signature.standing]}</span>
          </>
        )}
      </header>
      {!stands && (
        <p className="sig__failed-note">
          {signature.standing === 'invalid'
            ? `This ${signature.meaning} signature does not verify against the record version it names.`
            : `${version.record} changed after it was signed ${signature.meaning}. The signature below applied to Record Version ${version.versionNo} only.`}
        </p>
      )}
      <p className="sig__statement">{signature.statement}</p>
      <dl className="sig__grid">
        <dt>Signed by</dt>
        <dd>
          {signer.printedName}
          {signer.nativeName && <span className="sig__native"> {signer.nativeName}</span>}
        </dd>
        <dt>Username</dt>
        <dd className="mono">{signer.username}</dd>
        <dt>Role</dt>
        <dd>{signer.role}</dd>
        <dt>Lab</dt>
        <dd>{signature.lab}</dd>
        {signature.workstation && (
          <>
            <dt>Workstation</dt>
            <dd>{signature.workstation}</dd>
          </>
        )}
        <dt>Lab time</dt>
        <dd>
          {t.date} {t.time} {t.zone}
        </dd>
        <dt>UTC</dt>
        <dd>
          {t.utcDate} {t.utcTime} UTC
        </dd>
        <dt>Record</dt>
        <dd>
          {version.record}, Record Version {version.versionNo}
        </dd>
        <dt>Version ID</dt>
        <dd className="mono">{version.versionId}</dd>
        <dt>SHA-256</dt>
        <dd>
          <Hash value={version.hash} />
        </dd>
      </dl>
    </section>
  );
}

/**
 * Every screen that shows a signature uses this line: meaning, full name, username, role and
 * lab-local time with the zone. Pressing it opens the full SignatureBlock; nothing lives in a
 * hover title (rule 10).
 */
export function SignatureLine({ signature }: { signature: Signature }) {
  const [open, setOpen] = useState(false);
  const blockId = useId();
  const { signer } = signature;
  const stands = signature.standing === 'stands';
  return (
    <div className="sigline-wrap">
      <button
        type="button"
        className={`sigline ${stands ? 'sigline--stands' : 'sigline--failed'}`}
        aria-expanded={open}
        aria-controls={blockId}
        onClick={() => setOpen((o) => !o)}
      >
        <Glyph name={stands ? 'sig' : signature.standing === 'invalid' ? 'fail' : 'dev'} size={16} />
        <span className="sigline__meaning">{stands ? signature.meaning : FAILED[signature.standing]}</span>
        <span className="sigline__who">
          {stands ? '' : `was ${signature.meaning} by `}
          {signer.printedName} <span className="mono">{signer.username}</span>, {signer.role}
        </span>
        <span className="sigline__at">{shortLabTime(signature.signedAt)}</span>
        <span className="sigline__at">{labTime(signature.signedAt).date}</span>
      </button>
      <div id={blockId} hidden={!open}>
        {open && <SignatureBlock signature={signature} />}
      </div>
    </div>
  );
}

import { useId, useMemo, useState, type ReactNode } from 'react';
import qrcode from 'qrcode-generator';
import { PASSWORD_RULES } from '@lims/contract/session';
import { useCommand } from '../api/hooks';
import { CommitButton } from '../components/CommitButton';
import { Glyph } from '../components/Glyph';
import '../components/shell.css';
import '../components/credentials.css';
import './enrol.css';

/** The otpauth URI drawn as a QR code in the browser; the URI never leaves this page's memory. */
export function OtpauthQr({ uri }: { uri: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(uri);
    qr.make();
    const n = qr.getModuleCount();
    const cells: string[] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) cells.push(`M${c + 4} ${r + 4}h1v1h-1z`);
    return { size: n + 8, path: cells.join('') };
  }, [uri]);
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="QR code for your authenticator app" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

type Started = { readonly username: string; readonly printedName: string; readonly otpauthUri: string };

const tokenFromHash = (hash: string): string | null => {
  const t = hash.replace(/^#/, '');
  return t.length >= 16 ? t : null;
};

/**
 * The one-time enrolment link (decision 13 §3). The person shows the QR code, scans it with their
 * own authenticator app, sets a password to the rules and confirms with the code the app shows.
 * No code, secret or password is ever filled in or printed here (rule 2).
 */
export function Enrol({ hash }: { hash: string }) {
  const id = useId();
  const token = tokenFromHash(hash);
  const start = useCommand<{ token: string }, { username: string; printedName: string }>('identity.enrolStart');
  const finish = useCommand<{ token: string; password: string; totp: string }, { username: string }>('identity.enrolFinish');
  const [started, setStarted] = useState<Started | null>(null);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [code, setCode] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!token) {
    return (
      <EnrolFrame>
        <h1 className="h-screen">This enrolment link is incomplete</h1>
        <p>Open the whole link the Admin gave you, or ask the Admin for a new one.</p>
      </EnrolFrame>
    );
  }

  const showCode = async () => {
    const out = await start.run({ token });
    if (out.kind !== 'receipt') return setRefusal(out.kind === 'refusal' ? out.refusal.message : out.message);
    const uri = (out.once as { otpauthUri?: string } | null)?.otpauthUri;
    if (!uri) return setRefusal('The server sent no code to scan. Ask the Admin for a new link.');
    setRefusal(null);
    setStarted({ ...out.data, otpauthUri: uri });
  };

  const complete = async () => {
    const out = await finish.run({ token, password, totp: code });
    setPassword('');
    setAgain('');
    setCode('');
    if (out.kind !== 'receipt') return setRefusal(out.kind === 'refusal' ? out.refusal.message : out.message);
    setRefusal(null);
    setStarted(null);
    setDone(out.summary);
  };

  if (done) {
    return (
      <EnrolFrame>
        <h1 className="h-screen">
          <Glyph name="check" size={24} /> Your account is ready
        </h1>
        <p>{done}</p>
        <a className="rbtn rbtn--primary enrol__go" href="/">
          Go to sign-in
        </a>
      </EnrolFrame>
    );
  }

  const mismatch = again !== '' && again !== password;
  const ready = password !== '' && again === password && /^\d{6}$/.test(code);

  return (
    <EnrolFrame>
      <h1 className="h-screen">Set up your account</h1>
      {!started ? (
        <>
          <p>This link works once. Have your authenticator app (Microsoft Authenticator, Duo or similar) ready on your phone, then show the code to scan.</p>
          <div className="enrol__actions">
            <CommitButton onCommit={showCode}>Show the code to scan</CommitButton>
          </div>
        </>
      ) : (
        <div className="enrol__steps">
          <section className="panel enrol__step" aria-labelledby={`${id}-scan`}>
            <h2 className="h-sec" id={`${id}-scan`}>
              1. Scan this code with your authenticator app
            </h2>
            <p>
              It adds <b>{started.username}</b> for {started.printedName}. Only you should see it: it is shown once and is not kept here.
            </p>
            <OtpauthQr uri={started.otpauthUri} />
          </section>
          <section className="panel enrol__step" aria-labelledby={`${id}-password`}>
            <h2 className="h-sec" id={`${id}-password`}>
              2. Choose your password
            </h2>
            <ul className="enrol__rules">
              {PASSWORD_RULES.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <div className="field">
              <label htmlFor={`${id}-pw`}>Password</label>
              <input id={`${id}-pw`} type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${id}-pw2`}>Type it again</label>
              <input id={`${id}-pw2`} type="password" autoComplete="off" value={again} onChange={(e) => setAgain(e.target.value)} aria-invalid={mismatch || undefined} />
              {mismatch && <span className="field__hint enrol__mismatch">The two passwords differ.</span>}
            </div>
          </section>
          <section className="panel enrol__step" aria-labelledby={`${id}-confirm`}>
            <h2 className="h-sec" id={`${id}-confirm`}>
              3. Confirm with the code your app shows now
            </h2>
            <div className="field field--code">
              <label htmlFor={`${id}-code`}>Code</label>
              <input id={`${id}-code`} inputMode="numeric" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
            </div>
            <div className="enrol__actions">
              <CommitButton disabled={!ready} onCommit={complete}>
                Finish setting up
              </CommitButton>
            </div>
          </section>
        </div>
      )}
      {refusal && (
        <p className="refusal" role="alert">
          <Glyph name="fail" size={18} />
          <span>{refusal}</span>
        </p>
      )}
    </EnrolFrame>
  );
}

function EnrolFrame({ children }: { children: ReactNode }) {
  return (
    <div className="enrol">
      <header className="enrol__bar">
        <span className="brand__mark" aria-hidden="true">
          RD
        </span>
        <span className="brand__name">Nitrosamine LIMS</span>
        <span className="fict">Fictional data</span>
      </header>
      <main className="enrol__main">{children}</main>
    </div>
  );
}

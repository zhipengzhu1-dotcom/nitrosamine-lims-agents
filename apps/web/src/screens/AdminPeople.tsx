import { useId, useState } from 'react';
import { STAFF_ROLES } from '@lims/contract';
import type { LabDto } from '@lims/contract';
import { useCommand, useView } from '../api/hooks';
import { Glyph } from '../components/Glyph';
import { labTime } from '../time';
import { useSession } from '../session/context';
import { roleLabel } from '../session/store';
import { useRail, useRailControl } from '../shell/rail';
import './screens.css';

type Grant = { readonly role: (typeof STAFF_ROLES)[number]; readonly lab: string } | { readonly role: 'Admin' };

type Created = { readonly personId: string; readonly username: string; readonly expiresAt: string };

type Handover = { readonly printedName: string; readonly username: string; readonly link: string; readonly expiresAt: string };

const USERNAME = /^[a-z][a-z0-9._-]{1,31}$/;

/** The link carries its token in the fragment, which the browser never sends to a server or a log. */
export const enrolmentLink = (origin: string, token: string): string => `${origin}/enrol#${token}`;

/**
 * The Admin creates a person with their role grants and hands over a one-time enrolment link
 * (decision 13 §3). The Admin never sees the password or the authenticator secret: the person sets
 * both through the link. The link is shown once, as the server delivers it once.
 */
export function AdminPeople() {
  const id = useId();
  const { active } = useSession();
  const { showReceipt } = useRailControl();
  const labs = useView<{ labs: LabDto[] }>('admin.labs', {});
  const create = useCommand<{ printedName: string; nativeName: string | null; username: string; grants: Grant[] }, Created>('identity.createPerson');
  const [printedName, setPrintedName] = useState('');
  const [nativeName, setNativeName] = useState('');
  const [username, setUsername] = useState('');
  const [roles, setRoles] = useState<ReadonlySet<string>>(new Set());
  const [lab, setLab] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [handover, setHandover] = useState<Handover | null>(null);

  const staffRoles = STAFF_ROLES.filter((r) => roles.has(r));
  const grants: Grant[] = roles.has('Admin') ? [{ role: 'Admin' }] : staffRoles.map((role) => ({ role, lab: lab.trim() }));
  const missing = [
    printedName.trim() === '' && 'the printed name',
    !USERNAME.test(username) && 'a user ID of 2 to 32 lower-case letters, digits, dots, dashes or underscores, starting with a letter',
    grants.length === 0 && 'at least one role',
    staffRoles.length > 0 && lab.trim() === '' && 'the Lab the roles are held in',
  ].filter((m): m is string => typeof m === 'string');

  const toggle = (role: string) =>
    setRoles((held) => {
      const next = new Set(held);
      if (next.has(role)) next.delete(role);
      // Admin is never combined with a business role (decision 13, LI001).
      else if (role === 'Admin') return new Set(['Admin']);
      else {
        next.delete('Admin');
        next.add(role);
      }
      return next;
    });

  const submit = async () => {
    const out = await create.run({ printedName: printedName.trim(), nativeName: nativeName.trim() === '' ? null : nativeName.trim(), username, grants });
    if (out.kind !== 'receipt') {
      setRefusal(out.kind === 'refusal' ? out.refusal.message : out.message);
      return;
    }
    setRefusal(null);
    showReceipt({ summary: out.summary, at: { utc: out.at, zone: active.zone }, kind: 'audited' });
    const token = (out.once as { enrolmentToken?: string } | null)?.enrolmentToken;
    setHandover(token ? { printedName: printedName.trim(), username: out.data.username, link: enrolmentLink(window.location.origin, token), expiresAt: out.data.expiresAt } : null);
    setPrintedName('');
    setNativeName('');
    setUsername('');
    setRoles(new Set());
  };

  useRail({
    context: { main: 'New person', sub: 'Role grants and a one-time enrolment link' },
    primary: missing.length === 0 ? { kind: 'commit', label: 'Create person and enrolment link', onCommit: submit } : { kind: 'blocked', label: 'Create person and enrolment link', reason: `Still needed: ${missing.join('; ')}.` },
  });

  return (
    <div className="screen">
      <header className="screen__head">
        <h1 className="h-screen">People</h1>
        <p className="screen__lede">Create a person with their roles. They set their own password and authenticator through the one-time link you hand them.</p>
      </header>
      {handover && (
        <section className="panel handover" aria-label="Enrolment link">
          <h2 className="h-sec">
            <Glyph name="key" size={18} />
            Enrolment link for {handover.printedName} ({handover.username})
          </h2>
          <p>
            Hand this link to {handover.printedName} yourself. It works once and expires at {labTime({ utc: handover.expiresAt, zone: active.zone }).time}{' '}
            {labTime({ utc: handover.expiresAt, zone: active.zone }).zone} on {labTime({ utc: handover.expiresAt, zone: active.zone }).date}. It is not shown again.
          </p>
          <p className="handover__link mono">{handover.link}</p>
          <button type="button" className="rbtn rbtn--secondary" onClick={() => void navigator.clipboard?.writeText(handover.link)}>
            Copy the link
          </button>
        </section>
      )}
      <section className="panel person-form" aria-labelledby={`${id}-new`}>
        <h2 className="h-sec" id={`${id}-new`}>
          New person
        </h2>
        <div className="person-form__grid">
          <div className="field">
            <label htmlFor={`${id}-name`}>Printed name</label>
            <input id={`${id}-name`} autoComplete="off" value={printedName} onChange={(e) => setPrintedName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-native`}>Name in native script (optional)</label>
            <input id={`${id}-native`} autoComplete="off" value={nativeName} onChange={(e) => setNativeName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-user`}>User ID</label>
            <input id={`${id}-user`} autoComplete="off" autoCapitalize="off" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} />
            <span className="field__hint">Never reused, even after the person leaves.</span>
          </div>
        </div>
        <fieldset className="roles">
          <legend>Roles</legend>
          {[...STAFF_ROLES, 'Admin'].map((role) => (
            <label key={role} className="roles__opt">
              <input type="checkbox" checked={roles.has(role)} onChange={() => toggle(role)} />
              {roleLabel(role)}
            </label>
          ))}
          <p className="field__hint">The Admin role is never combined with a Lab role.</p>
        </fieldset>
        {staffRoles.length > 0 && (
          <div className="field person-form__lab">
            <label htmlFor={`${id}-lab`}>Lab</label>
            <select id={`${id}-lab`} value={lab} onChange={(e) => setLab(e.target.value)}>
              <option value="">Choose the Lab</option>
              {labs.status === 'ok' &&
                labs.data.labs.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} ({l.zone})
                  </option>
                ))}
            </select>
            <span className="field__hint">{labs.status === 'ok' || labs.status === 'loading' ? 'The Lab the roles are held in.' : labs.status === 'refused' ? labs.refusal.message : labs.message}</span>
          </div>
        )}
        {refusal && (
          <p className="refusal" role="alert">
            <Glyph name="fail" size={18} />
            <span>{refusal} Nobody was created.</span>
          </p>
        )}
      </section>
    </div>
  );
}

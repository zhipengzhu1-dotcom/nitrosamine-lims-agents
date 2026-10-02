import {
  type ActorContext,
  grantableRoles,
  type IdentityVerification,
  type Instant,
  routes,
  type StaffPerson,
} from '@lims/domain';
import { useState } from 'react';
import { api, useApi, useFresh } from './api.ts';
import { field, useCommit } from './form.tsx';
import { Shell, words } from './rail.tsx';
import { time } from './time.ts';

function RecordVerification({ onDone }: { onDone: () => Promise<void> }) {
  const { busy, commit, shown } = useCommit();
  return (
    <form
      className="card"
      onSubmit={(e) =>
        commit(e, async (form) => {
          const verification = await api(routes.recordIdentityVerification, {
            printedName: field(form, 'printedName'),
            evidence: field(form, 'evidence'),
          });
          await onDone();
          return `Identity Verification of ${verification.printedName} recorded at ${time(verification.checkedAt)}.`;
        })
      }
    >
      <h2>Record an Identity Verification</h2>
      <label>
        Printed name
        <input name="printedName" required maxLength={200} autoComplete="off" />
      </label>
      <label>
        What was checked
        <input name="evidence" required maxLength={200} autoComplete="off" />
      </label>
      {shown}
      <button type="submit" className="btn" disabled={busy}>
        Record the Identity Verification
      </button>
    </form>
  );
}

interface Link {
  printedName: string;
  token: string;
  expiresAt: Instant;
}

function CreateAccount({
  verification,
  onCreated,
}: {
  verification: IdentityVerification;
  onCreated: (link: Link) => Promise<void>;
}) {
  const { busy, commit, shown } = useCommit();
  return (
    <form
      className="card"
      aria-label={`Account for ${verification.printedName}`}
      onSubmit={(e) =>
        commit(e, async (form) => {
          const { person, link } = await api(routes.createAccount, {
            identityVerificationId: verification.id,
            username: field(form, 'username'),
          });
          await onCreated({ printedName: person.printedName, ...link });
          return `Account ${person.username} created.`;
        })
      }
    >
      <p>
        <b>{verification.printedName}</b>
        <br />
        <span className="muted">
          {verification.evidence}, checked by {verification.checkedBy} at {time(verification.checkedAt)}
        </span>
      </p>
      <label>
        Username
        <input name="username" required pattern="[a-z][a-z0-9.\-]{2,39}" autoComplete="off" autoCapitalize="none" />
      </label>
      {shown}
      <button type="submit" className="btn" disabled={busy}>
        Create the account
      </button>
    </form>
  );
}

function PersonChoice({ people }: { people: readonly StaffPerson[] }) {
  return (
    <label>
      Person
      <select name="personId" required defaultValue="">
        <option value="" disabled>
          Choose a person
        </option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.printedName} ({p.username})
          </option>
        ))}
      </select>
    </label>
  );
}

const isGrantable = (role: string): role is (typeof grantableRoles)[number] => grantableRoles.some((r) => r === role);

function GrantMembership({
  me,
  people,
  onDone,
}: {
  me: ActorContext;
  people: readonly StaffPerson[];
  onDone: () => Promise<void>;
}) {
  const { busy, commit, shown } = useCommit();
  return (
    <form
      className="card"
      onSubmit={(e) =>
        commit(e, async (form) => {
          const role = field(form, 'role');
          if (!isGrantable(role)) throw new Error('choose a role');
          const person = await api(routes.grantMembership, {
            personId: field(form, 'personId'),
            role,
            reason: field(form, 'reason'),
          });
          await onDone();
          return `${person.printedName} holds ${words(role)} in ${me.lab.name}.`;
        })
      }
    >
      <h2>Grant a Membership in {me.lab.name}</h2>
      <PersonChoice people={people} />
      <label>
        Role
        <select name="role" required defaultValue="">
          <option value="" disabled>
            Choose a role
          </option>
          {grantableRoles.map((r) => (
            <option key={r} value={r}>
              {words(r)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Reason
        <input name="reason" required maxLength={200} autoComplete="off" />
      </label>
      {shown}
      <button type="submit" className="btn" disabled={busy}>
        Grant
      </button>
    </form>
  );
}

function ChangePrintedName({ people, onDone }: { people: readonly StaffPerson[]; onDone: () => Promise<void> }) {
  const { busy, commit, shown } = useCommit();
  return (
    <form
      className="card"
      onSubmit={(e) =>
        commit(e, async (form) => {
          const person = await api(routes.changePrintedName, {
            personId: field(form, 'personId'),
            printedName: field(form, 'printedName'),
            reason: field(form, 'reason'),
          });
          await onDone();
          return `${person.username} now prints as ${person.printedName}. Earlier Signatures keep the name as signed.`;
        })
      }
    >
      <h2>Change a printed name</h2>
      <PersonChoice people={people} />
      <label>
        New printed name
        <input name="printedName" required maxLength={200} autoComplete="off" />
      </label>
      <label>
        Reason
        <input name="reason" required maxLength={200} autoComplete="off" />
      </label>
      {shown}
      <button type="submit" className="btn" disabled={busy}>
        Change the printed name
      </button>
    </form>
  );
}

/** For an account whose person has not set a password yet: a fresh one-time link, which replaces the earlier one. */
function NewLink({ person, onIssued }: { person: StaffPerson; onIssued: (link: Link) => void }) {
  const { busy, commit, shown } = useCommit();
  return (
    <form
      aria-label={`New one-time link for ${person.printedName}`}
      onSubmit={(e) =>
        commit(e, async () => {
          const { link } = await api(routes.issueLink, { personId: person.id });
          onIssued({ printedName: person.printedName, ...link });
          return 'Not set yet; a new link is shown above.';
        })
      }
    >
      {shown ?? 'Not set yet'}
      <button type="submit" className="btn btn--small" disabled={busy}>
        New one-time link
      </button>
    </form>
  );
}

export function StaffPage({ me }: { me: ActorContext }) {
  const { data, error, reload } = useApi(routes.staff);
  const fresh = useFresh(data, (d) => d.people.map((p) => `${p.id}:${p.roles.join()}:${p.printedName}`));
  const [link, setLink] = useState<Link | null>(null);
  const linkUrl = link && `${location.origin}${location.pathname}#/welcome/${link.token}`;
  return (
    <Shell me={me} active="staff" action={null}>
      {/* The next press anywhere on the page takes the one-time link off the screen. */}
      <div onSubmitCapture={() => setLink(null)}>
        <h1>Staff accounts</h1>
        {error && <p className="note--bad">{error}</p>}
        <RecordVerification onDone={reload} />
        {link && (
          <section className="card" aria-label="One-time link">
            <h2>One-time link for {link.printedName}</h2>
            <p>
              Give this link to {link.printedName} in person. They choose their own password with it. It works once and
              expires at {time(link.expiresAt)}; the LIMS keeps no copy of it.
            </p>
            <p className="long">
              <code>{linkUrl}</code>
            </p>
            <button type="button" className="btn" onClick={() => setLink(null)}>
              Done
            </button>
          </section>
        )}
        {data && data.awaitingAccount.length > 0 && (
          <section>
            <h2>Identity verified, awaiting an account</h2>
            {data.awaitingAccount.map((verification) => (
              <CreateAccount
                key={verification.id}
                verification={verification}
                onCreated={async (created) => {
                  await reload();
                  setLink(created);
                }}
              />
            ))}
          </section>
        )}
        <h2>Staff in {me.lab.name}</h2>
        <div className="wide">
          <table className="stack">
            <thead>
              <tr>
                <th>Printed name</th>
                <th>Username</th>
                <th>Roles</th>
                <th>Password</th>
                <th>Identity verified</th>
              </tr>
            </thead>
            <tbody>
              {data?.people.map((p) => (
                <tr
                  key={p.id}
                  className={fresh.has(`${p.id}:${p.roles.join()}:${p.printedName}`) ? 'row--fresh' : undefined}
                >
                  <td data-label="Printed name">{p.printedName}</td>
                  <td data-label="Username">
                    <code>{p.username}</code>
                  </td>
                  <td data-label="Roles">{p.roles.map(words).join(', ') || 'No Membership yet'}</td>
                  <td data-label="Password">{p.credentialSet ? 'Set' : <NewLink person={p} onIssued={setLink} />}</td>
                  <td data-label="Identity verified">
                    {p.identityVerifiedAt
                      ? `${time(p.identityVerifiedAt)} by ${p.identityVerifiedBy}: ${p.identityEvidence}`
                      : 'Not recorded (seeded demo account)'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && <GrantMembership me={me} people={data.people} onDone={reload} />}
        {data && <ChangePrintedName people={data.people} onDone={reload} />}
      </div>
    </Shell>
  );
}

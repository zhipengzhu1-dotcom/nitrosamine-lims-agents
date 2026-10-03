# Staff accounts

The Admin records an Identity Verification (printed name and what was checked), creates the account on it with a username, and gets a one-time link to hand to the person. The person opens the link without a session and chooses their own password. The Admin then grants Memberships in the session's Lab, each with a reason, and may change a printed name with a reason. Granting a business role to an Admin, or Admin to a holder of a business role, is refused.

## Sub-features

- Record an Identity Verification. It lists under "Checked, awaiting an account" until an account names it.
- Create the account. The region `One-time link` shows the link once; the staff table shows `No Membership yet` and `Not set yet`.
- Set a password through the one-time link at `#/welcome/<token>`. A second use is refused.
- Issue an enrolment link (`Enrolment link` in the `Authenticator` column) as a second Admin: the region `Enrolment link` shows it once as `#/authenticator?grant=<token>`. The Admin who created the account or issued its one-time link is refused by the database.
- Enrol the authenticator through the enrolment link with the person's own password, in a browser where no one else is signed in. A spent, expired or missing grant is the uniform credential refusal.
- Grant a Membership with a reason. The Admin-apart refusal shows in the form's `role=alert`.
- Change a printed name with a reason. Earlier Signatures keep the name as signed.

## How to get to it (user POV)

Sign in as `ada.admin`, then follow `Staff` in the nav. Only an Admin sees that link. The link page needs no sign-in.

## Driving it with drive.ts

Preconditions: a fresh instance; nothing else.

- Scope each form by its heading: `Record an Identity Verification`, `Grant a Membership in ...`, `Change a printed name`. The account form is `role=form` named `Account for <printed name>`.
- Use `getByLabel('Printed name', { exact: true })`, because `New printed name` also matches.
- Each form answers in its own `role=status` (accepted) or `role=alert` (refused).
- Read the link from `region 'One-time link'` `code`, clear cookies, and `page.goto` it.
- Second view: `v.sql()` on `lims.identity_verification`, `lims.person`, `lims.membership`, `lims.credential_link` (`used_at`) and `lims.access_event` (`PasswordSet`), plus the `lims.audit_entry` rows with the Admin's reason.

## Gotchas

- The page shows each form's answer after the server replies; a refused grant adds no Membership row and no Audit Trail entry.
- `page.goto` to a link that differs only in the hash does not reload; reload before a second use.
- A Customer User is not listed: Customer accounts are portal accounts.

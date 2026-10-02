# Sign in and out

A person picks a Lab (none is preselected), signs in with a username and password, and lands on the Tests worklist of that Lab. The rail shows their name and role. Bad credentials are refused on the sign-in card, and signing out returns to the card. A reload keeps the session, because the API holds it in a cookie.

## Sub-features

- `signin-ok` signs in and shows the `Tests` worklist with the person's name in the rail.
- `signin-refused` refuses a wrong password with `The user ID or password is not valid.` in `role=alert`.
- `signin-session` keeps the person signed in across a reload.
- `signout` ends the session and shows the `Sign in` heading.
- `lab-choice` lists the seeded Labs `QC` and `RD` with no radio checked; a sign-in without a Lab cannot be sent, and the API answers one with `labNotChosen`.
- `lab-switch` moves `lena.manager` or `rui.reviewer` (the two people in both Labs) to the other Lab from the rail's `Switch Lab` after their username and password, and the rail then reads `QC · ...`.
- `lockout` locks an account after 20 wrong passwords in a row; the next attempt is refused with `This account is locked.`, even with the right password.

## How to get to it (user POV)

- Open the web root. With no session, every route shows the sign-in card.
- Sign in as the same account with a wrong password 20 times to reach the lock.
- Press `Sign out` in the rail from any signed-in screen.

## Driving it with drive.ts

Preconditions:

- doctor.sh is all `ok:`.

- **Refused.** Check the radio `R&D Laboratory`, fill `Username` with `ana.analyst` and `Password` with `wrong`, then press `Sign in`. `role=alert` reads `The user ID or password is not valid.`, and `steps.log` shows `POST /api/login -> 401`. `select failed_logins from lims.person where username = 'ana.analyst'` reads `1`, and the newest `lims.audit_entry` row is `person` with reason `Failed authentication`.
- **Signed in.** Run `await v.signIn('ana.analyst')`. The heading `Tests` is visible, and the rail shows `Ana Ferreira` with `Analyst · ana.analyst`. `failed_logins` is back to `0`.
- **Session.** Run `await page.reload()`. The heading `Tests` is still there, and `GET /api/me -> 200`.
- **Lab switch.** Run `await v.signIn('lena.manager')`, press `Switch Lab` in the rail, check `QC Laboratory`, fill `Username` and `Password`, and press the form's `Switch Lab`. The rail reads `QC · Lab Manager`. `select kind, previous_session_id is not null from lims.access_event order by at desc limit 1` reads `LabSwitch|t`.
- **Signed out.** Run `await v.signOut()`. The heading `Sign in` is visible. A later `page.reload()` still shows the sign-in card, and `GET /api/me -> 401`.
- **Locked.** Sign in as `ada.admin` with `wrong` 20 times, then with the right password. `role=alert` reads `This account is locked.` (HTTP 423).
- **Proof.** Query `select s.ended_at from lims.session s join lims.person p on p.id = s.person_id where p.username = 'ana.analyst' order by s.created_at desc limit 1`. It is null while signed in and set after sign-out. Sign-out ends the session row; it does not delete it, so a row count does not change.

## Gotchas

- The doctor never signs in, because a login writes a session row. Sign in only from a scenario.
- `getByLabel('Password')` matches only on the sign-in card. On the signature sheet the label reads differently, so `v.sign()` uses `/Password/`.
- Nothing in the app unlocks an account. A lock lasts for the life of the scratch database, so lock only `ada.admin`, which no other recipe uses, and run down.sh, then up.sh, to get it back.
- Every wrong password, at sign-in or on a signature sheet, writes an Audit Trail entry. Do not prove a password refusal by an unchanged audit count.

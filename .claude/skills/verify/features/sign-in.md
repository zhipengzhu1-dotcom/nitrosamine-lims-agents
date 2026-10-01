# Sign in and out

A person signs in with a username and password and lands on the Tests worklist. The rail shows their name and role. Bad credentials are refused on the sign-in card, and signing out returns to the card. A reload keeps the session, because the API holds it in a cookie.

## Sub-features

- `signin-ok` signs in and shows the `Tests` worklist with the person's name in the rail.
- `signin-refused` refuses a wrong password with `the credentials are not valid` in `role=alert`.
- `signin-session` keeps the person signed in across a reload.
- `signout` ends the session and shows the `Sign in` heading.

## How to get to it (user POV)

- Open the web root. With no session, every route shows the sign-in card.
- Press `Sign out` in the rail from any signed-in screen.

## Driving it with drive.ts

Preconditions:

- doctor.sh is all `ok:`.

- **Refused.** Fill `Username` with `ana.analyst` and `Password` with `wrong`, then press `Sign in`. `role=alert` reads `the credentials are not valid`, and `steps.log` shows `POST /api/login -> 401`.
- **Signed in.** Run `await v.signIn('ana.analyst')`. The heading `Tests` is visible, and the rail shows `Ana Ferreira` with `Analyst · ana.analyst`.
- **Session.** Run `await page.reload()`. The heading `Tests` is still there, and `GET /api/me -> 200`.
- **Signed out.** Run `await v.signOut()`. The heading `Sign in` is visible. A later `page.reload()` still shows the sign-in card, and `GET /api/me -> 401`.
- **Proof.** Query `select count(*) from lims.session` before and after. It is read-only and shows the session row the sign-in created.

## Gotchas

- The doctor never signs in, because a login writes a session row. Sign in only from a scenario.
- `getByLabel('Password')` matches only on the sign-in card. On the signature sheet the label reads differently, so `v.sign()` uses `/Password/`.
- A locked account is refused with HTTP 423 and `this account is locked`. No demo account is locked, so this path cannot be reached without writing to the database. Report it as not reachable.

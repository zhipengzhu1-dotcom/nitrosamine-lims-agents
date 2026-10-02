# Workstations, Lock and Switch user

The Admin registers a bench PC as a Workstation (name, Room, browser policy, reason) on the `Workstations` page and enrols the browser in front of them with a device cookie. Every later sign-in on that browser shows the Workstation and Room in the rail; any other browser shows `Unregistered device`. On the rail, `Lock` hides the screen behind a `Locked` card that only the same person's password opens, and `Switch user` locks and lets another person sign in over the earlier session, which ends.

## Sub-features

- `room-register` registers a Room (`Register a Room` on the page, then the rail's `Register Room`).
- `workstation-register` registers a Workstation; a second one of the same name is refused, and every role but Admin is refused the page.
- `workstation-enrol` enrols this browser; later sign-ins on it carry the Workstation.
- `lock` locks the screen; a wrong password at `Unlock` is refused, the right one returns to the worklist, and `Sign out` on the lock screen ends the session.
- `switch-user` hands the screen to a second person; the earlier session ends with a takeover Access Event.

## How to get to it (user POV)

- Sign in as `ada.admin` and open `Workstations` in the nav. The rail offers `Register Workstation`, or `Enrol this browser` after `Choose to enrol` on a row.
- On any signed-in screen, press `Lock` or `Switch user` in the rail.

## Driving it with drive.ts

Preconditions:

- doctor.sh is all `ok:`. The seed holds the Rooms `LC-MS/MS Room (fictional)` and `Sample Preparation Room (fictional)`.

- **Register.** As `ada.admin` on `Workstations`, press the rail's `Register Workstation`, fill `Workstation name`, `Room`, `Browser policy` and `Reason` in `form.sheet`, and press its `Register Workstation`. The rail reads `Workstation <name> registered`. Wait for `form.sheet` to leave before pressing the rail button again; while it closes, two buttons share the name.
- **Enrol.** Press `Choose to enrol` on the row, then the rail's `Enrol this browser` (`exact: true`), fill `Reason`, and press it in the sheet. The row reads `Enrolled`. The current session keeps `Unregistered device`; sign out and in to see the Workstation.
- **Lock.** Sign in as `ana.analyst` on the enrolled browser and press `Lock` (`exact: true`). The heading `Locked` replaces every record, and `GET /api/me -> 423`. A reload stays locked.
- **Switch user.** Press `Switch user`, fill `Username` and `Password`, and press `Sign in on this screen`.
- **Proof.** `select e.kind, s.username, t.username as taken_by, w.name from lims.access_event e left join lims.person s on s.id = e.subject_id left join lims.person t on t.id = e.taken_by_id left join lims.workstation w on w.id = e.workstation_id order by e.at`. The walk reads `SignInSucceeded`, `Lock`, `UnlockFailed` for each wrong password, `Unlock`, `Lock`, `Takeover` (subject the first person, taken by the second), then the second person's `SignInSucceeded`, all on the Workstation.

## Gotchas

- `v.shot(name)` takes a full-page screenshot, which unrolls the fixed rail layout. Use `v.shot(name, false)` to see the sheet over the rail as a person does.
- The device cookie lives in the browser context. A new `open()` is a new, unregistered browser.

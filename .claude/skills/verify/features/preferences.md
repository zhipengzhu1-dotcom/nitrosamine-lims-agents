# Your preferences: reduced motion

Each person can turn on reduced motion for themselves on `Your preferences`, reached from their name in the rail. The setting is stored on the person, so it follows them to every device and through `Switch user` on a shared tablet. It only reduces motion: with it off, a device set to reduce motion still does.

## Sub-features

- `preference-set` saves the box `Reduce motion wherever I sign in`; the page shows `Saved. Motion is reduced wherever you sign in.` or `Saved. Motion follows each device’s own setting.`
- `preference-follows` applies the person's setting after sign-in, unlock and `Switch user`, without a reload, and drops it at sign-out.
- `device-holds` keeps motion reduced on a device set to reduce motion, whatever the preference.

## How to get to it (user POV)

- Sign in as anyone and press your name in the rail.

## Driving it with drive.ts

Preconditions:

- doctor.sh is all `ok:`. No preference is set in a fresh instance.

- **Set.** Press the rail's link `<name>, your preferences`, check `Reduce motion wherever I sign in`, and press `Save preferences`.
- **Observe motion.** Hold the pointer down on `Save preferences`, wait for its animations to finish, and read `getComputedStyle(button).transform`: `matrix(0.97, 0, 0, 0.97, 0, 0)` under full motion, `none` under reduced motion. Move the pointer off the button before releasing it, so nothing is saved. `page.emulateMedia({ reducedMotion: 'reduce' })` sets the device side.
- **Switch user.** As in [workstations.md](./workstations.md); the hash stays `#/preferences`, so the next person lands on their own preferences.
- **Proof.** `select actor, reason, new_row->'reduced_motion' from lims.audit_entry where table_name = 'person' and reason = 'Set my reduced-motion preference' order by seq`. Saving the value already held writes no entry.

## Gotchas

- A change of the device's media setting reaches the page in its next rendering step; wait two animation frames before reading motion.

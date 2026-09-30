# Session state in the web app (rule 1)

The server owns the session and the browser only reports what the server says. Each item below is a mechanism, not a convention.

## States

A session has three states, `active`, `locked` and `ended`. `lims.session_state(session, last_activity, now)` derives the state on every request from the database clock:

- It is `ended` if it was ended (logout, takeover, admin) or it is past its 12-hour `absolute_end_at`.
- It is `locked` if `locked_at` is set (manual Lock, Switch user, or the sweeper's idle lock), or if it has had 15 minutes with no real activity.
- Otherwise it is `active`.

Because the state is derived, enforcement never waits for a background job. The `svc:session-sweeper` job only writes the audited `idle_lock` row and sets `locked_at`, so the access log has the event.

## Every page load asks first

`SessionGate` wraps the router. On mount it calls `GET /api/session`, and until the answer arrives nothing record-shaped renders.

- If the state is `none`, it shows SignIn with `returnTo` set to the deep link.
- If the state is `locked`, it shows LockScreen, which names the owner and the lock reason.
- If the state is `active`, it mounts the routes, keyed by the session `epoch`.

A reload, a new tab, Back or Forward all go through the same gate. The URL is only ever a destination. The person is the cookie's session, and the session changes only through a sign-in command.

## Deep links

A deep link opens only after sign-in. SignIn keeps `returnTo` in memory, not in storage, and navigates there after `session.login` succeeds. The routed screen then loads its View like any other screen.

## No mutation on GET, structurally

- Views run in `BEGIN ... READ ONLY` transactions (`openRead`). Postgres refuses any write inside one.
- Mutations exist only as `POST /api/commands/:name`. Fastify registers no other mutating route.
- `GET /api/session` reads the derived state and writes nothing. It does not even refresh the idle timer.
- The client has a lint rule, `no-command-in-effect`, so navigation and render never call `useCommand().run`. Commands run only from event handlers.

## Idle lock without polling loopholes

The idle timer measures real input, not requests.

- `useActivityReporter` listens for `pointerdown` and `keydown`. It posts `POST /api/session/activity` at most once a minute. This updates only `session_activity`, which is operational and not audited.
- Background refetches, such as the queue polling or the rail's clock, never count as activity. So a screen left open on a bench PC still locks at 15 minutes.
- `useIdleLock(idleLockAt)` sets a timer to the server's `idleLockAt`. When it fires, the client shows LockScreen at once and calls `refresh()`, and the server's derived state agrees.
- The server does not trust the client timer. Any request after the deadline gets `423`.

## Lock, Switch user, takeover

- **Lock.** `session.lock` sets `locked_at` (audited `lock`). The client unmounts the routed subtree and calls `queryClient.clear()`, so cached record data is dropped. It also posts `lock` on the `lims-session` BroadcastChannel, and other tabs refresh and lock too.
- **Unlock.** `session.unlock` needs full re-authentication by the owner: typed user ID, password and a fresh TOTP. A new `epoch` remounts the app.
- **Switch user.** `session.switchUser` locks at once with reason `switch-user`. The LockScreen offers two paths. The owner can unlock, or another person can sign in.
- **Takeover.** `session.takeover` checks the newcomer's full credentials. In one transaction it ends the previous session (`takeover`, audited on the company chain), creates the new one and replaces the cookie. The previous person's next request from any tab gets `401 ended`.

## Refusals from any request

Any View or Command answering `401` or `423` calls `session.reportLockedOrEnded()`. The client then refetches `/api/session` and lets SessionGate render the lock or sign-in screen. A locked session refuses every request except `GET /api/session` and the unlock, takeover and sign-in commands.

## What the browser stores

It stores nothing about records or identity. It keeps no drafts in storage, because every entry saves to the server as it is made. The cookie is `HttpOnly; Secure; SameSite=Strict`. Commands also require a custom `X-LIMS-Command: 1` header, which is a CSRF belt for the brace that SameSite already is. Password and TOTP fields are `autocomplete="off"`, and the keypad types into the TOTP field only.

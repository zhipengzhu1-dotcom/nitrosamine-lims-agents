# Research: secure login with two-factor authentication

Ticket: #7 (part of map #1). Researched 2026-09-29. All lab data is fictional.

**Question.** How should login work so it meets 21 CFR Part 11 §11.300 and current practice (NIST SP 800-63B) with two-factor authentication? Compare authenticator-app TOTP, Duo Push, and passkeys/WebAuthn. Cover session timeout, lockout, password rules, re-authentication for e-signatures, and candidate libraries. Recommend one.

**Headcount assumed** (from the owner): about 30 internal users (about 20 Analysts, 3 Lab Managers, plus QA, Sample Custodians and Admins) plus external Customer portal users.

## Recommendation

Build login in-house as **password + a second factor for every account**, with two second-factor options, and no Duo:

1. **Authenticator-app TOTP (RFC 6238)** is the baseline every user enrolls. It works with **Microsoft Authenticator and Duo Mobile** (both accept third-party TOTP accounts by QR code), plus any other authenticator app. It costs $0 and needs no outside service.
2. **Passkeys (WebAuthn)** are offered to everyone as the phishing-resistant option. NIST SP 800-63B-4 requires this at AAL2: "Verifiers SHALL offer at least one phishing-resistant authentication option at AAL2" (§2.2.2). Staff with Touch ID, Windows Hello or a phone passkey can use it in place of typing a code.
3. **Duo Push is not recommended** at this headcount. Duo Free stops at 10 users and gives almost no policy control. At ~30 internal users the cheapest plan that can require Verified Push (Essentials, $3/user/month) comes to **~$90/month before any Customer accounts**. That is about 9 times the whole ≤ ~$10/month server budget, and it adds a login dependency on an outside service. Duo stays an easy add-on later (see [Duo Push](#duo-push-via-duos-service)), because it slots in as the second step after the password.

**Every e-signature re-authenticates in full**: typed user ID + password + a fresh second factor (a new TOTP code or a passkey assertion with user verification), on every signing. This meets §11.200(a)(1)(ii) without having to define a "continuous period of controlled system access".

**Libraries**: compose small, focused TypeScript libraries (`otpauth`, `@simplewebauthn/server` + `@simplewebauthn/browser`, `@node-rs/argon2`) with database-backed sessions the app owns, so every auth event goes into the Part 11 audit trail. `better-auth` is the runner-up if the backend wants a framework.

## Comparison: TOTP vs Duo Push vs passkeys

| | Authenticator-app TOTP | Duo Push (Duo's service) | Passkeys / WebAuthn |
|---|---|---|---|
| Standard | RFC 6238 on top of RFC 4226 | Proprietary; Duo Web SDK v4 (OIDC-style redirect) | W3C WebAuthn Level 3 (W3C Recommendation, 25 Aug 2026) |
| Apps the owner named | Microsoft Authenticator and Duo Mobile both add "Other account" / third-party TOTP by QR code | Duo Mobile only | Platform authenticators (Touch ID, Windows Hello, Android), phone passkeys, security keys |
| NIST 800-63B-4 AAL2 | Allowed (OTP authenticator). "OTP authentication is not phishing-resistant." | Allowed (out-of-band) only if the code is transferred between channels. "Out-of-band authentication is not phishing-resistant." | Allowed. Phishing-resistant because credentials are bound to the site's origin. Synced passkeys OK at AAL2, not AAL3 |
| Cost at ~30 internal users | $0 | Free tier caps at 10 users. Essentials $3/user/month = $90/month for 30 (licensed in blocks of 10); Customers add to that | $0 |
| Outside dependency | None (offline codes) | Duo cloud must be reachable at every login | None |
| Hosting needs | HTTPS | HTTPS redirect URI, outbound TLS 1.2+ to Duo | HTTPS **and a domain name**; WebAuthn does not accept a bare IP address as the RP ID |
| Main weaknesses | Phishable (a fake site can relay a code); shared secret lives on the server; users lose phones | Push fatigue if codes aren't required; per-user cost; vendor lock-in | Users need a capable device; recovery if all passkeys are lost; some shared lab PCs may not support platform authenticators |
| Build effort | Small | Small (SDK) plus a Duo admin account | Medium |

### Authenticator-app TOTP

- **Algorithm.** TOTP uses a 30-second time step: "We RECOMMEND a default time-step size of 30 seconds" (RFC 6238 §5.2). HMAC-SHA-1, -256 and -512 are defined. Use **SHA-1, 6 digits, 30 s**. Those are the parameters both apps' docs describe (Microsoft: "the verification code changes every 30 seconds"; Duo: "a passcode which expires in 30 seconds"). Neither doc confirms support for other algorithms.
- **Secret.** RFC 4226 R6: "The length of the shared secret MUST be at least 128 bits. This document RECOMMENDs a shared secret length of 160 bits." NIST requires at least 112 bits of security strength (800-63B-4 §3.1.4.1). Use a 160-bit random secret.
- **Clock window.** Accept at most one step back: "at most one time step is allowed as the network delay" (RFC 6238 §5.2).
- **Replay.** "The verifier MUST NOT accept the second attempt of the OTP after the successful validation has been issued for the first OTP" (RFC 6238 §5.2). NIST: "Verifiers SHALL accept a given OTP only once while it is valid" (§3.1.4.2). Store the last accepted time-step counter per user and reject anything at or below it. The same rule makes a login code unusable for a signing a few seconds later; the user waits for the next code.
- **Secret at rest.** RFC 6238 §5 recommends keeping keys encrypted and "decrypted when needed to verify an OTP value, and re-encrypted immediately". NIST says OTP keys "SHALL be strongly protected against unauthorized disclosure by access controls" (§3.1.4.2). Encrypt each secret with AES-GCM under a key held outside the database (an environment secret).
- **Guessing.** RFC 4226 §7.3 recommends a throttling parameter T (maximum attempts). Attacker success is s·v/10^Digit (§6), where s is the window and v the number of attempts. So the account lockout below also protects the 6-digit code.
- **Phone loss.** Duo Mobile: "It is not possible to export third-party accounts from Duo Mobile" without Duo Restore. So issue **10 single-use recovery codes** (stored hashed) at enrollment, and have an Admin re-enrollment procedure (§11.300(c)).

### Duo Push via Duo's service

- **Pricing** (duo.com/editions-and-pricing, fetched 2026-09-29). Free is $0 and allows "up to 10 users". Essentials is $3/user/month, Advantage $6, Premier $9. "For under 100 users, Duo licenses are purchased in increments of 10."
- **At this headcount.** 30 internal users means 3 blocks of 10: **$90/month on Essentials** or $180/month on Advantage. Every Customer portal login is another licensed user; for example, 20 Customer contacts make 50 users, or $150/month on Essentials. Duo Free cannot cover even the internal staff.
- **Policy limits of Free.** "Duo Free plan customers have limited access to Duo policies. Free plans may only control the New User Policy." The Authentication Methods policy (which includes "Require a Verified Duo Push") is "Available in: Duo Essentials, Duo Advantage, and Duo Premier" (duo.com/docs/policy).
- **Push fatigue and NIST.** NIST 800-63B-4 §3.1.3 no longer accepts plain "approve" pushes: that method "is no longer considered acceptable because it increases the likelihood that the subscriber would approve an authentication request without actually comparing the secrets". The code must be transferred between channels. Duo's Verified Push does this, and Duo's own guide says "Configure 6 digits to meet the NIST SP 800-63B ... AAL2 compliance minimum". Essentials' default is 3 digits, so an admin would have to change it. Verified Push "is not supported in the traditional Duo Prompt"; it needs Universal Prompt.
- **Integration.** Duo Web SDK v4 is a redirect to a Duo-hosted prompt, then a code exchange using client ID and secret (duo.com/docs/duoweb). The Node SDK is `@duosecurity/duo_universal` (npm 3.1.0, MIT). "Duo Web SDK is available to ... Duo Free, and trial accounts" too, but Free cannot enforce Verified Push.
- **Verdict.** It works and is well documented, but it fails the budget and adds a runtime dependency. It fits later only if the lab gets a Duo subscription for other reasons.

### Passkeys / WebAuthn

- **Status.** WebAuthn Level 3 is a W3C Recommendation dated 25 August 2026.
- **Why it resists phishing.** A credential "can only be accessed by origins belonging to that Relying Party", so a look-alike site cannot use it.
- **Challenges.** Server-generated random data, "at least 16 bytes long". Use `userVerification: "required"` so the authenticator checks a PIN or biometric. That makes a passkey a multi-factor cryptographic authenticator on its own (AAL2 under 800-63B-4 §2.2.1).
- **Synced passkeys.** The BE/BS flags record whether a credential can be, and currently is, backed up across devices. NIST: "syncable authenticators SHALL NOT be used at AAL3". They are permitted at AAL2 (Appendix B). This LIMS targets AAL2, so iCloud Keychain, Google Password Manager and Windows passkeys are fine.
- **Hosting constraint.** The RP ID must be a domain: "Only the domain format of host is allowed here", so a bare IP address won't work. The API is only available in secure contexts. **The cheap server needs a domain name and TLS certificate** (for example Let's Encrypt).
- **Role in this design.** Passkeys are offered alongside TOTP, not instead of it. Shared lab PCs and older phones can still use TOTP. A user may register several passkeys.

## Session, lockout and password rules

### Session management

| Rule | Value | Source |
|---|---|---|
| Inactivity timeout | **15 minutes** (lab PCs are shared) | NIST AAL2: "The inactivity timeout SHOULD be no more than 1 hour" (§2.2.3); OWASP: 15–30 min for low-risk apps, 2–5 min for high-value ones |
| Absolute timeout | **12 hours** (one shift) | NIST AAL2: overall timeout "SHOULD be no more than 24 hours" (§2.2.3) |
| After a timeout | Full login (password + second factor) | NIST "MAY" allow password-only re-auth after inactivity. We skip that to keep one path |
| Session ID | 256-bit random, server-side session row, cookie `__Host-sid; Secure; HttpOnly; SameSite=Strict; Path=/` | OWASP: ≥64 bits entropy, Secure, HttpOnly, SameSite, `__Host-` prefix |
| Rotation | New session ID at login and at role change | OWASP: "must be renewed or regenerated ... after any privilege level change" |
| Logout | Deletes the server-side session row | OWASP: invalidate server-side, not just the cookie |
| Transport | HTTPS only (HSTS) | NIST: "authenticated protected channels" at all AALs |

The idle timer runs on the server (last-activity timestamp on the session row), and the React client shows a countdown warning. Part 11 §11.10(d) ("Limiting system access to authorized individuals") is the regulatory hook.

### Failed attempts and lockout

- NIST floor: "limit consecutive failed authentication attempts ... to no more than 100 by disabling that authenticator" (§3.2.2). NIST lists increasing wait periods ("30 seconds up to an hour"), bot challenges, and IP/risk signals as mitigations.
- Part 11 §11.300(d) requires "transaction safeguards to prevent unauthorized use ... and to detect and report in an immediate and urgent manner any attempts at their unauthorized use to the system security unit".
- **Design:**
  - Per-account counter covering password, TOTP, passkey and recovery-code failures, at login and at e-signature.
  - From the 3rd consecutive failure, an increasing delay (30 s, 1 min, 2 min, ...).
  - At **10 consecutive failures** the account locks. Only an Admin can unlock it, and the unlock is recorded in the audit trail with a reason. Ten is far below NIST's ceiling of 100; the exact number is for the owner/QA to confirm.
  - Per-IP rate limit on the login endpoint.
  - Every failure is audit-logged. A lockout, or any failed e-signature attempt, immediately notifies Admin and QA (in-app, plus email once notifications exist). This is the §11.300(d) "immediate and urgent" report.

### Password rules

| Rule | Value | Source |
|---|---|---|
| Minimum length | **15** characters (passphrases encouraged) | NIST: 8 minimum when the password is only used with MFA, 15 when single-factor (§3.1.1.2). 15 keeps passwords sound even while 2FA is being recovered |
| Maximum length | Accept at least 64 (allow 128) | NIST SHOULD ≥64 |
| Composition rules | **None** (no "1 upper, 1 symbol") | NIST: "SHALL NOT impose other composition rules" |
| Characters | All printable ASCII, space, Unicode; paste allowed (password managers) | NIST SHOULD |
| Blocklist | Reject passwords found in Have I Been Pwned's Pwned Passwords (k-anonymity range API, `Add-Padding: true`, free, no key), plus the user ID, lab name and product names | NIST: "SHALL compare the prospective secret against a blocklist" |
| Periodic forced change | **None**; force a change on evidence of compromise | NIST: "SHALL NOT require subscribers to change passwords periodically" |
| Hints / security questions | None | NIST SHALL NOT |
| Storage | Argon2id (m = 19 MiB, t = 2, p = 1 minimum), random salt, plus a keyed pepper held outside the DB | NIST: salted and hashed, salt ≥32 bits, SHOULD add a keyed step with a separate secret (§3.1.1.2). OWASP gives the Argon2id parameters. (NIST points to SP 800-132, i.e. PBKDF2; if strict federal alignment matters, use PBKDF2-HMAC-SHA256 at ≥600,000 iterations, per OWASP) |

### Reconciling §11.300(b) with NIST on password aging

§11.300(b) requires "Ensuring that identification code and password issuances are periodically checked, recalled, or revised (e.g., to cover such events as password aging)". NIST 800-63B-4 forbids forced periodic changes. Aging is only an example ("e.g.") and "checked" is one of three options, so the design meets (b) by periodic **checking**:

- Re-check each password against Pwned Passwords at every successful login, and force a change on a hit.
- Run a **quarterly access review**: the Lab Manager and QA confirm each active account, role and enrolled authenticator, and disable leavers. The review is recorded.
- Force a change after any suspected compromise.

This is a judgment call. See the open questions.

### Other §11.300 and §11.100 controls

- **(a) Uniqueness.** User IDs are unique and **never reused or reassigned**, which also serves §11.100(a). Accounts are disabled, never deleted or renamed.
- **(c) Loss management.** A user reports a lost phone or passkey. An Admin revokes all of that user's authenticators and sessions in one action (audited). The user re-verifies identity and enrolls again, using a single-use enrollment link that expires in 24 hours.
- **(e) Device testing.** Each TOTP or passkey enrollment must pass a live verification before it is saved. The quarterly review confirms each user still authenticates.
- **§11.100(b) identity verification.** An Admin confirms the person's identity (in person or against HR records) before activating the account, and records who verified it and when.
- **§11.200(a)(3) collaboration.** Admins can never see or set a user's password or TOTP secret. Resets issue a one-time link that the user completes. So misusing someone's signature would require the user and an Admin to collude.

## E-signature re-authentication (§11.200, with §11.50 and §11.70)

### What the regulation says

- §11.200(a)(1): non-biometric signatures "Employ at least two distinct identification components such as an identification code and password".
- (i): during "a single, continuous period of controlled system access", the first signing uses all components and later ones at least one private component.
- (ii): signings outside such a period use "all of the electronic signature components" every time.
- §11.200(a)(2): signatures are "used only by their genuine owners".
- §11.50: signed records show the printed name, date and time, and meaning ("such as review, approval, responsibility, or authorship").
- §11.70: signatures are "linked to their respective electronic records" so they "cannot be excised, copied, or otherwise transferred".

### Design

- **Components.** The e-signature is **user ID + password**, the two components §11.200 names, **plus the second factor** as an extra safeguard. A passkey is treated as a cryptographic token, not a §11.200(b) biometric signature. The server never sees the biometric, so the design doesn't depend on (b).
- **Every signing is a full signing.** Treating each signing under (a)(1)(ii) avoids arguing about what counts as "continuous" in a web app with idle timeouts. It costs about 10 seconds per signature.
- **The signing dialog:**
  1. Shows the record's summary and version, the **meaning** (Performed / Reviewed / Approved / Released, fixed by the action), and the signer's printed name.
  2. Requires the user to **type** their user ID and password, then enter a fresh TOTP code or complete a passkey assertion with `userVerification: "required"`.
- **Server checks, in one transaction:**
  - The session is valid.
  - The typed user ID equals the session user; a mismatch is rejected and alerted (§11.200(a)(2)).
  - The password hash matches.
  - The TOTP counter is newer than the last accepted one, or the passkey assertion is valid. For a passkey, the WebAuthn challenge is a server nonce tied to (record ID, record version hash, meaning), so the assertion can't be replayed onto another record.
  - The user's role and training allow this action (§11.10(g) authority checks).
- **Signature row.** Stores signer ID, printed name, meaning, server UTC timestamp, record ID, **SHA-256 of the record's canonical content at signing**, authenticator type used, and session ID. The row is append-only and its hash is linked into the audit trail. Any later edit to the record changes its hash, so the signature visibly no longer matches (§11.70). Name, date/time and meaning appear on every screen and printout of the record (§11.50(b)).
- **Failures.** Failed signing attempts count toward the lockout and alert Admin and QA immediately (§11.300(d)).
- **Batch signing** (for example a Reviewer approving 12 results at once). One ceremony at full strength, then one signature row per record, each with its own hash. Whether the lab accepts this is an open question for QA.
- **Paperwork outside the software.** §11.100(c) requires a one-time, hand-signed certification to FDA that e-signatures are the legal equivalent of handwritten ones. §11.10(j) requires a written accountability policy. Both belong to the (fictional) organization; the LIMS only records each user's acknowledgment at enrollment.

## Candidate TypeScript libraries

Versions are from the npm registry on 2026-09-29.

| Need | Library | Latest | Notes |
|---|---|---|---|
| TOTP | **`otpauth`** | 9.5.2 (2026-09-03), MIT | HOTP/TOTP "for Node.js, Deno, Bun and browsers". `validate({ token, window: 1 })` returns the step delta. `counter()` supports replay tracking. Generates `otpauth://` URIs for the QR code |
| TOTP (alt) | `otplib` | 13.5.0 (2026-08-21), MIT | "TypeScript-first library for TOTP and HOTP with multi-runtime and plugin support" |
| Passkeys | **`@simplewebauthn/server`** + **`@simplewebauthn/browser`** | 14.0.3 (2026-09-25), MIT | Node LTS 22+ / Deno 2.4+. Four calls: `generateRegistrationOptions`, `verifyRegistrationResponse`, `generateAuthenticationOptions`, `verifyAuthenticationResponse`. Store per credential: `id`, `publicKey`, `counter` (BIGINT), `transports`, `backedUp`, `deviceType` |
| Password hash | **`@node-rs/argon2`** | 2.2.1 (2026-09-10), MIT | Rust binding with prebuilt binaries (no node-gyp on the server) |
| Password hash (alt) | `argon2` | 0.45.1 (2026-07-21), MIT | Established native binding. PBKDF2 is also in Node's built-in `crypto` |
| Breached-password check | Pwned Passwords range API | n/a | Free, no key, no rate limit; send the first 5 SHA-1 hex characters only |
| Sessions | App-owned (DB table plus cookie) | n/a | Lucia "was deprecated on March 2025" and now points to a single-file session implementation and the Auth Book. Follow that pattern: ~100 lines the app owns and audits |
| Integrated framework (runner-up) | `better-auth` + `@better-auth/passkey` | 1.7.6 (2026-09-24), MIT | 2FA plugin (TOTP at 30 s, backup codes, lockout returns `429 ACCOUNT_TEMPORARILY_LOCKED`). Passkey plugin is "powered by SimpleWebAuthn". Caveats: **turn off `trustDevice`** (30-day 2FA skip), don't enable email/SMS OTP (NIST: "Email SHALL NOT be used for out-of-band authentication"; PSTN is "restricted"), and wire its events into the audit trail |
| Duo (only if adopted later) | `@duosecurity/duo_universal` | 3.1.0 (2026-08-21), MIT | Official Duo Universal SDK for Node |

**Why compose instead of adopting Better Auth.** Part 11 needs every authentication and signing event in the lab's own audit trail. The e-signature ceremony is bespoke either way. The three composed libraries cover the crypto; everything else (sessions, lockout, alerts, signature rows) is lab logic that should live in one deep auth module the app owns. Better Auth is a reasonable swap if the backend team would rather configure than build, with the caveats above.

**Scope note.** These are Node/TypeScript libraries. If the backend ends up in Python (the map allows it), equivalent libraries were not researched here.

## Open questions for the owner

1. **Domain name.** Passkeys need a real domain with HTTPS; a bare IP won't work. Does the demo have (or will it buy) a domain for the cheap server?
2. **Password aging.** Will QA accept "periodic checking" (breach re-check at login plus a quarterly access review) as meeting §11.300(b) with no forced rotation, as NIST requires? Or should the demo add aging for auditor comfort, knowing it goes against NIST?
3. **Lockout threshold.** Is 10 consecutive failures with Admin-only unlock right, or does the lab want a stricter GxP-style number such as 3–5?
4. **Batch signing.** May a Reviewer or QA sign several records in one ceremony (one signature row per record), or must each record be signed separately?
5. **Customer e-signatures.** Do Customer portal users ever apply Part 11 e-signatures (for example on submissions), or only log in? This changes whether they need the signing ceremony. They need 2FA either way.

## Sources (all fetched 2026-09-29)

- NIST SP 800-63B-4, *Digital Identity Guidelines: Authentication and Authenticator Management* (Revision 4, Aug 2025): https://pages.nist.gov/800-63-4/sp800-63b.html
- 21 CFR Part 11 (§§11.10, 11.50, 11.70, 11.100, 11.200, 11.300), eCFR, up to date as of 2026-09-25, retrieved via the eCFR versioner API: https://www.ecfr.gov/api/versioner/v1/full/2026-09-25/title-21.xml?part=11 (human-readable page: https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-11)
- RFC 6238, TOTP: https://www.rfc-editor.org/rfc/rfc6238
- RFC 4226, HOTP: https://www.rfc-editor.org/rfc/rfc4226
- W3C Web Authentication Level 3 (Recommendation, 25 Aug 2026): https://www.w3.org/TR/webauthn-3/
- Duo editions and pricing: https://duo.com/editions-and-pricing
- Duo Web SDK v4: https://duo.com/docs/duoweb
- Duo policy guide (Authentication Methods, Verified Duo Push, Free-plan limits): https://duo.com/docs/policy
- Duo Authentication Methods Security Guide: https://duo.com/docs/authentication-methods-security-guide
- Duo Mobile third-party accounts: https://guide.duo.com/third-party-accounts/
- Microsoft Authenticator, adding accounts: https://support.microsoft.com/en-us/authenticator/how-to-add-your-accounts-to-microsoft-authenticator
- SimpleWebAuthn server docs: https://simplewebauthn.dev/docs/packages/server
- Better Auth 2FA plugin: https://www.better-auth.com/docs/plugins/2fa
- Better Auth passkey plugin: https://www.better-auth.com/docs/plugins/passkey
- Lucia repository (deprecation notice): https://github.com/lucia-auth/lucia
- npm registry metadata: https://registry.npmjs.org/otpauth, https://registry.npmjs.org/otplib, https://registry.npmjs.org/@simplewebauthn%2Fserver, https://registry.npmjs.org/better-auth, https://registry.npmjs.org/@better-auth%2Fpasskey, https://registry.npmjs.org/argon2, https://registry.npmjs.org/@node-rs%2Fargon2, https://registry.npmjs.org/@duosecurity%2Fduo_universal
- Have I Been Pwned API v3 (Pwned Passwords range API): https://haveibeenpwned.com/API/v3
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html

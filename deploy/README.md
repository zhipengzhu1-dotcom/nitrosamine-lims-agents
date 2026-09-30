# Deploying the demo

This is the owner's runbook for the first deploy on the Mac. It follows [ADR 0002](../docs/adr/0002-react-spa-fastify-postgres-hosted-on-the-owners-mac-then-a-us-vps.md) and decision [#34](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/34). Every box below is the owner's to tick. Each script takes `--dry-run`, which prints what it would do and changes nothing. Run the dry run first.

## What runs

| Service | Image | Networks | Reaches |
|---|---|---|---|
| `tunnel` | `cloudflare/cloudflared`, pinned by digest | edge, egress | Cloudflare, and `web` |
| `web` | Caddy, with the Vite build of `apps/web` and the Caddyfile baked in | edge only | `api` |
| `api` | Node 24 running `apps/api/src/server.ts` | db, edge, egress | Postgres, chrony in the VM, and later the Worker |
| `db-init` | the `api` image, run once on each start | db only | Postgres |
| `postgres` | PostgreSQL 18.6, pinned by digest | db only | nothing |

- **Nothing is published on the Mac.** `db` and `edge` are internal networks with no route out. The only way in is the tunnel, which dials out to Cloudflare.
- **Named volumes only.**
  - `pgdata` holds the database and the Postgres operator logs, in `log/`.
  - `reports` holds the report store.
  - `state` holds the data class and its change history.
  - `pnpm check:deploy` fails on any bind mount, so no container can reach the repo folder or the real instrument exports in it. The Colima VM mounts only the secrets folder, read-only, so the VM can't see the exports either.
- **The app never connects as owner or superuser.** `db-init` does four things:
  - creates the roles through `packages/db`'s runner;
  - sets the passwords of `lims_migrator` and `lims_app`;
  - turns on statement logging for `postgres` and `lims_migrator`;
  - applies the migrations.

  The API container gets only `lims_app`'s password, and `lims_owner` can't log in.
- **Base images are pinned by digest.** Each digest is a multi-arch index covering arm64 (the Mac) and amd64 (the VPS). Bump them monthly, and apply critical fixes within 7 days (ADR 0002 "Patching").

## First deploy on the Mac

### 1. Tools, VM and clock

- [ ] Run `deploy/mac/bootstrap.sh --dry-run`, read the output, then run `deploy/mac/bootstrap.sh`. It does four things:
  - It installs `colima docker docker-compose docker-buildx cloudflared age` from Homebrew. Docker Desktop stays unused, because its free licence doesn't cover the company.
  - It starts the Colima profile `lims` (4 CPUs, 6 GiB, 60 GiB disk) with only the secrets folder mounted.
  - It installs chrony in the VM with NTS against `time.cloudflare.com` and `makestep 1 -1`, then waits until the clock is within 1 s.
  - It lets the API read chrony's sync state from the Compose egress network. That access covers monitoring only, never control.
- [ ] Rerun it after a macOS or Colima upgrade. It is safe to rerun.
- [ ] Run `pnpm install` in the repo. `start.sh` runs `pnpm check:deploy` before every start.

### 2. Secrets

All of these live in `~/.config/nitrosamine-lims/secrets/`, outside the repo. The folder is mode 700 and each file 600. None is ever committed. `start.sh` refuses to launch if a file is missing or readable by anyone else.

- [ ] Run `deploy/mac/secrets.sh --dry-run`, then `deploy/mac/secrets.sh`. It creates the secrets that are random values, and it never overwrites an existing file:
  - `db_superuser_password`, `db_migrator_password` and `db_app_password`;
  - `totp_encryption_key` and `password_pepper`;
  - `worker_upload_token` and `worker_alarm_token`. When the Worker is deployed, give it the same two values with `wrangler secret put`.
- [ ] Check that `age_public_key` is already there. It was made on 2026-09-30 (#34). The private key stays offline.
- [ ] Save a copy of the TOTP key and the pepper in the password manager. Losing either locks out every account.

### 3. The Cloudflare Tunnel

- [ ] Run `cloudflared tunnel login`. The browser opens. Choose `nitrolims-demo.com`.
- [ ] Run `cloudflared tunnel create nitrolims-demo`. Note the tunnel id it prints.
- [ ] Move the credentials into the secrets folder:
  `mv ~/.cloudflared/<TUNNEL_ID>.json ~/.config/nitrosamine-lims/secrets/tunnel_credentials.json && chmod 600 ~/.config/nitrosamine-lims/secrets/tunnel_credentials.json`
- [ ] Render the config:
  `sed 's/<TUNNEL_ID>/<the id>/' deploy/cloudflared/config.yml.template > ~/.config/nitrosamine-lims/secrets/cloudflared.yml && chmod 600 ~/.config/nitrosamine-lims/secrets/cloudflared.yml`
- [ ] Run `cloudflared tunnel route dns nitrolims-demo nitrolims-demo.com`. This adds the DNS record that points the domain at the tunnel.
- [ ] Move `~/.cloudflared/cert.pem` into the password manager and delete it from disk. It can create and delete tunnels on the account, and the running tunnel doesn't need it.
- [ ] In the Cloudflare dashboard for the zone, turn on *Always Use HTTPS* and set the minimum TLS version to 1.2.

### 4. Build the candidate release on this Mac only

- [ ] Commit everything. Both kinds of start refuse a working tree with uncommitted changes, because a release is built from a commit.
- [ ] Run `deploy/mac/start.sh --local`. It checks the clock and runs `pnpm check:deploy`. Then it builds this commit, starts it on `http://127.0.0.1:8080` and nowhere else, and prints two things:
  - the **release record**: the commit, the runbook's own commit, the data class, full image ids for `api`, `web`, `postgres` and `cloudflared`, the SHA-256 of `cloudflared.yml`, the tunnel id, `colima version`, `docker-compose version` and the macOS version;
  - the **approval line** for step 5.
- [ ] Open `http://127.0.0.1:8080`. Check that the page loads with the "fictional data only" banner.
- [ ] Run the ZAP baseline scan: `deploy/checks/zap.sh --out <a folder outside the repo>`. It can't run until `apps/api` exists. Until then, it is one of the exceptions in step 5.

### 5. The Release Log entry, signed before go-live

The skeleton has no Release Log record yet. Until it has one, post the entry as a comment on [#24](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/24) from the owner's account, and sign it *Approved*. The entry approves the exact build from step 4. It records:

- [ ] The release record that `start.sh --local` printed, pasted whole.
- [ ] The CI results: `pnpm typecheck`, `pnpm test` and `pnpm check:deploy`, all green. Also the ZAP report, or "not run" under the ZAP exception.
- [ ] Data class `fictional`.
- [ ] Every clock step `start.sh` listed. Each one is also a System Incident (see below).
- [ ] The signed demo exceptions, each with its lapse condition. All of them are reviewed by 2027-03-30.
  - **Two-role.** The owner is both Platform Operator and Admin, so the operator can read the TOTP key and the pepper. It lapses before any second person or any non-fictional use. Before non-fictional use, a separate QA person must re-sign every approval the owner signed alone.
  - **Anchoring** (accepted 2026-09-30). Nothing off the Mac proves that the audit chains weren't rewritten. It lapses before real data or the VPS move.
  - **FileVault** (accepted 2026-09-30). The recovery key is escrowed to iCloud, so Apple could unlock the disk, which also holds the real instrument exports. It lapses before any real data enters the LIMS.
  - **Plaintext at Cloudflare.** The tunnel sees every request, passwords and TOTP codes included. It ends with the grey-cloud VPS.
  - **Backups are not automated.** The Worker path isn't built. The 24-hour RPO is met only when the owner runs `backup.sh` at least daily. It lapses when the Worker's nightly backup runs and its first restore drill passes.
  - **System Incidents are not automated.** They are logged by hand (see below). It lapses when the API records them on the company chain and raises the alarm.
  - **Owner-role statements are logged by `log_statement`, not pgaudit.** The logs stay on the Mac, in the pgdata volume and in the owner's backups. It lapses when pgaudit and log shipping are in place.
  - **Clock sync is not enforced by the API.** `start.sh` checks it only at launch. It lapses when the API polls chrony at `LIMS_CHRONY_HOST` and refuses audited writes beyond 1 s.
  - **ZAP baseline not yet run.** It lapses with the first ZAP report attached to a Release Log entry.
- [ ] After signing, append the approval line from step 4 to `~/.config/nitrosamine-lims/secrets/approved_releases` (mode 600). Replace `<link to the signed entry>` with the comment's link.

### 6. Go live through the tunnel

- [ ] Run `deploy/mac/start.sh --dry-run`, then `deploy/mac/start.sh`. It refuses unless HEAD is in `approved_releases`, and unless the `api` and `web` images are the ones recorded there. It never rebuilds. It prints the release record again, which must match the signed one.
- [ ] Open `https://nitrolims-demo.com` from another network, such as a phone off Wi-Fi.

## Running it

- **Stopping.** `deploy/mac/stop.sh` stops the containers and keeps everything. `--down` also removes the containers and networks, after a warning. Neither removes a volume.
- **The only copy.** Until the Worker's backups exist, the volumes in the Colima VM are the only copy of the data, apart from the owner's own backups. `colima delete`, `docker volume rm` and `docker compose down -v` each destroy it for good. Never run them without a fresh backup that has passed its restore check.
- **Backups.** Run `deploy/mac/backup.sh --to <folder>` at least daily. The folder must be off the repo and off the VM, ideally on a second disk. The script streams `pg_dump`, the report store and the Postgres operator logs through `age` to the owner's public key, and writes `SHA256SUMS` and a `MANIFEST`.
- **Restore checks.** Once a quarter, and after any change to the backup, run `deploy/mac/backup.sh --restore-check <backup folder> --identity <age identity file>`. It checks the sums, and checks that both archives decrypt and read back. It restores the dump into a scratch database and runs `lims.verify_chain` on every ledger. Then it drops the scratch database. A failure is a System Incident.
- **Clock steps.** Every start prints chrony's clock steps since the previous start. Log each one as a System Incident.
- **Data class.** The first start records the class in the `state` volume. After that, a start that asks for a different class is refused, both by `start.sh` and by `db-init`. So is a start where the database exists but its marker is missing. To change the class, stop the demo, sign a Release Log entry for the change, then run `deploy/mac/data-class.sh <fictional|real> --release-log <link>`. A change to `real` also needs a personal FileVault recovery key. Every change is appended with its link to `data_class.log` in the same volume.

## System Incidents, logged by hand for now

Until the API records System Incidents on the company chain, the owner logs each one as a comment on [#24](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/24), the same place as the Release Log. Log:

- a start that `start.sh` refused, other than an operator typo;
- a failed `db-init`, including a refused data class;
- every clock step `start.sh` lists;
- a container restart the owner didn't ask for (`docker-compose ps` shows a restart count or an unexpected `Exited`);
- a failed backup or restore check.

Each comment records:

- when it happened and when it was noticed;
- what failed, with the command output;
- the immediate action taken;
- the corrective action, meaning what changes so it doesn't recur;
- the owner's *Acknowledged* when both actions are done.

If it could have affected results or records, also open a Data Integrity Deviation. A clock step during audited writes always could.

## Starting as `real`

Not now. `start.sh --data-class real` and `data-class.sh real` both refuse unless `sudo fdesetup haspersonalrecoverykey` prints `true`. Changing the data class takes its own signed Release Log entry that lists every exception above as lapsed, plus the penetration test and the supplier quality agreements.

## Not built in the skeleton

ADR 0002 calls for all of these, and nothing here does them yet. Each needs its own ticket before real data.

- **The server's refusal to start as `real` unless anchoring is live.** Only the host-side checks above exist.
- **Anchoring.** This is the Worker that sends chain heads to S3 Object Lock every 15 minutes. It is deferred under the anchoring exception.
- **Automated backups.** The nightly backups through the Worker to R2, with R2's retention rules. `backup.sh` stands in, run by hand.
- **The Worker itself.** That covers its upload and alarm endpoints, the alarm email, and its off-server checks. The two tokens are ready for it.
- **pgaudit and log shipping.** Per-role `log_statement` stands in (see RATIONALE.md, U8).
- **The API's clock checks.** Polling chrony, refusing writes when the clock is unsynced, and turning clock steps into System Incidents.
- **ZAP in CI.** `deploy/checks/zap.sh` runs it by hand against the local stack.

## Proposed supplier register additions (an ADR 0002 amendment for the owner to decide)

This packaging adds supply sources that ADR 0002's supplier table doesn't list yet:

| Supplier | Supplies | Exit path |
|---|---|---|
| Docker Hub, official images | `node`, `caddy`, `postgres`, and `cloudflare/cloudflared` (Cloudflare's own) | Images are pinned by digest. Mirror them to another registry, or build from their Dockerfiles |
| GitHub Container Registry | The OWASP ZAP image | Any registry mirror. ZAP is open source |
| Homebrew | `colima`, `lima`, `docker`, `docker-compose`, `docker-buildx`, `cloudflared`, `age` on the Mac | Upstream releases of each |
| Ubuntu archive | chrony inside the Colima VM | Debian, or a pinned `.deb` |
| npm registry | pnpm and every JavaScript dependency, locked by `pnpm-lock.yaml` | A registry mirror |
| Cloudflare, as already listed | Also `time.cloudflare.com` over NTS | Any other NTS server |

## The VPS variant (inactive)

The Lightsail shape is `compose.vps.yaml` layered over `compose.yaml`. It uses `Caddyfile.vps`, in which Caddy terminates TLS for `nitrolims-demo.com` on ports 80 and 443. Caddy keeps its certificates in the `caddy_data` volume. The tunnel profile stays off, and DNS is grey-cloud.

```sh
LIMS_SECRETS_DIR=/etc/nitrosamine-lims/secrets LIMS_DATA_CLASS=fictional \
  docker compose -f deploy/compose.yaml -f deploy/compose.vps.yaml up -d --build
```

Don't run it before ADR 0002's gates for the move are met: LUKS on the volumes, anchoring live, and chain-verify passing against the S3 anchors. The move is a restore of the latest backup. Build the images for amd64 there, or with `docker buildx build --platform linux/amd64`. On a plain Linux host, Compose bind-mounts each secret with its host owner and mode. So the files must be readable by uid 1000 (the API and `db-init`) and uid 999 (Postgres).

## The API's runtime contract

Compose gives the API these, and `apps/api` reads them:

- **`PORT`** is `3000`. Caddy proxies `/api/*` there.
- **`PGHOST`, `PGPORT`, `PGDATABASE` and `PGUSER`** name the database and `lims_app`. The entrypoint writes the password into a pgpass file on a tmpfs and sets `PGPASSFILE`, so `connectionFor('lims_app', …)` works unchanged. node-postgres warns that pgpass support leaves in pg 9.
- **`LIMS_DATA_CLASS`** is `fictional` or `real`. `db-init` has already checked it against the stored class.
- **`LIMS_REPORT_STORE`** is the report-store volume, writable by the API.
- **`LIMS_CHRONY_HOST`** is `172.30.10.1`, chrony in the VM, which answers monitoring requests (`tracking`) on UDP 323.
- **`LIMS_*_FILE`** gives the paths of the TOTP key, the pepper, the two Worker tokens and the `age` public key.

The root filesystem is read-only. Only the report store, `/tmp` and `/run/lims` are writable.

## Checks

`pnpm check:deploy` does four things:

- typechecks `deploy/`;
- runs `deploy/`'s tests: the mount check against fixtures, and the data-class rules;
- runs the mount check on every compose file, with each override layered on it;
- runs `apps/web`'s bundle test, which fails if a production build contains the gallery or a module marked `lims-demo-aid`.

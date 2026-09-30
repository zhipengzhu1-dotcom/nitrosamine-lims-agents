# Deploying the demo

The owner's runbook for the first deploy on the Mac, per [ADR 0002](../docs/adr/0002-react-spa-fastify-postgres-hosted-on-the-owners-mac-then-a-us-vps.md) and decision [#34](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/34). Every box below is the owner's to tick. Each script takes `--dry-run`, which prints what it would do and changes nothing. Run that first.

## What runs

| Service | Image | Networks | Reaches |
|---|---|---|---|
| `tunnel` | `cloudflare/cloudflared`, pinned by digest | edge, egress | Cloudflare, and `web` |
| `web` | Caddy with the Vite build of `apps/web` and the Caddyfile baked in | edge only | `api` |
| `api` | Node 24 running `apps/api/src/server.ts` | db, edge, egress | Postgres, and later the Worker |
| `db-init` | the `api` image, run once per start | db only | Postgres |
| `postgres` | PostgreSQL 18.6, pinned by digest | db only | nothing |

- **Nothing is published on the Mac.** `db` and `edge` are internal networks with no route out. The only way in is the tunnel, which dials out to Cloudflare.
- **Named volumes only.** `pgdata` holds the database, `reports` the report store. `pnpm check:deploy` fails on any bind mount, so no container can reach the repo folder or the real instrument exports in it. The Colima VM mounts only the secrets folder, read-only, so the VM can't see them either.
- **The app never connects as owner or superuser.** `db-init` creates the roles through `packages/db`'s runner, sets the passwords of `lims_migrator` and `lims_app`, and applies the migrations. The API container is given only `lims_app`'s password. `lims_owner` can't log in.
- **Base images are pinned by digest**, and each digest is a multi-arch index covering arm64 (the Mac) and amd64 (the VPS). Bump them monthly, and critical fixes within 7 days (ADR 0002 "Patching").

## First deploy on the Mac

### 1. Tools, VM and clock

- [ ] `deploy/mac/bootstrap.sh --dry-run`, read it, then `deploy/mac/bootstrap.sh`.
  - It installs `colima docker docker-compose docker-buildx cloudflared` from Homebrew. Docker Desktop stays unused: its free licence doesn't cover the company.
  - It starts the Colima profile `lims` (4 CPUs, 6 GiB, 60 GiB disk) with only the secrets folder mounted.
  - It installs chrony in the VM with NTS against `time.cloudflare.com` and `makestep 1 -1`, then waits until the clock is within 1 s.
  - It is safe to rerun. Rerun it after a macOS or Colima upgrade.

### 2. Secrets

All of these live in `~/.config/nitrosamine-lims/secrets/` (folder 700, files 600), outside the repo. None is ever committed. `start.sh` refuses to launch if one is missing or readable by anyone else.

- [ ] `deploy/mac/secrets.sh --dry-run`, then `deploy/mac/secrets.sh`. It creates the ones that are random values and never overwrites an existing file:
  - `db_superuser_password`, `db_migrator_password`, `db_app_password`
  - `totp_encryption_key`, `password_pepper`
  - `worker_upload_token`, `worker_alarm_token`. When the Worker is deployed, give it the same two values with `wrangler secret put`.
- [ ] Check that `age_public_key` is already there. It was made on 2026-09-30 (#34). The private key stays offline.
- [ ] Store a copy of the TOTP key and the pepper in the password manager. Losing either locks out every account, and nothing else backs them up yet.

### 3. The Cloudflare Tunnel

- [ ] `cloudflared tunnel login`. The browser opens. Choose `nitrolims-demo.com`.
- [ ] `cloudflared tunnel create nitrolims-demo`. Note the tunnel id it prints.
- [ ] Move the credentials into the secrets folder:
  `mv ~/.cloudflared/<TUNNEL_ID>.json ~/.config/nitrosamine-lims/secrets/tunnel_credentials.json && chmod 600 ~/.config/nitrosamine-lims/secrets/tunnel_credentials.json`
- [ ] Render the config:
  `sed 's/<TUNNEL_ID>/<the id>/' deploy/cloudflared/config.yml.template > ~/.config/nitrosamine-lims/secrets/cloudflared.yml && chmod 600 ~/.config/nitrosamine-lims/secrets/cloudflared.yml`
- [ ] `cloudflared tunnel route dns nitrolims-demo nitrolims-demo.com`. This adds the DNS record that points the domain at the tunnel.
- [ ] Move `~/.cloudflared/cert.pem` into the password manager and delete it from disk. It can create and delete tunnels on the account, and the running tunnel doesn't need it.
- [ ] In the Cloudflare dashboard for the zone, turn on *Always Use HTTPS* and set the minimum TLS version to 1.2.

### 4. Smoke test on this Mac only

- [ ] `deploy/mac/start.sh --local`. Caddy answers on `http://127.0.0.1:8080` and nowhere else.
- [ ] Open it and check that the page loads with the "fictional data only" banner.
- [ ] `deploy/mac/stop.sh`. It stops the containers and keeps the volumes.

### 5. Go live through the tunnel

- [ ] Commit everything. `start.sh` refuses a tunnel launch from a working tree with uncommitted changes, because a release is built from a commit.
- [ ] `deploy/mac/start.sh --dry-run`, then `deploy/mac/start.sh`. It prints the data class, refuses unless FileVault is on, secrets are owner-only and chrony is synced, builds and starts everything, and lists the images.
- [ ] Open `https://nitrolims-demo.com` from another network, such as a phone off Wi-Fi.

### 6. The first Release Log entry

The owner signs this *Approved* before anyone else is told the address. The skeleton has no Release Log record yet, so until it does, post the entry as a comment on [#24](https://github.com/zhipengzhu1-dotcom/09-28-2026-LIMS/issues/24) from the owner's account. It records:

- [ ] The commit, and the image ids `start.sh` printed for `api` and `web`. Also the pinned digests of `postgres` and `cloudflared` from `compose.yaml`, and of the `node` and `caddy` bases from the Dockerfiles.
- [ ] The CI results: `pnpm typecheck`, `pnpm test` and `pnpm check:deploy`, all green. The OWASP ZAP baseline scan isn't built yet. Record it as not run.
- [ ] Data class `fictional`.
- [ ] The signed demo exceptions, each with its lapse condition, all to be reviewed by 2027-03-30:
  - **Two-role.** The owner is both Platform Operator and Admin, so the operator can read the TOTP key and pepper. It lapses before any second person or real data.
  - **Anchoring** (accepted 2026-09-30). Nothing off the Mac proves the audit chains weren't rewritten. It lapses before real data or the VPS move.
  - **FileVault** (accepted 2026-09-30). The recovery key is escrowed to iCloud, so Apple could unlock the disk that also holds the real instrument exports. It lapses before any real data enters the LIMS.
  - **Plaintext at Cloudflare.** The tunnel sees every request, passwords and TOTP codes included. It ends with the grey-cloud VPS.

## Starting as `real`

Not now. `start.sh --data-class real` refuses unless `sudo fdesetup haspersonalrecoverykey` prints `true`, and the server refuses unless anchoring is live. Changing the data class takes its own signed Release Log entry that lists every exception above as lapsed, plus the penetration test and the supplier quality agreements.

## Not built in the skeleton

These are in ADR 0002, and nothing here does them yet. Each needs its own ticket before real data.

- **Anchoring.** The Worker that sends chain heads to S3 Object Lock every 15 minutes. It is deferred under the anchoring exception.
- **Backups.** The nightly `age`-encrypted `pg_dump`, the report store and the operator logs, sent to R2 through the Worker. Until this exists, the named volumes on this Mac are the only copy. The 24-hour RPO isn't met, and there is no restore drill.
- **The Worker itself**: its upload and alarm endpoints, the alarm email, and its off-server checks. The two tokens above are ready for it.
- **pgaudit.** ADR 0002 logs every owner-role statement with pgaudit. The official Postgres image doesn't include it. Only `log_connections` is on, and nothing ships the logs yet.
- **Clock-step System Incidents.** chrony steps the clock and logs it in the VM, but nothing carries a step into the company chain yet.
- **The ZAP baseline scan** in CI.

## The VPS variant (inactive)

`compose.vps.yaml` layered over `compose.yaml` is the Lightsail shape. It uses `Caddyfile.vps`, where Caddy terminates TLS for `nitrolims-demo.com` on ports 80 and 443 and keeps its certificates in the `caddy_data` volume. The tunnel profile stays off, and DNS is grey-cloud.

```sh
LIMS_SECRETS_DIR=/etc/nitrosamine-lims/secrets LIMS_DATA_CLASS=fictional \
  docker compose -f deploy/compose.yaml -f deploy/compose.vps.yaml up -d --build
```

Don't run it before the move's gates in ADR 0002 are met: LUKS on the volumes, anchoring live, and chain-verify passing against the S3 anchors. The move is a restore of the latest backup, which doesn't exist yet. Build the images for amd64 there, or with `docker buildx build --platform linux/amd64`.

## The API's runtime contract

Compose gives the API these, and `apps/api` reads them:

- **`PORT`** is `3000`. Caddy proxies `/api/*` there.
- **`PGHOST`, `PGPORT`, `PGDATABASE` and `PGUSER`** name the database and `lims_app`. The entrypoint writes the password into a pgpass file on a tmpfs and sets `PGPASSFILE`, so `connectionFor('lims_app', …)` works unchanged. node-postgres warns that pgpass support leaves in pg 9.
- **`LIMS_DATA_CLASS`** is `fictional` or `real`.
- **`LIMS_REPORT_STORE`** is the report-store volume.
- **`LIMS_*_FILE`** gives the paths of the TOTP key, the pepper, the two Worker tokens and the `age` public key.

The root filesystem is read-only. Only the report store, `/tmp` and `/run/lims` are writable.

## Checks

`pnpm check:deploy` typechecks `deploy/`, tests the mount check against fixtures, runs the check on every compose file with each override layered on it, and runs `apps/web`'s bundle test. That test fails if a production build contains the gallery or a module marked `lims-demo-aid`.

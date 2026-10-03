# Running the demo stack

This is the owner's runbook for the thin slice on the MacBook, per [ADR 0002](../docs/adr/0002-react-spa-fastify-postgres-hosted-on-the-owners-mac-then-a-us-vps.md). Compose runs five services, and a sixth on demand:

- `db` is PostgreSQL 18. Its data lives in the named volume `lims_pgdata`.
- `migrate` applies the migrations as the superuser, then exits.
- `api` is the Fastify API, signed in to Postgres as `lims_app`. It serves only `/api`.
- `seed` fills the empty database with the demo accounts. It runs only when you call it, as below.
- `caddy` serves the built web app and proxies `/api` to the API.
- `cloudflared` is the Cloudflare Tunnel, the only way in. No port is published on the Mac.

Every command below runs from the repo root.

## Before the first start

1. Start Colima (not Docker Desktop): `colima start --cpu 2 --memory 4`.
2. Make an owner-only secrets folder outside the repo, holding one file per secret. The folder is `0700`, so only you can reach it on the Mac. The files are `0644` because each container reads its secret as its own user.

   ```sh
   mkdir -m 700 ~/.lims-secrets
   openssl rand -hex 24 > ~/.lims-secrets/postgres    # superuser password, used only by migrate
   openssl rand -hex 24 > ~/.lims-secrets/lims_app    # the API's database password
   chmod 644 ~/.lims-secrets/*
   ```

   Use hex passwords. They go into a connection URL unescaped.
3. In the Cloudflare dashboard, create a tunnel (Zero Trust, Networks, Tunnels). Point its public hostname at `http://caddy:80`. Save its token: `pbpaste > ~/.lims-secrets/tunnel_token`.
4. Export the folder in the shell you run Compose from: `export SECRETS_DIR=~/.lims-secrets`.

## Start, seed and stop

```sh
docker compose -f deploy/compose.yaml up -d --build
docker compose -f deploy/compose.yaml run --rm seed
```

The seed runs once, on the empty database. It prints the demo accounts and the one password they share, and it refuses a second run. To choose the password yourself, add `-e DEMO_PASSWORD=...` before `seed`. Keep the printout. Nothing shows it again.

To check the stack, run `docker compose -f deploy/compose.yaml ps`. `migrate` should read `exited (0)` and the others `running`. Then sign in as QA through the tunnel's hostname, open a Test Report and press **Verify Audit Trail**.

To stop it, run `docker compose -f deploy/compose.yaml down`. Never add `-v`: it deletes the volumes, and with them every record and the Audit Trail.

## Updating

- **After a code change**, run `up -d --build` again. The `migrate` service applies any new migration before the API starts.
- **After the update that adds the Release Log** (migration `0028_release_log.sql`), on a database seeded before it, the service identities stay unscoped, as they were before #102. This is acceptable only because the stack holds fictional data. The migration records the entry "Service identities of the API and the seed", unapproved. The service identities are held to their scopes once a Platform Operator approves an entry that declares a service identity, such as that one. Approving an entry that declares no service identity leaves them unscoped, and sign-in keeps working. No account on such a database holds Platform Operator: the seed before 0028 granted the role to no one, and no route grants it. The owner chooses between two ways forward. One is to re-seed on a fresh volume, whose seed approves its own identities entry; this deletes the data, so it is the owner's decision. The other is to grant the role through a route that a later build adds, and then approve the entry by reading its ID and Record Version from `GET /api/release-log` and signing it with `POST /api/release-log/approvals`.
- **To patch images** (monthly, critical fixes within 7 days), look up the new digest of each base image and edit it in `deploy/Dockerfile` and `deploy/compose.yaml`. One way to read a digest is `docker buildx imagetools inspect postgres:18-alpine`.
- **To validate the config without starting anything**, run `docker compose -f deploy/compose.yaml config`.

## If something fails

- **`cloudflared` or `db` logs "permission denied" on `/run/secrets/...`.** Compose mounts each secret with its file's mode, so check the files are `0644` inside the `0700` folder.
- **`db` was first started before `lims_app` existed in the secrets folder.** The role password is set only when the volume is first made. Set it by hand: `docker compose -f deploy/compose.yaml exec db psql -U postgres -c "alter role lims_app password '<the file's contents>'"`.

## Not covered yet

Backups to R2, audit-chain anchoring, chrony, System Incident alerts, the Release Log and the VPS move are all in ADR 0002 but outside this slice. This stack holds fictional data only.

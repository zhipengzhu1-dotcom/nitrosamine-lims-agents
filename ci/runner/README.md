# CI runners

CI's `check` and `e2e` jobs run on self-hosted GitHub Actions runners in Docker on the owner's Mac, never on GitHub-hosted runners. `.github/workflows/ci.yml` sends the `check` job to the runner labels `self-hosted` and `lims-check`, and the `e2e` job to `self-hosted` and `lims-e2e`. While no runner is online, a job waits in the queue.

## How it works

`scripts/ci-runner.sh start` starts two slots, `check` and `e2e`, one for each job, so both jobs of a run can run at once. A slot runs only its own job (see Resources). Each slot is a loop on the Mac:

1. It asks GitHub for a just-in-time runner configuration with `gh api`. The configuration registers one ephemeral runner, `lims-runner-<slot>-<time>`, which takes one job and then deregisters.
2. It starts a fresh container, `lims-runner-<slot>`, from the `lims-runner` image with that configuration as an argument.
3. The job checks out the repo, starts PostgreSQL inside the container with `scripts/pg.sh start`, and runs its steps.
4. When the job ends, the container exits and Docker removes it (`--rm`), with its workspace and its PostgreSQL cluster. The loop starts again at step 1.

The loop is the restart policy. A Docker restart policy restarts the same container, which keeps the last job's files and holds a registration that GitHub has already deleted.

The image (`Dockerfile`) is GitHub's `ghcr.io/actions/actions-runner`, pinned by digest for linux/arm64, with PostgreSQL 18.6 from the PGDG packages, pinned by package version. CI's service container used to pin the `postgres:18.6` image by digest, but that image is Debian trixie (glibc 2.41), so its server binaries are built against a newer C library than this Ubuntu 24.04 image has (glibc 2.39). PGDG builds the same release for both. The jobs use no Docker of their own, so the image has no Docker socket and no service containers. A service container would publish its port on the Docker VM, where the runner container's `localhost` cannot reach it, and the socket would give every job control of the Mac's Docker.

## Before the first start

You need:

- Docker Desktop running.
- The GitHub CLI signed in as an admin of `zhipengzhu1-dotcom/09-28-2026-LIMS`. Check with `gh auth status`.

The registration comes from `gh api` at each pass of the loop and passes to the container as an argument. Nothing writes it to the repo or to a file on the Mac. While its container runs, Docker holds it in the container's configuration, `ps` and `docker inspect` show it, and the job can read it. That exposure is accepted because the registration admits one runner for one job, and the container's removal deletes it.

## Build the image

Run this from the repo root on the first start and after every change to `Dockerfile`:

```sh
scripts/ci-runner.sh build
```

## Register and start the runners

```sh
scripts/ci-runner.sh start
```

Each slot registers its runner and starts its container. The slots keep running after you close the terminal. They stop when the Mac restarts, so run `start` again after a restart.

## Check the runners

```sh
scripts/ci-runner.sh status
```

It prints one line for each registered runner, with its name, `online` or `offline`, and whether it is running a job. Each slot's log is in `~/Library/Logs/lims-runner/<slot>.log`, and `docker ps --filter name=lims-runner-` shows the containers.

## Stop the runners

```sh
scripts/ci-runner.sh stop
```

It stops the slot loops, removes the containers, and deletes the `lims-runner-*` registrations from the repo. A job that is running is cancelled, and GitHub shows it as failed. To let running jobs finish first, wait until `status` shows no runner as busy.

## Update the runners

Update in the monthly patch round that ADR 0002 sets for image digests. GitHub refuses a runner that is too far behind its latest release.

1. Find the new arm64 digest:

   ```sh
   docker buildx imagetools inspect ghcr.io/actions/actions-runner:latest
   ```

   Copy the digest of the `linux/arm64` manifest into the `FROM` line of `Dockerfile`, and set the tag to the runner version it holds:

   ```sh
   docker run --rm ghcr.io/actions/actions-runner@<digest> ./config.sh --version | grep -x '[0-9.]*'
   ```

2. If CI's PostgreSQL version changes, set the `postgresql-18=` version in `Dockerfile` to a version that this command lists:

   ```sh
   docker run --rm -u root lims-runner bash -c 'apt-get update -qq && apt-cache madison postgresql-18'
   ```

   On 2026-10-02 PGDG still listed 18.3 and 18.4 beside 18.6, so a build keeps working after a newer release. If a pinned version ever leaves the list, PGDG keeps every version at `apt-archive.postgresql.org`.

3. Merge the change through a pull request, then restart the runners on the new image:

   ```sh
   scripts/ci-runner.sh stop
   scripts/ci-runner.sh build
   scripts/ci-runner.sh start
   ```

## Resources

The Mac's Docker VM has 14 CPUs and about 8 GB of memory. On 2026-10-02 a `check` job and an `e2e` job ran side by side in two containers of this image and both passed: `check` peaked near 0.6 GB in 81 seconds and `e2e` near 4.3 GB in 186 seconds. Two `e2e` jobs at once, each capped at 3.5 GB, failed when the web server stopped mid-walk. So each job type has one slot, and a second `e2e` job waits for the first. Each container gets 1 GB of shared memory (`--shm-size`) for PostgreSQL and the browsers.

The walk itself takes about 30 of the 186 seconds of an `e2e` job. The rest installs Node, the packages, the browsers and their system packages, because each job starts from a fresh container.

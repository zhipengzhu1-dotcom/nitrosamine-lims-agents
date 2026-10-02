# The CI runner: GitHub's runner image with PostgreSQL 18.6 inside, so each job starts its own cluster on the
# container's localhost and the cluster goes when the container does. See README.md.
FROM ghcr.io/actions/actions-runner:2.337.0@sha256:f5a0d9a3d857315f2aed7075a02a29f46927ad198221c3b1c66585ae9fe36c0d

USER root
# The pinned postgres:18.6 image is Debian trixie (glibc 2.41) and this one is Ubuntu 24.04 (glibc 2.39), so the
# server comes from the same PGDG packages built for Ubuntu, pinned to the same release.
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-common \
  && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
  && echo 'create_main_cluster = false' >> /etc/postgresql-common/createcluster.conf \
  && apt-get install -y --no-install-recommends postgresql-18=18.6-1.pgdg24.04+2 \
  && apt-mark hold postgresql-18 \
  && rm -rf /var/lib/apt/lists/*
# The server writes its socket lock in /var/run/postgresql, which only the postgres group may write.
RUN usermod -aG postgres runner
USER runner

ENV PGBIN=/usr/lib/postgresql/18/bin

---
outline: deep
---

# Setup

## Docker quick start

NPM Improved v1.1.0 publishes official stable multi-architecture images and includes the built-in **Settings → Update** manager. The repository also retains production Compose files and the Docker installer for first installation, source builds, and recovery.

Requirements:

- Docker Engine 24 or newer;
- Docker Compose v2;
- Git;
- TCP ports 80, 81, and 443 available on the host unless you change the host mappings.

Clone the repository and prepare the environment file:

```bash
git clone https://github.com/gigabytegrove/npm-improved.git
cd npm-improved
```

The production Docker build is self-contained. A clean checkout does not require a separate frontend build. The installer creates `.env` automatically when needed and checks host-port availability before starting the build.

## SQLite deployment

SQLite is the simplest deployment and is the default `compose.yaml` stack:

```bash
./scripts/install-docker sqlite
```

Persistent data is stored in:

```text
./data
./letsencrypt
```

Inside the application container these map to:

```text
/data
/etc/letsencrypt
```

The SQLite database is stored at:

```text
/data/database.sqlite
```

Open the management interface at:

```text
http://<host>:81
```

## Port conflicts

The installer refuses to build/start when a configured host port is already occupied and shows the listener information it can identify. It does not stop or replace an existing service automatically.

For a parallel test deployment, choose unused host-side ports in `.env`, for example:

```dotenv
HTTP_PORT=8080
ADMIN_PORT=8181
HTTPS_PORT=8443
```

Then rerun `./scripts/install-docker sqlite`. Internal container ports remain 80, 81, and 443.

## MariaDB / MySQL deployment

Edit `.env` and set both database passwords:

```dotenv
MYSQL_PASSWORD=<strong-unique-password>
MYSQL_ROOT_PASSWORD=<strong-unique-root-password>
```

The MariaDB Compose stack refuses to start while either password is blank.

Then start the MariaDB stack:

```bash
./scripts/install-docker mysql
```

The database is persisted under:

```text
./mariadb
```

The application receives the existing `DB_MYSQL_*` environment variables from the Compose definition.

## Change databases later from the UI

You do not have to reinstall NPM Improved just because your database needs change.

After installation, open **Settings → Database & Storage** to:

- move SQLite to MySQL/MariaDB;
- move MySQL/MariaDB back to SQLite;
- join an existing Shared MySQL deployment;
- test and inspect a target database before switching.

The wizard copies and verifies data before changing the active database and leaves the original source database in place.

See [Database & Shared MySQL](/guide/database).

## PostgreSQL deployment

Edit `.env` and set the PostgreSQL password:

```dotenv
POSTGRES_PASSWORD=<strong-unique-password>
```

The PostgreSQL Compose stack refuses to start while the password is blank.

Then start the PostgreSQL stack:

```bash
./scripts/install-docker postgres
```

The database is persisted under:

```text
./postgres
```

The application receives the existing `DB_POSTGRES_*` environment variables from the Compose definition. Custom PostgreSQL schemas are not supported; the normal `public` schema is used.

## Ports

The production container uses:

| Container port | Purpose |
| --- | --- |
| 80 | HTTP traffic |
| 81 | NPM Improved management control plane |
| 443 | HTTPS traffic |

Host-side mappings are configured in `.env`:

```dotenv
HTTP_PORT=80
ADMIN_PORT=81
HTTPS_PORT=443
```

`ADMIN_PORT` changes the host mapping only. The standalone control plane remains on port 81 inside the container.

## Time zone and IPv6

`.env.example` includes:

```dotenv
TZ=Etc/UTC
DISABLE_IPV6=false
```

Set `TZ` to the host's preferred IANA time zone. Set `DISABLE_IPV6=true` only when IPv6 should be disabled in the NPM Improved container.

## Initial administrator

If no active users exist, the UI presents the first-user setup flow.

For automated initialization, set both values in `.env`:

```dotenv
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD=use-a-strong-password
```

Leave both blank to use the interactive first-user setup.

## Automated encrypted backups

Scheduled encrypted backups can be enabled from the deployment environment:

```dotenv
NPM_BACKUP_PASSPHRASE=replace-with-a-passphrase-of-at-least-12-characters
NPM_BACKUP_SCOPE=disaster-recovery
NPM_BACKUP_INTERVAL_HOURS=24
NPM_BACKUP_RETENTION=7
```

Retained bundles are written under:

```text
/data/backups
```

Keep a copy of disaster-recovery backups off the Docker host. A backup stored only on the same disk does not protect against host or storage loss.

See [Backup & Disaster Recovery](../guide/disaster-recovery.md).

## Healthcheck

All production Compose definitions use the container healthcheck:

```yaml
healthcheck:
  test: ["CMD", "/usr/bin/check-health"]
  interval: 10s
  timeout: 3s
  retries: 12
  start_period: 30s
```

The independent control plane also exposes:

```text
/__npm_improved/health
```

## Updating

Before upgrading, back up `./data`, `./letsencrypt`, and the external database data when MariaDB or PostgreSQL is used.

For normal single-node Docker installations running v1.1.0 or newer, open **Settings → Update**. The page checks the official stable release, shows release notes and progress, replaces only the application container through a temporary self-cleaning Docker handoff, and verifies the new container before reporting success. A failed health/build verification triggers automatic rollback to the previous image configuration.

The first move from v1.0.0 to v1.1.0 still uses the installer because v1.0.0 does not contain the Update manager:

```bash
git checkout develop
git pull --ff-only
./scripts/install-docker sqlite
```

Use `mysql` or `postgres` instead of `sqlite` for those underlying deployments. Add `--clean-build` only when a cache-free source rebuild is intentionally required.

Shared MySQL and Instance Synchronization deployments are updated as coordinated maintenance operations rather than through the single-node Update action.

If **Settings → Database & Storage** selected a runtime database, that selection is stored under `/data` and survives the rebuild.

After an upgrade, verify the Control Center, Proxy Hosts, certificates, Streams, Database & Storage, logs, System Health, and any HA/synchronization features you rely on.

## Logs and status

SQLite:

```bash
docker compose ps
docker compose logs -f app
```

For MariaDB or PostgreSQL, include the matching Compose file in the command.

## Development environment

The production Compose definitions are not the development stack.

For development, the repository retains the upstream-style multi-service environment:

```bash
./scripts/start-dev
```

By default, the development admin UI is exposed on port `3081` and the development Nginx traffic listener on port `3080`.

Stop it with:

```bash
./scripts/stop-dev
```

## Building only the production image

To build the local image without starting Compose:

```bash
./scripts/buildx --load -t npm-improved:dev
```

The production Dockerfile builds the frontend and standalone Go control plane as part of the image build.

See the [Docker installation guide on GitHub](https://github.com/gigabytegrove/npm-improved/blob/develop/DOCKER.md) for the copy-and-run deployment commands.

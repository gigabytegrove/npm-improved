---
outline: deep
---

# Setup

## Docker quick start

NPM Improved is currently pre-1.0 and does not yet publish a stable container image. The repository includes production Compose files that build the image directly from the checked-out source.

Requirements:

- Docker Engine 24 or newer;
- Docker Compose v2;
- Git;
- TCP ports 80, 81, and 443 available on the host unless you change the host mappings.

Clone the repository and prepare the environment file:

```bash
git clone https://github.com/gigabytegrove/npm-improved.git
cd npm-improved
cp .env.example .env
```

The production Docker build is self-contained. A clean checkout does not require a separate frontend build.

## SQLite deployment

SQLite is the simplest deployment and is the default `compose.yaml` stack:

```bash
docker compose up -d --build
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

## MariaDB / MySQL deployment

Edit `.env` and replace at least:

```dotenv
MYSQL_PASSWORD=CHANGE_ME
MYSQL_ROOT_PASSWORD=CHANGE_ME_ROOT
```

Then start the MariaDB stack:

```bash
docker compose -f compose.mysql.yaml up -d --build
```

The database is persisted under:

```text
./mariadb
```

The application receives the existing `DB_MYSQL_*` environment variables from the Compose definition.

## PostgreSQL deployment

Edit `.env` and replace at least:

```dotenv
POSTGRES_PASSWORD=CHANGE_ME
```

Then start the PostgreSQL stack:

```bash
docker compose -f compose.postgres.yaml up -d --build
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

SQLite:

```bash
git pull --ff-only
docker compose up -d --build
```

MariaDB:

```bash
git pull --ff-only
docker compose -f compose.mysql.yaml up -d --build
```

PostgreSQL:

```bash
git pull --ff-only
docker compose -f compose.postgres.yaml up -d --build
```

After an upgrade, verify the management control plane, proxy hosts, certificates, streams, logs, and System Health.

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

See the root [Docker installation guide](../../../DOCKER.md) for the copy-and-run deployment commands.

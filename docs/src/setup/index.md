---
outline: deep
---

# Setup

## Docker quick start

Fresh installs use the published **v1.8.0** release images for Linux amd64 and arm64. The installer pulls the official GHCR image, falls back to the SHA-256-verified GitHub Release image archive if necessary, and installs the matching native systemd updater. No Git clone, source compilation, Docker build, or Buildx invocation is needed. Deployment files are installed in `/opt/npm-improved`. Existing installations are never overwritten.

Requirements: Linux amd64 or arm64 with systemd, Docker Engine 24 or newer, Docker Compose v2 supporting `up --wait-timeout`, curl, Python 3, CA certificates, gzip and iproute2.

## SQLite deployment

```bash
(
  set -e
  installer="$(mktemp)"
  trap 'rm -f "$installer"' EXIT
  curl -fsSL https://raw.githubusercontent.com/gigabytegrove/npm-improved/develop/scripts/install-release -o "$installer"
  sudo bash "$installer" sqlite --auto-ports
)
```

Open the management URL printed at completion, on a trusted network. Persistent data is stored under `/opt/npm-improved/data` and `/opt/npm-improved/letsencrypt`.

## Port conflicts

The installer does not stop existing services. `--auto-ports` selects free alternative mappings and saves them in `.env`; omit it to require ports 80, 81 and 443.

## MariaDB / MySQL deployment

```bash
(
  set -e
  installer="$(mktemp)"
  trap 'rm -f "$installer"' EXIT
  curl -fsSL https://raw.githubusercontent.com/gigabytegrove/npm-improved/develop/scripts/install-release -o "$installer"
  sudo bash "$installer" mysql --auto-ports
)
```

Database passwords are generated automatically and stored in the root-only `/opt/npm-improved/.env`. Database data is persisted in `./mariadb` relative to the deployment directory.

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

```bash
(
  set -e
  installer="$(mktemp)"
  trap 'rm -f "$installer"' EXIT
  curl -fsSL https://raw.githubusercontent.com/gigabytegrove/npm-improved/develop/scripts/install-release -o "$installer"
  sudo bash "$installer" postgres --auto-ports
)
```

The installer generates the database password and persists database data under `./postgres` relative to the deployment directory. The default PostgreSQL schema is `public`.

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

For existing managed installations, open **Settings → Update**. The native systemd updater pulls published images and verifies the replacement before reporting success, with automatic rollback on failure. It does not run a helper updater container.

The fresh installer refuses to overwrite an existing deployment. For legacy recovery or coordinated Shared MySQL upgrades, use the target release notes and preserve the existing Compose project, database and persistent storage. Do not rebuild images for normal production upgrades.

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

## Developer-only local image build (not installation)

To build the local image without starting Compose:

```bash
./scripts/buildx --load -t npm-improved:dev
```

The production Dockerfile builds the frontend and standalone Go control plane as part of the image build.

See the [Docker installation guide on GitHub](https://github.com/gigabytegrove/npm-improved/blob/develop/DOCKER.md) for the copy-and-run deployment commands.

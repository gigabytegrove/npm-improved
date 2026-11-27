---
outline: deep
---

# Setup

## Docker quick start

NPM Improved runs as Linux containers on Docker. It is not tied to Ubuntu, Debian, or an x86-64 host OS. The v1.8.0 deployment targets **linux/amd64 and linux/arm64**. Use a compatible Docker Engine or Docker Desktop in Linux-container mode, including supported Linux distributions, Windows, macOS, and NAS platforms. Windows-native containers and other CPU architectures are not supported by these images. Host networking, storage permissions, and capability restrictions vary by platform.

### Standard Docker Compose (recommended for portable deployment)

Requires Docker and Docker Compose v2. No systemd, Linux package manager, Git clone, compilation, or local image build is needed.

Create a dedicated project directory and save [compose.yaml](https://github.com/gigabytegrove/npm-improved/blob/develop/deploy/compose.yaml) into it as `compose.yaml` (use **Raw** or download the file on GitHub). This SQLite template contains only published image references and persistent mounts. From that directory, run these commands in your usual terminal, including PowerShell:

```bash
docker compose pull
docker compose up -d --no-build --pull never --wait --wait-timeout 240
docker compose ps
```

Open `http://localhost:81` on the Docker host, or port 81 on the remote Docker host. For alternate host ports, create a file named `.env` next to the Compose file:

```dotenv
HTTP_PORT=8080
ADMIN_PORT=8181
HTTPS_PORT=8443
```

For example, the management UI then uses port 8181. Use the same project directory for all future operations.

**Security:** Restrict the management port to a trusted network or VPN. The default SQLite template includes the release's firewall companion, which requires Docker support for `NET_ADMIN` in the application network namespace. If your host cannot grant this capability, explicitly deploy only the app with `docker compose pull app` followed by `docker compose up -d --no-build --pull never --wait app`; the companion's instance-level network filtering is then unavailable. Use an appropriate host firewall. This is a reduced-feature deployment, not a way to bypass a host security policy. Docker Desktop and NAS deployments must provide persistent writable storage with Linux-compatible file permissions. For clustered deployments set a unique `NPM_NODE_HOSTNAME` in `.env`.

If a registry pull fails, stop and use the verified release archive recovery path in the Docker guide; never build from source.

### Optional managed installation on Linux hosts with systemd

For native **Settings → Update** support, use the managed host installer on a Linux Docker host running systemd. Install Docker, Compose v2, Bash, curl, Python 3, CA certificates, gzip, and iproute2 using your distribution's package tools. No Ubuntu or Debian requirement applies. The installer uses published images, automatically selects free ports with `--auto-ports`, and installs the native updater. It refuses to overwrite an existing project.

```bash
(
  set -e
  installer="$(mktemp)"
  trap 'rm -f "$installer"' EXIT
  curl -fsSL https://raw.githubusercontent.com/gigabytegrove/npm-improved/develop/scripts/install-release -o "$installer"
  sudo bash "$installer" sqlite --auto-ports
)
```

Use `mysql` or `postgres` for a managed database deployment. This path stores the deployment in `/opt/npm-improved`. The portable Compose path does not provision the native updater.

## MariaDB / MySQL deployment

Save [compose.mysql.yaml](https://github.com/gigabytegrove/npm-improved/blob/develop/deploy/compose.mysql.yaml) and configure unique `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD` in `.env` before running:

```bash
docker compose -f compose.mysql.yaml pull
docker compose -f compose.mysql.yaml up -d --no-build --pull never --wait --wait-timeout 240
```

Data persists under `./mariadb`.

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

Save [compose.postgres.yaml](https://github.com/gigabytegrove/npm-improved/blob/develop/deploy/compose.postgres.yaml) and configure a unique `POSTGRES_PASSWORD` in `.env` before running:

```bash
docker compose -f compose.postgres.yaml pull
docker compose -f compose.postgres.yaml up -d --no-build --pull never --wait --wait-timeout 240
```

Data persists under `./postgres`. The default PostgreSQL schema is `public`.

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

For portable Compose deployments, back up your project, change the pinned image tags to the intended release, pull them, and recreate the same stack using `up -d --no-build --pull never --wait` (include the matching `-f` option for database variants). The portable path has no native host updater. For existing managed installations, open **Settings → Update**. The native systemd updater pulls published images and verifies the replacement before reporting success, with automatic rollback on failure. It does not run a helper updater container.

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

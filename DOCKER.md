# Docker installation

NPM Improved includes production-ready Docker Compose definitions in the repository root.

> NPM Improved v1.1.0 publishes official stable multi-architecture images and includes the built-in **Settings → Update** manager. The Docker installer remains supported for first installation and recovery.

## Requirements

- Docker Engine 24 or newer
- Docker Compose v2
- Git
- TCP ports 80, 81, and 443 available on the host, unless overridden in `.env`

## Quick start: SQLite

```bash
git clone https://github.com/gigabytegrove/npm-improved.git
cd npm-improved
./scripts/install-docker sqlite
```

The installer creates `.env` from `.env.example` when needed, validates Docker/Compose, checks host-port availability before the build starts, launches the stack, and waits for the application healthcheck.

Open:

```text
http://<host>:81
```

The default deployment uses SQLite at `/data/database.sqlite`.

## Port conflicts

The installer checks the configured host ports before building. It never stops an existing service automatically. When a port is occupied it detects free alternatives on that specific host instead of suggesting fixed port numbers.

If configured ports are already in use because NPM Improved is being tested alongside another reverse proxy, the installer prints free host-side mappings it found. To apply those detected mappings automatically and continue:

```bash
./scripts/install-docker sqlite --auto-ports
```

The selected ports are written to `.env`. The internal container ports remain 80, 81, and 443.

To inspect a conflict manually:

```bash
ss -ltnp | grep -E ':(80|81|443)\\b' || true
docker ps --format 'table {{.Names}}\\t{{.Ports}}'
```

## Change databases from the UI

NPM Improved can switch its active database after installation from **Settings → Database & Storage**.

The wizard can:

- copy SQLite to MySQL/MariaDB;
- copy MySQL/MariaDB back to SQLite;
- join an existing shared NPM Improved MySQL database;
- test the destination before switching;
- preserve the original source database if the migration fails.

Selections made in the UI are stored in `/data/database-config.json` and take precedence over the container's DB environment variables until **Use deployment database settings** is selected.

For multi-server Shared MySQL deployments, all nodes must use the same NPM Improved version and must also share or replicate certificate/custom assets. See [Database & Shared MySQL](docs/src/guide/database.md).

## MariaDB / MySQL

Copy and edit the environment file first. Set both `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD`. The MariaDB Compose stack refuses to start while either value is blank.

```bash
cp .env.example .env
# Set MYSQL_PASSWORD and MYSQL_ROOT_PASSWORD in .env
./scripts/install-docker mysql
```

## PostgreSQL

Copy and edit the environment file first. Set `POSTGRES_PASSWORD`. The PostgreSQL Compose stack refuses to start while it is blank.

```bash
cp .env.example .env
# Set POSTGRES_PASSWORD in .env
./scripts/install-docker postgres
```

## Persistent data

The application stores persistent state in:

```text
./data          -> /data
./letsencrypt   -> /etc/letsencrypt
```

Database-backed deployments also use:

```text
./mariadb       -> /var/lib/mysql
./postgres      -> /var/lib/postgresql/data
```

Do not delete these directories during upgrades.

## Configuration

Host-facing ports are controlled through `.env`:

```dotenv
HTTP_PORT=80
ADMIN_PORT=81
HTTPS_PORT=443
```

The internal management listener remains on port 81. Changing `ADMIN_PORT` changes only the host-side mapping.

Optional first-user bootstrap:

```dotenv
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD=replace-with-a-strong-password
```

Leave both values blank to use the interactive first-user setup.

## Automated encrypted backups

Scheduled encrypted backups can be enabled in `.env`:

```dotenv
NPM_BACKUP_PASSPHRASE=replace-with-a-passphrase-of-at-least-12-characters
NPM_BACKUP_SCOPE=disaster-recovery
NPM_BACKUP_INTERVAL_HOURS=24
NPM_BACKUP_RETENTION=7
```

Backups are retained under `/data/backups`. Copy disaster-recovery backups off the Docker host as part of your normal backup process.

## Updating (v1.4.1+)

NPM Improved uses **one application container**. It never launches a second
container to update, restart or roll back that application.

The trusted update runner is a **native Linux host-side systemd service**, installed
once into the Docker host. It is not an extra Docker image or service container.
The NPMi application writes an authenticated update request into its persistent
`/data` mount. A systemd path watcher notices it and executes the host runner
using the existing Docker Compose app service.

The host worker downloads the target NPMi image directly from GHCR (or the
checksum-verified release bundle), changes the app image in `.env`,
recreates only the app service, checks its Docker and control-plane health
and verifies the exact release version. Failures restore the previous
application image. No helper images are pulled from Docker Hub.

### One-time native host updater installation

Requirements: Linux host with systemd, root access for installation, Python 3,
Docker Engine and Docker Compose v2. **No Docker socket mount inside NPMi is
required.**

After installing NPM Improved from source as root on a systemd host, the
installer provisions the host watcher automatically. For existing installations
or an installer run without root access, run from a trusted repository checkout:

```bash
sudo ./scripts/install-host-updater /absolute/path/to/existing/npm-project
```

This creates a per-installation systemd service and path watcher. It does not
start any additional containers. Use `systemctl list-units 'npm-improved-update-*'`
to inspect native watcher status.

The older v1.4.0 updater still contains the `docker:27-cli` launcher. Before
the first v1.4.1 upgrade, existing deployments require a **one-time Compose
app-only upgrade on the host**, plus installation of this native updater. Keep
the current Compose project name, .env, data and certificates. After v1.4.1,
future updates work entirely through **Settings → Update**.

### Operational guarantees

- Current administrator password and Settings permissions are required.
- NPMX Primary/Secondary nodes can be updated **sequentially**, validating
  one node's health before updating the next; NPMX snapshot sync temporarily
  pauses when app versions differ.
- Shared MySQL database deployments retain the stricter coordinated upgrade
  restriction.
- Restarts and rollbacks use the same host-side worker.
- Rollback returns to the recorded previous NPMi image if verification fails.
- The worker runs the **root-owned installed script**, not arbitrary executable
  code from an application-writable directory.

### CLI update/recovery path

The source installer remains supported for manual recovery and rebuilds.
It preserves existing host-side data volumes:

```bash
cd /path/to/npm-improved
git pull --ff-only
sudo ./scripts/install-docker sqlite
```

Use `mysql` or `postgres` instead of `sqlite` when your actual Compose
deployment uses that underlying database mode. Do not run the source installer
against a custom production Compose layout without checking its configuration.

## Logs and status

```bash
docker compose ps
docker compose logs -f app
```

For the database variants, add the matching Compose file to the command.

The application container includes a healthcheck and the independent control-plane health endpoint remains available at:

```text
http://<host>:81/__npm_improved/health
```

## Stopping

SQLite:

```bash
docker compose down
```

MariaDB:

```bash
docker compose -f compose.mysql.yaml down
```

PostgreSQL:

```bash
docker compose -f compose.postgres.yaml down
```

`docker compose down` does not remove the bind-mounted persistent directories shown above.

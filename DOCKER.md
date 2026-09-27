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

## Updating

### Settings → Update

Beginning with v1.1.0, normal single-node Docker installations can update from **Settings → Update**.

The installer records the host project path and deployment mode in `.env` and mounts the Docker socket into the NPM Improved application container. Those settings allow the authenticated Update manager to launch a temporary Docker CLI handoff when the running application container must be replaced.

The handoff:

1. validates the deployment;
2. requires at least 512 MiB of free staging space;
3. pulls the requested official stable image;
4. preserves the current `.env`;
5. recreates only the application container;
6. waits for Docker health;
7. verifies the independent control-plane health endpoint and live build version;
8. restores the previous image configuration automatically when verification fails;
9. removes itself after the operation.

There is no permanently running updater/worker container.

Because Docker socket access is host-level privileged access, the browser is never given a Docker command interface. The authenticated backend exposes only the defined NPM Improved update/restart/rollback operations, and those operations require the current administrator password.

Shared MySQL and Primary/Secondary Instance Synchronization deployments are intentionally blocked from single-node automatic updates. Upgrade those nodes together during a coordinated maintenance window.

### CLI update/recovery path

The installer remains the supported CLI update and recovery path. Use the same target that matches the underlying deployment.

SQLite:

```bash
cd ~/npm-improved
git checkout develop
git pull --ff-only
./scripts/install-docker sqlite
```

MariaDB / MySQL:

```bash
cd ~/npm-improved
git checkout develop
git pull --ff-only
./scripts/install-docker mysql
```

PostgreSQL:

```bash
cd ~/npm-improved
git checkout develop
git pull --ff-only
./scripts/install-docker postgres
```

Add `--clean-build` only when a cache-free rebuild is intentionally required.

If the database was selected dynamically from **Settings → Database & Storage**, keep using the installer target for the underlying deployment. The saved runtime database selection under `/data` remains in place across the rebuild.

Before upgrading, keep a current backup of `./data`, `./letsencrypt`, and the external database volume when one is used.

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

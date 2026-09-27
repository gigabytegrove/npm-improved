# Docker installation

NPM Improved includes production-ready Docker Compose definitions in the repository root.

> NPM Improved is pre-1.0 and does not yet publish a stable container image. The Compose files build the image from the checked-out source.

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

The installer checks the configured host ports before building. It never stops an existing service automatically.

If ports 80, 81, or 443 are already in use because NPM Improved is being tested alongside another reverse proxy, edit `.env` and choose unused host-side ports, for example:

```dotenv
HTTP_PORT=8080
ADMIN_PORT=8181
HTTPS_PORT=8443
```

Then rerun:

```bash
./scripts/install-docker sqlite
```

The internal container ports remain 80, 81, and 443.

To inspect a conflict manually:

```bash
ss -ltnp | grep -E ':(80|81|443)\\b' || true
docker ps --format 'table {{.Names}}\\t{{.Ports}}'
```

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

For the current source-build installation model:

```bash
git pull --ff-only
docker compose up -d --build
```

For MariaDB:

```bash
git pull --ff-only
docker compose -f compose.mysql.yaml up -d --build
```

For PostgreSQL:

```bash
git pull --ff-only
docker compose -f compose.postgres.yaml up -d --build
```

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

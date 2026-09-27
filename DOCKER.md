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
cp .env.example .env
docker compose up -d --build
```

Open:

```text
http://<host>:81
```

The default deployment uses SQLite at `/data/database.sqlite`.

## MariaDB / MySQL

Copy and edit the environment file first. At minimum, replace `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD`.

```bash
cp .env.example .env
docker compose -f compose.mysql.yaml up -d --build
```

## PostgreSQL

Copy and edit the environment file first. At minimum, replace `POSTGRES_PASSWORD`.

```bash
cp .env.example .env
docker compose -f compose.postgres.yaml up -d --build
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

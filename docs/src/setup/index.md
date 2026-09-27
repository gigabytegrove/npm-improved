---
outline: deep
---

# Setup

## Current pre-1.0 installation model

NPM Improved does not currently advertise a stable published container image. Build the production image from this repository before creating a deployment.

```bash
git clone https://github.com/gigabytegrove/npm-improved.git
cd npm-improved
./scripts/buildx --load -t npm-improved:dev
```

The repository production Dockerfile builds for `linux/amd64` and `linux/arm64`.

## SQLite deployment

After building `npm-improved:dev`, create a compose file:

```yaml
services:
  app:
    image: npm-improved:dev
    restart: unless-stopped
    ports:
      - "80:80"
      - "81:81"
      - "443:443"
    environment:
      TZ: "America/New_York"
      # DISABLE_IPV6: "true"
      # NPM_ADMIN_PORT: "81"
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
```

Start it with:

```bash
docker compose up -d
```

Open the management interface on port `81`.

## Persistent data

Back up both directories:

```text
./data
./letsencrypt
```

Inside the container these map to `/data` and `/etc/letsencrypt`.

## MySQL / MariaDB

The existing NPM database environment variables remain supported.

```yaml
services:
  app:
    image: npm-improved:dev
    restart: unless-stopped
    ports:
      - "80:80"
      - "81:81"
      - "443:443"
    environment:
      DB_MYSQL_HOST: db
      DB_MYSQL_PORT: 3306
      DB_MYSQL_USER: npm
      DB_MYSQL_PASSWORD: change-me
      DB_MYSQL_NAME: npm
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
    depends_on:
      - db

  db:
    image: mariadb:11
    restart: unless-stopped
    environment:
      MARIADB_DATABASE: npm
      MARIADB_USER: npm
      MARIADB_PASSWORD: change-me
      MARIADB_ROOT_PASSWORD: change-root-password
    volumes:
      - ./mariadb:/var/lib/mysql
```

Use strong unique passwords or Docker secrets in real deployments.

## PostgreSQL

```yaml
services:
  app:
    image: npm-improved:dev
    restart: unless-stopped
    ports:
      - "80:80"
      - "81:81"
      - "443:443"
    environment:
      DB_POSTGRES_HOST: db
      DB_POSTGRES_PORT: 5432
      DB_POSTGRES_USER: npm
      DB_POSTGRES_PASSWORD: change-me
      DB_POSTGRES_NAME: npm
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
    depends_on:
      - db

  db:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_USER: npm
      POSTGRES_PASSWORD: change-me
      POSTGRES_DB: npm
    volumes:
      - ./postgres:/var/lib/postgresql/data
```

Custom PostgreSQL schemas are not supported; the normal `public` schema is used.

## Initial administrator

If no active users exist, the UI presents the first-user setup flow.

For automated initialization you may set:

```yaml
environment:
  INITIAL_ADMIN_EMAIL: admin@example.com
  INITIAL_ADMIN_PASSWORD: use-a-strong-password
```

The automatic user is created only when no active user already exists.

## Control plane

Port `81` is owned by the standalone NPM Improved Go control plane, not by the Nginx traffic process.

Changing the management port:

```yaml
environment:
  NPM_ADMIN_PORT: "8000"
ports:
  - "8000:8000"
```

## Healthcheck

```yaml
healthcheck:
  test: ["CMD", "/usr/bin/check-health"]
  interval: 10s
  timeout: 3s
```

The independent control plane also exposes:

```text
/__npm_improved/health
```

## Before exposing the service publicly

- use strong administrator credentials;
- keep port 81 on a management network whenever practical;
- configure certificates and verify renewals;
- review Settings → Protection;
- add only genuinely trusted networks to the Protection bypass list;
- review the Logs → Security Events workspace;
- maintain backups of persistent data and the database.

# Docker installation

Fresh installs use the published **v1.8.0** release images for Linux amd64 and arm64. The installer pulls the official GHCR image, falls back to the SHA-256-verified GitHub Release image archive if necessary, and installs the matching native systemd updater. No Git clone, source compilation, Docker build, or Buildx invocation is needed. Deployment files are installed in `/opt/npm-improved`. Existing installations are never overwritten.

## Requirements

- Linux amd64 or arm64 with systemd
- Docker Engine 24 or newer and Docker Compose v2 supporting `up --wait-timeout`
- curl, Python 3, CA certificates, gzip, and iproute2
- TCP ports 80, 81 and 443, or free alternatives

## Quick start: SQLite

```bash
(
  set -e
  installer="$(mktemp)"
  trap 'rm -f "$installer"' EXIT
  curl -fsSL https://raw.githubusercontent.com/gigabytegrove/npm-improved/develop/scripts/install-release -o "$installer"
  sudo bash "$installer" sqlite --auto-ports
)
```

Open the management URL printed by the installer. The default deployment uses SQLite at `/data/database.sqlite` and the matching published firewall companion image `ghcr.io/gigabytegrove/npm-improved-firewall:v1.8.0`.

## Port conflicts

Omit `--auto-ports` to require the default host ports. With the flag, the installer selects free alternatives and saves them in `/opt/npm-improved/.env`. It never stops existing services. Internal ports remain 80, 81 and 443. Restrict management access to your trusted network or VPN.

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

For a fresh installation:

```bash
(
  set -e
  installer="$(mktemp)"
  trap 'rm -f "$installer"' EXIT
  curl -fsSL https://raw.githubusercontent.com/gigabytegrove/npm-improved/develop/scripts/install-release -o "$installer"
  sudo bash "$installer" mysql --auto-ports
)
```

## PostgreSQL

For a fresh installation:

```bash
(
  set -e
  installer="$(mktemp)"
  trap 'rm -f "$installer"' EXIT
  curl -fsSL https://raw.githubusercontent.com/gigabytegrove/npm-improved/develop/scripts/install-release -o "$installer"
  sudo bash "$installer" postgres --auto-ports
)
```

Database credentials are generated automatically and stored in `/opt/npm-improved/.env` (mode 0600). The installer uses the corresponding version-matched Compose definition and pulls the database image. It does not build any images.

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

## Updating (v1.4.2+)

NPM Improved uses a native host-side updater. The SQLite release deployment also includes its dedicated firewall companion; that service is not an updater container.

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

### Managed host updater lifecycle

**No helper/updater Docker containers are used.** The image-only fresh installer provisions its native root-owned updater before starting the app. It configures `NPM_HOST_PROJECT_DIR`, validates the image-only Compose deployment, and installs the native systemd request watcher and maintenance timer. It aborts if provisioning fails.

On each subsequent release, the existing host-side dispatcher completes the
app upgrade, verifies health, then downloads its version-matched host updater
package from the same GitHub Release. The package is validated against the
release SHA-256 checksums, checked for unexpected entries and installed in
per-project root-owned host directories. A systemd timer retries maintenance
if the network temporarily prevents the component upgrade. This process does
not create any Docker containers other than replacing the existing NPMi app.

**Existing installations using v1.4.1's unmaintained native dispatcher**
need one last host-side bootstrap from the trusted v1.4.2 repository checkout:

```bash
sudo ./scripts/install-host-updater /absolute/path/to/existing/npm-project
```

That installs the *managed* dispatcher once. Future app versions update both
components automatically without repeating these commands.

Running `docker compose up` directly on an unprepared host is not an
equivalent installer: Docker container permissions cannot grant the root-owned
systemd installation that is required for in-place restart. Use the supported image-only
host installer for new nodes.

For operational checks, use:

```bash
systemctl list-units 'npm-improved-update-*.path' --all
systemctl list-timers 'npm-improved-update-*-maintenance.timer' --all
```

**Settings → Update** displays the host-updater version and whether its
automatic maintenance is enabled. No Docker socket mount is required inside
the NPMi application.

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

### Existing installations and recovery

Use **Settings → Update** for managed installations. Do not run the fresh installer over an existing project. For manual recovery, use the target release's prebuilt image or checksum-verified release archive, retain the existing Compose project and persistent directories, and follow its release notes. Do not switch to a locally built image as a recovery step.

### Developer source builds (not installation)

`scripts/install-docker` intentionally builds the checkout and is reserved for developers. It is not the production installation or upgrade command. The repository-root Compose templates contain development build directives; do not run them directly for a fresh production deployment.

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

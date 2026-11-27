# Docker installation

NPM Improved runs as Linux containers on Docker. It is not tied to Ubuntu, Debian, or an x86-64 host OS. The v1.8.0 deployment targets **linux/amd64 and linux/arm64**. Use a compatible Docker Engine or Docker Desktop in Linux-container mode, including supported Linux distributions, Windows, macOS, and NAS platforms. Windows-native containers and other CPU architectures are not supported by these images. Host networking, storage permissions, and capability restrictions vary by platform.

## Quick start: SQLite

### Standard Docker Compose (recommended for portable deployment)

Requires Docker and Docker Compose v2. No systemd, Linux package manager, Git clone, compilation, or local image build is needed.

Create a dedicated project directory and save [compose.yaml](deploy/compose.yaml) into it as `compose.yaml` (use **Raw** or download the file on GitHub). This SQLite template contains only published image references and persistent mounts. From that directory, run these commands in your usual terminal, including PowerShell:

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

Save [compose.mysql.yaml](deploy/compose.mysql.yaml) in a new project directory. Create a private `.env` file with unique, strong values for both `MYSQL_PASSWORD` and `MYSQL_ROOT_PASSWORD`. Then run:

```bash
docker compose -f compose.mysql.yaml pull
docker compose -f compose.mysql.yaml up -d --no-build --pull never --wait --wait-timeout 240
```

## PostgreSQL

Save [compose.postgres.yaml](deploy/compose.postgres.yaml) in a new project directory. Create a private `.env` file with a strong unique `POSTGRES_PASSWORD`. Then run:

```bash
docker compose -f compose.postgres.yaml pull
docker compose -f compose.postgres.yaml up -d --no-build --pull never --wait --wait-timeout 240
```

Do not expose the database ports. Both configurations preserve the release's database-specific service definitions.

## Registry unavailable: verified release archives

On the [v1.8.0 release page](https://github.com/gigabytegrove/npm-improved/releases/tag/v1.8.0), locate the archive for your Docker engine's Linux architecture and its SHA-256 checksum file. Verify the archive's SHA-256 against the corresponding entry before loading it using `docker load -i <archive>`. Check that `docker image inspect` succeeds for the exact application tag and, for the full SQLite deployment, the matching firewall tag. If either tag or checksum is unavailable, stop rather than building. Database deployments additionally require pulling their database image. Then use the same `up --no-build --pull never` command above. Do not run a registry pull after loading an offline bundle unless you deliberately want to replace it.

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

Portable Compose deployments run without the native updater. Docker container permissions cannot provision the root-owned systemd service. On those hosts, use Docker or your stack manager to update, restart and roll back. Use the managed release installer only when native host lifecycle management is required.

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

For portable Compose installations, back up the persistent directories and review the target release notes. Change `NPM_IMAGE` in `.env` to the exact official release tag and, when using the firewall companion, change `NPM_FIREWALL_IMAGE` to the matching release tag. Pull the target images and recreate the same project using the appropriate Compose file and `up -d --no-build --pull never --wait`. Verify health and preserve the previous images and backups for recovery. For database deployments use the matching `-f` option. For a reduced-feature app-only deployment, continue targeting `app` explicitly.

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

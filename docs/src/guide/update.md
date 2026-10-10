---
outline: deep
---

# Update Manager

NPM Improved v1.1.0 introduces a built-in lifecycle manager at **Settings → Update** for normal single-node Docker installations.

## What the page shows

The Update workspace displays:

- the installed NPM Improved version;
- the latest stable release;
- whether an update is available;
- the stable release date and release notes;
- the current update/restart/rollback state;
- the previous image/version when rollback state is available;
- the target image digest after it has been pulled.

The page checks the official NPM Improved GitHub release channel. Release metadata is cached by the backend during normal polling and can be refreshed manually with **Check for updates**.

## Installing an update

1. Create or verify a current backup.
2. Open **Settings → Update**.
3. Review the target stable release and release notes.
4. Enter the current administrator password.
5. Select **Update**.
6. Leave the page open while the Control Center disconnects and reconnects during container replacement.
7. Confirm that the status reports the target version as successfully installed.

Update progress is stored under `/data`, so refreshing or closing the browser does not cancel the operation or erase its status.

## How replacement works

The running NPM Improved application cannot replace its own Docker container after it stops. NPM Improved uses a **native, root-owned systemd host service** for in-place image replacement. The authenticated application writes a validated update request into its existing persistent `/data` directory. The host service then uses Docker Compose to update that installation, check health, and roll back if needed.

**No helper/updater Docker container is launched, and the application container is not given the Docker socket.**

New installations use `scripts/install-host-updater`, which provisions a host updater readiness marker, the physical Linux hostname, and a periodic systemd maintenance timer. Existing/older installations retain their original host service and project-specific Compose files during in-app updates.

### Existing hosts reporting "legacy" after a successful app update

Updating the Docker application does not automatically replace an **older root-owned host updater program**. The older service still handles application updates but might not support managed self-maintenance or physical-host identity reporting. This is why a perfectly successful new-version application may say *Native host updater: legacy* and *Host: Unidentified*.

Go to **Settings → Update → Native host updater**, open **One-time command for this host**, and copy the generated command. Run it **on that exact Linux Docker host, not inside the NPMi container**. It fetches the published updater archive for the installed release, verifies its SHA-256 checksum, and installs/activates the native systemd services without changing your Compose ports, NPMX settings, reverse proxy configuration, databases, or certificates.

Do this **once for each independently hosted NPMi node**. It does not require an extra Docker container. Once the service is installed, future NPMi releases can refresh both the application and native host updater automatically. The physical Linux hostname is then available from the project-matched updater marker; reloading the UI picks it up.

The *NPMX:* label in the header is the configured cluster node name, not necessarily the machine hostname. NPM Improved never substitutes the Docker container ID as the physical Linux hostname.

## Preflight checks

Before a stable update is applied, NPM Improved verifies that:

- the target is an official stable NPM Improved release;
- no other update operation is already active;
- the administrator password is valid;
- Docker and Docker Compose are available to the temporary handoff;
- the host deployment directory and Compose file are available;
- persistent data and certificate directories exist;
- at least 512 MiB of staging space is free;
- no database migration is active;
- no disaster-recovery restore is active;
- the deployment is not currently using Shared MySQL mode. Rolling NPMX primary/secondary updates are supported one node at a time, and snapshots resume when versions match.

Shared MySQL mode is blocked from automatic per-node updates. NPMX primary and secondary deployments use rolling updates: update one node, verify health, update the other. Snapshot applies intentionally pause during mixed-version operation, then resume automatically when versions match.

## What is preserved

The Update manager modifies the application image selection and recreates only the NPM Improved application service.

It preserves the existing deployment configuration, including:

- host port mappings;
- environment settings;
- persistent `/data`;
- `/etc/letsencrypt`;
- SQLite data;
- MariaDB/PostgreSQL service volumes when used;
- networks;
- restart behavior;
- runtime database selection stored under `/data`;
- backups and certificates.

## Update image sources

NPM Improved uses two stable image-delivery channels.

The updater first tries the official GHCR image for the target version. If Docker cannot retrieve that image anonymously, the updater automatically falls back to the architecture-specific Docker image bundle attached to the public GitHub Release.

Release bundles are published for Linux amd64 and arm64. Before a bundle is loaded into Docker, NPM Improved downloads the release checksum file and verifies the bundle with SHA-256.

This fallback keeps normal one-click updates working even when the container registry is temporarily unavailable or denies anonymous access.

## Health verification and automatic rollback

After the target image starts, NPM Improved waits for the Docker healthcheck and verifies:

- the application is healthy;
- the independent control-plane health endpoint responds;
- the running build reports the requested target version.

If startup or verification fails, the handoff restores the previous image setting and attempts to recreate the previously healthy application container.

The final state and exact failure reason are saved to the Update page.

## Restart

**Restart NPM Improved** restarts only the application service using the existing deployment and then waits for it to become healthy again.

The current administrator password is required.

## Rollback

When an update records a previous image, **Roll back to previous version** becomes available.

Rollback changes the application image back to the recorded previous image, recreates the service, and verifies health. The currently installed image becomes the next rollback source when appropriate.

Rollback should not be used as a substitute for backups. A newer release may have written persistent application/database state that an older release does not understand. Review release notes before downgrading across releases that contain schema changes.

## First upgrade from v1.0.0

v1.0.0 does not contain the Update manager, so v1.0.0 → v1.1.0 is a one-time CLI bridge.

For SQLite:

```bash
cd ~/npm-improved
git fetch origin --prune
git checkout develop
git pull --ff-only origin develop
./scripts/install-docker sqlite
```

Use `mysql` or `postgres` instead of `sqlite` when that is the underlying Compose deployment.

That installer run records the host project path/deployment mode required by **Settings → Update**. Normal supported stable updates after that can use the Control Center.

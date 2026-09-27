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

The running NPM Improved application cannot replace its own Docker container after it stops. NPM Improved therefore uses a temporary Docker CLI handoff only during the lifecycle operation.

The authenticated backend creates the handoff with:

- the Docker socket;
- the host NPM Improved project directory;
- a fixed NPM Improved update script and action;
- automatic container removal.

The handoff does not provide a general-purpose Docker command API to the browser and is not left running after the operation.

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
- the deployment is not currently using Shared MySQL or Instance Synchronization.

Shared MySQL and Instance Synchronization are blocked from a single-node automatic update because participating nodes must stay on a compatible application/schema version. Update those deployments as coordinated maintenance operations.

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

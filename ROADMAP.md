# NPM Improved Roadmap

This roadmap records planned post-1.0 work that has been accepted for future NPM Improved releases.

## v1.1.0 — Native Control Center Updates (implemented)

### Goal

Allow an administrator to update NPM Improved entirely from the Control Center.

The intended experience is:

1. NPM Improved checks the official stable release channel.
2. The Control Center shows the installed version, the latest stable version, release notes, and update availability.
3. The administrator clicks **Update**.
4. NPM Improved performs preflight checks and records rollback state.
5. The target official image is pulled automatically.
6. The running installation is replaced and restarted.
7. The browser reconnects automatically.
8. NPM Improved verifies the target version and health.
9. If verification fails, the installation automatically rolls back to the previous image.

A normal update must not require SSH, shell commands, or a permanently running updater sidecar.

### No permanent update worker

Do not introduce an always-running update-worker or updater sidecar container.

Docker cannot replace the immutable image of the process that is currently executing and then continue post-stop replacement work from that same process. The final replacement therefore requires a handoff outside the container being replaced.

That handoff must be temporary and self-cleaning. A one-shot update handoff may exist only while an update or rollback is actively running and must remove itself after completion.

There must be no persistent update-worker container in the healthy steady-state deployment.

### Official release images

The stable release workflow must publish official multi-architecture images to GHCR.

Required image references:

- `ghcr.io/gigabytegrove/npm-improved:v<version>`
- `ghcr.io/gigabytegrove/npm-improved:<version>`
- `ghcr.io/gigabytegrove/npm-improved:latest` for the current stable release

Required platforms:

- Linux amd64
- Linux arm64

The update process must resolve and record the image digest before replacement and should use the resolved digest for the actual replacement operation.

### Control Center

Add **Settings → Update**.

Display:

- installed version;
- installed build commit;
- installed image digest when available;
- latest stable version;
- release date;
- release notes/changelog;
- update availability;
- current update state and progress;
- last update result;
- previous version available for rollback.

Actions:

- **Check for Updates**
- **Update**
- **Restart NPM Improved**
- **Rollback to Previous Version** when rollback state is available

Update, restart, and rollback actions must require administrator permission and an elevated/re-authenticated session.

### Durable update state

Persist update state under `/data` so progress and the final result survive browser refreshes and container replacement.

Expected update states include:

- idle
- checking
- update_available
- preflight
- backing_up
- pulling
- staging
- restarting
- verifying
- completed
- rolling_back
- rolled_back
- failed

The UI must never leave the administrator with an indefinite generic spinner.

### Preflight and preservation

Before replacement, NPM Improved must:

- verify the requested release is an official NPM Improved stable release;
- verify the target version is newer than the installed stable version unless an explicit rollback is being performed;
- resolve and record the target image digest;
- record the current image reference and digest for rollback;
- verify persistent `/data` and `/etc/letsencrypt` mounts;
- verify sufficient free disk space to pull and stage the target image;
- verify database connectivity;
- verify that another update, restore, or database migration is not already active;
- refuse concurrent update operations.

The replacement must preserve:

- environment variables;
- published ports;
- volumes and bind mounts;
- networks;
- restart policy;
- labels;
- deployment/database mode;
- persistent application state;
- certificates;
- backups.

An update must never delete persistent application, database, certificate, or backup storage.

### Verification and rollback

After replacement, NPM Improved must:

- wait for the normal Docker healthcheck;
- verify `/api` reports the requested version;
- verify the independent control-plane health endpoint;
- verify the live image/version identity;
- confirm database availability;
- record the completed source and target versions and image digests.

If the replacement does not become healthy within the verification window, the updater must automatically restore the previous image and return the installation to a healthy state.

The UI must report the exact failure reason and the version restored by rollback.

### Multi-node safety

Shared MySQL and Instance Synchronization deployments require coordinated update behavior.

The updater must not silently leave a Shared MySQL deployment running incompatible application/schema versions.

For releases whose migrations are backward-compatible, a safe rolling update may be used.

For releases with non-backward-compatible migrations, NPM Improved must require a coordinated maintenance update rather than exposing an unsafe single-node update action.

Multi-node update sequencing and node health must be visible in the Control Center.

### Security requirements

The updater must not expose unrestricted host/container control through an ordinary application API.

Requirements include:

- narrowly scoped self-update operations only;
- strict validation of repository, release version, image digest, and replacement target;
- no general-purpose Docker command endpoint;
- no broad frontend access to the Docker daemon;
- administrator elevation/re-authentication for update, restart, and rollback;
- complete audit logging.

Audit records must include:

- initiating administrator;
- source version and digest;
- target version and digest;
- action requested;
- start/completion timestamps;
- success, rollback, or failure result;
- exact failure reason when applicable.

### Acceptance criteria

v1.1.0 implementation requirements:

- stable GHCR images are published automatically by the release workflow;
- a healthy single-node Docker installation can update from the Control Center with one **Update** action;
- no CLI command is required for a normal update;
- no permanent update-worker container exists before or after the update;
- existing ports, environment, volumes, database selection, certificates, backups, and `/data` survive unchanged;
- successful updates are verified against the requested version and image digest;
- failed replacement automatically restores the previous image;
- update progress survives browser refresh and reconnect;
- update, restart, and rollback actions are audited;
- automated tests cover successful update, failed-health rollback, preserved deployment configuration, interrupted browser session, and update locking.

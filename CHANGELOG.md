# Changelog

All notable NPM Improved changes are documented here.

## [1.1.0] - 2026-09-27

NPM Improved v1.1.0 adds native lifecycle management from the Control Center and official stable container images.

### Settings → Update

- Added a dedicated **Settings → Update** workspace.
- Shows the installed version, latest stable release, release date, release notes, and durable update status.
- Added **Check for updates**, **Update**, **Restart NPM Improved**, and **Rollback to previous version** controls.
- Requires the current administrator password for update, restart, and rollback operations.
- Persists update state under `/data` so progress/result survives browser refresh and application replacement.
- Automatically reconnects through the normal UI polling path after the application container returns.

### Native container updates

- Added a temporary, self-cleaning Docker CLI handoff used only while an update/restart/rollback is active.
- No permanent updater or worker sidecar is introduced.
- Preserves the existing Compose environment, ports, volumes, networks, database mode, certificates, backups, and persistent application state.
- Verifies Docker health, the independent control-plane health endpoint, and live build identity after replacement.
- Automatically restores the previous image configuration when a target image fails to start or pass verification.
- Blocks unsafe automatic updates during database migration, disaster-recovery restore, Shared MySQL mode, or Primary/Secondary Instance Synchronization.

### Distribution

- Stable releases now publish official NPM Improved images to GitHub Container Registry.
- Release images target Linux amd64 and arm64.
- Versioned, `v`-prefixed, and `latest` stable tags are published.
- v1.0.0 → v1.1.0 remains a CLI/installer upgrade; v1.1.0 establishes the in-app update path for subsequent supported stable releases.

## [1.0.0] - 2026-09-27

NPM Improved v1.0.0 is the first stable release and establishes the supported 1.x baseline.

### Control Center and branding

- Rebuilt the management interface around the NPM Improved Control Center.
- Replaced inherited Nginx Proxy Manager product branding and stale UI assets.
- Added the supplied NPM Improved logo, mark, favicon set, loading state, and dark/light presentation.
- Expanded Proxy Host editing into a larger responsive workspace.
- Corrected project links and rewrote public documentation in consumer-facing language.

### Reliability and recovery

- Added transactional Nginx configuration validation, activation, reload, and rollback.
- Rolls matching database host state back when a generated Nginx change cannot safely activate.
- Added Configuration History with active, superseded, failed, and restorable known-good revisions.
- Added an independent management/control-plane health path.
- Added the native Recovery Console for health checks, Nginx validation/reload, retained backup access, and emergency disaster recovery.
- Added System Health visibility for Nginx, database access, certificates, logs, and configuration processing.

### High availability

- Added native multi-backend Proxy Host pools.
- Supports round robin, least connections, client-IP affinity, and primary/failover behavior.
- Added encrypted Primary/Secondary Instance Synchronization with controlled secondary promotion.
- Added Shared MySQL/MariaDB multi-node operation with shared login signing identity, node presence, local Nginx refresh, and coordinated certificate-maintenance locking.

### Database mobility

- Added the UI-driven Database & Storage setup wizard.
- Supports SQLite to MySQL/MariaDB migration.
- Supports MySQL/MariaDB back to SQLite migration.
- Tests and verifies destination database state before switching.
- Leaves the source database intact after migration for recovery.
- Prevents Shared MySQL and Primary/Secondary database replication modes from competing with each other.

### Backup and disaster recovery

- Added encrypted Configuration and Full Disaster Recovery backup bundles.
- Full recovery can preserve users, authentication state, JWT identity, recovery credentials, cluster secret, certificates, custom Nginx state, and other instance data.
- Restore takes a rollback snapshot, regenerates Nginx state, validates it, and restores the previous state if recovery cannot safely activate.
- Added retained backups under `/data/backups`.

### Certificates, observability, and protection

- Added certificate lifecycle visibility and safer unused-certificate quarantine behavior.
- Added management views for system logs, Let's Encrypt logs, access/error logs, and structured HTTP security events.
- Added managed HTTP Protection profiles with trusted-network exclusions and transactional policy changes.

### Installation and validation

- Added production Docker/Compose installation support for SQLite, MySQL/MariaDB, and PostgreSQL.
- Added automatic host-port selection for parallel installs.
- Added clean-build update behavior that recreates and verifies the live application.
- Added CI coverage for frontend tests/build/lint, production Docker builds, Compose validation, installer validation, and live SQLite to MySQL to SQLite migration.
- Production image builds target Linux amd64 and arm64.

### Distribution

NPM Improved v1.0.0 is a stable source release. A pre-built NPM Improved container image is not published yet; supported deployments build the image from this repository using the included Docker installer and Compose files.

# Changelog

## [1.2.4] - 2026-09-28

NPM Improved v1.2.4 is a visual restraint pass for the Control Center.

### A quieter administration UI

- Removed decorative page gradients, glass/blur effects, oversized shadows, hover lifts, and most pill-shaped controls.
- Reduced global border radii and tightened card, table, form, and page spacing.
- Simplified typography weights and reduced excessive uppercase/tracking treatments.
- Replaced gradient primary buttons with conventional solid controls.
- Simplified modal and dropdown presentation.

### Navigation and shell

- Reworked the application header into a flatter, smaller administration header.
- Simplified online/version and account controls.
- Replaced the glowing gradient sidebar with a plain dark navigation rail.
- Removed marketing-style sidebar copy and visual effects.
- Shortened route subtitles to practical labels.

### Dashboard

- Removed the oversized greeting/hero area and decorative network-orbit graphic.
- Replaced it with a compact operational overview and direct actions.
- Converted route counts into smaller, denser metric rows.
- Simplified Routing Summary and High Availability into normal administration panels.
- Removed promotional copy such as “Build for failure, not hope.”

### Settings

- Removed the redundant Settings hero/header because the application header already provides page context.
- Reduced the Settings navigation to a conventional compact sidebar.
- Preserved deep links, mobile section selection, update indicators, and all existing settings functionality.
- Reduced visual weight in Default Site and Update.
- Converted Default Site template variables from large cards into a compact copyable table.

This release intentionally changes presentation rather than features. Existing configuration, workflows, permissions, and behavior are preserved.

## [1.2.3] - 2026-09-28

NPM Improved v1.2.3 permanently fixes the updater using stale host-side handoff code across image-based upgrades.

### Embedded updater handoff

- The update handoff script is now bundled inside every NPM Improved runtime image.
- The running application executes the handoff implementation from its own image version instead of `scripts/update-handoff.sh` from the host Git checkout.
- UI image upgrades no longer depend on the host checkout being updated in parallel.
- Updater capabilities now report `handoff_source: embedded` and verify the embedded handoff is present before enabling lifecycle controls.
- Docker CI removes the host checkout's handoff script before exercising the lifecycle manager and proves Restart still completes successfully.
- Changes to the handoff script now trigger Docker validation directly.

### Why this mattered

Previous releases updated the application container but left the original host Git checkout untouched. Because the lifecycle manager launched the host checkout's updater script, an installation could keep executing an older updater implementation forever. That is why newer UI releases could still show the old generic `Docker could not pull ...` failure instead of using the newer GitHub Release fallback.

v1.2.3 makes updater behavior part of the running release image itself, so future updater improvements move forward with each application update.

## [1.2.2] - 2026-09-28

NPM Improved v1.2.2 focuses on Control Center usability and Settings navigation.

### Settings workspace

- Settings sections now use URL-addressable `?section=` deep links.
- Reloading a Settings page preserves the active section instead of resetting to Default Site.
- Browser back/forward navigation now works naturally between Settings sections.
- Redesigned desktop Settings navigation with icons, short explanations, clearer active state, and an update-available badge.
- Added a compact mobile Settings selector for narrow screens.
- The global header subtitle now reflects the active Settings section.

### Faster navigation

- Footer update alerts now open **Settings → Update** directly instead of opening the GitHub release page.
- The Dashboard high-availability action now opens **Settings → Instance Synchronization** directly.

### Default Site usability

- Added plain-language explanations to every Default Site mode.
- Template variables are now presented as copyable cards instead of a raw table.
- Added copy confirmation feedback for template variables.
- Added a clearer Default Site section introduction.

### Update and settings polish

- Update release notes now render as formatted Markdown.
- Update status changes are announced through an ARIA live region.
- Added a clearer Certificate Lifecycle section introduction.

## [1.2.1] - 2026-09-28

NPM Improved v1.2.1 fixes the first-release updater experience and substantially redesigns **Settings → Update**.

### Update experience

- Moved the primary **Update to vX.Y.Z** action to the top of the Update workspace.
- Removed the permanent administrator-password field from the bottom of the page.
- Update, Restart, and Rollback now request the current administrator password only after the administrator chooses the action.
- Added a focused confirmation modal for authenticated lifecycle actions.
- Added clearer update progress, state, version transition, and immediate failure visibility.
- Failed update state is acknowledged and cleared when the Update page is reloaded, while the completed failure remains preserved in the audit log.
- Separated normal software updating from secondary Maintenance & Recovery controls.

### Registry reliability

- Docker pull failures now preserve the actual registry error instead of returning only a generic failure.
- Authorization/visibility failures, missing manifests, and architecture mismatches are reported with actionable detail.
- Stable releases now publish architecture-specific, SHA-256-verified Docker image bundles as public GitHub Release assets in addition to GHCR.
- The updater tries GHCR first and automatically falls back to the matching public release bundle when anonymous registry access is unavailable.
- Release publishing validates the public bundle channel and reports anonymous GHCR availability separately instead of making the registry a single point of failure.

## [1.2.0] - 2026-09-28

NPM Improved v1.2.0 introduces **NPMX (NPM Improved Exchange)** for easier, safer multi-node synchronization and adds cluster-aware Default Site templates.

### NPMX secure pairing and synchronization

- Added NPMX v1 as the native Primary/Secondary node-to-node exchange protocol.
- Replaced normal administrator-entered shared-secret setup with short-lived, single-use NPMX pairing codes.
- Persistent cluster credentials are generated automatically and are not displayed in the normal UI.
- Pairing uses ephemeral X25519 key exchange, HKDF-SHA256 key derivation, AES-256-GCM credential transport, and HMAC-SHA256 proofs.
- Normal NPMX requests use HMAC signatures covering the request method, path, node identity, timestamp, nonce, and canonical body digest.
- Added timestamp and nonce replay protection.
- Added NPMX protocol/version and capability negotiation before a secondary accepts a full synchronization snapshot.
- Preserved the existing one-primary/read-only-secondary safety model and controlled failover promotion.

### Full cluster state exchange

- NPMX synchronization carries proxy configuration, users/authentication state, certificates and certificate records, Let's Encrypt material, custom SSL files, custom Nginx assets, and other required cluster filesystem state.
- Added signed NPMX heartbeats and node status reporting.
- Added two-node Docker integration coverage that performs real pairing, credential exchange, snapshot synchronization, and local page verification.

### Cluster-aware Default Site templates

- Added reusable variables for built-in and custom Default Site pages.
- Custom HTML and redirect destinations can use node, cluster, build, and system variables.
- Available values include node hostname, friendly node name, node ID, role, public URL, application version, build commit/date, NPMX protocol/version, platform, architecture, and render timestamp.
- NPMX synchronizes the source template rather than copying already-rendered HTML.
- Every node renders its own local values so an unmatched-host page can identify the exact proxy node that served it.
- Rebranded the static startup fallback page for NPM Improved.

### Restore reliability

- Fixed cluster/disaster-recovery filesystem restore handling for Docker bind-mounted directories such as `/etc/letsencrypt`.
- Restore now replaces directory contents without attempting to delete the bind-mount root itself.

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

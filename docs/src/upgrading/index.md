---
outline: deep
---

# Upgrading

NPM Improved is currently pre-1.0. Until a stable migration contract and published container release channel exist, treat upgrades between development snapshots as potentially state-changing.

## Before every upgrade

Back up:

```text
/data
/etc/letsencrypt
```

For external MySQL/MariaDB/PostgreSQL deployments, back up the database as well.

## Recovery token

The Go control plane creates `/data/recovery-access.json` when native recovery support is introduced. Preserve this file with `/data` and record the recovery token in your disaster-recovery documentation.

The native emergency console is available at `/recovery/` even when the Node API is unavailable.

## NPM Improved backup bundles

In addition to infrastructure snapshots, **Settings → Backup & Recovery** can create encrypted Configuration or Full Disaster Recovery bundles.

A Configuration backup is suitable for portable configuration migration. A Full Disaster Recovery backup additionally contains users/authentication/JWT state and is intended to rebuild the same instance.

See [Backup & Disaster Recovery](/guide/disaster-recovery).

## Recommended process

1. create a current NPM Improved backup;
2. snapshot or back up `/data`, `/etc/letsencrypt`, and the external database when one is used;
3. pull the target NPM Improved revision;
4. rebuild with the installer target that matches the deployment;
5. verify management access on port 81;
6. verify Proxy Hosts, redirects, 404 hosts, Streams, certificates, logs, Protection, Database & Storage, and System Health;
7. verify Instance Synchronization or Shared MySQL node status when those features are in use.

For a typical SQLite installation:

```bash
cd ~/npm-improved
git checkout develop
git pull --ff-only
./scripts/install-docker sqlite --clean-build
```

Use `mysql` or `postgres` instead of `sqlite` when that is the underlying deployment target.

A database selected through **Settings → Database & Storage** is stored under `/data/database-config.json` and survives the application rebuild.

## Configuration History on upgrade

The Configuration History feature adds a `config_revision` database table.

Existing hosts and streams are not bulk-rewritten during upgrade. Instead, NPM Improved captures the currently serving state as a baseline revision immediately before that object's first subsequent configuration change. History therefore begins at the point this feature is installed, while still preserving a restorable pre-change baseline for existing objects.

Failed revisions are retained for diagnostics but are not eligible for restore.

## HTTP Protection on upgrade

NPM Improved creates `/data/nginx/protection/policy.conf` when the managed protection system is introduced. The default global profile is **Standard**.

After upgrading, review **Settings → Protection** and test applications that legitimately generate high request rates, maintain many concurrent connections, or use long-lived WebSockets. Per-host overrides can be set to Inherit, Off, Standard, or Aggressive.

Protection policy changes are transactional, but an upgrade is still the right time to validate expected application traffic before relying on the new defaults.

## Shared MySQL on upgrade

Run the same NPM Improved version on every node using one shared MySQL/MariaDB database.

Upgrade shared-database nodes as a coordinated maintenance operation. Before returning all nodes to service, confirm:

- every node is running the intended NPM Improved version;
- **Database & Storage** shows the expected shared nodes;
- shared certificate/custom file storage is mounted and current;
- Proxy Hosts and certificates are serving correctly from more than one node.

Do not intentionally run different NPM Improved schema versions against the same shared database.

## Important compatibility note

NPM Improved is based on Nginx Proxy Manager and intentionally preserves its database/API concepts where practical, but this fork introduces additional settings, generated configuration, certificate lifecycle state, and control-plane behavior.

Do not assume that downgrading to an older upstream or NPM Improved build will understand state written by a newer build.

## Transactional rollback is not a backup

The last-known-good Nginx transaction system protects individual configuration changes. It does not replace backups of the database, certificates, or persistent data volumes.

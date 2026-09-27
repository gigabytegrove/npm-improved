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

## NPM Improved backup bundles

In addition to infrastructure snapshots, **Settings → Backup & Recovery** can create encrypted Configuration or Full Disaster Recovery bundles.

A Configuration backup is suitable for portable configuration migration. A Full Disaster Recovery backup additionally contains users/authentication/JWT state and is intended to rebuild the same instance.

See [Backup & Disaster Recovery](/guide/disaster-recovery).

## Recommended process

1. stop or snapshot the existing deployment;
2. back up persistent data and the external database, if used;
3. build the target NPM Improved commit/image;
4. start it against a copy of production data first;
5. verify management access on port 81;
6. verify proxy hosts, redirects, 404 hosts, streams, certificates, logs, and Protection settings;
7. only then upgrade the live deployment.

## Configuration History on upgrade

The Configuration History feature adds a `config_revision` database table.

Existing hosts and streams are not bulk-rewritten during upgrade. Instead, NPM Improved captures the currently serving state as a baseline revision immediately before that object's first subsequent configuration change. History therefore begins at the point this feature is installed, while still preserving a restorable pre-change baseline for existing objects.

Failed revisions are retained for diagnostics but are not eligible for restore.

## HTTP Protection on upgrade

NPM Improved creates `/data/nginx/protection/policy.conf` when the managed protection system is introduced. The default global profile is **Standard**.

After upgrading, review **Settings → Protection** and test applications that legitimately generate high request rates, maintain many concurrent connections, or use long-lived WebSockets. Per-host overrides can be set to Inherit, Off, Standard, or Aggressive.

Protection policy changes are transactional, but an upgrade is still the right time to validate expected application traffic before relying on the new defaults.

## Important compatibility note

NPM Improved is based on Nginx Proxy Manager and intentionally preserves its database/API concepts where practical, but this fork introduces additional settings, generated configuration, certificate lifecycle state, and control-plane behavior.

Do not assume that downgrading to an older upstream or NPM Improved build will understand state written by a newer build.

## Transactional rollback is not a backup

The last-known-good Nginx transaction system protects individual configuration changes. It does not replace backups of the database, certificates, or persistent data volumes.

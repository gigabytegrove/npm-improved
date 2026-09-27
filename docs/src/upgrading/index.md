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

## Recommended process

1. stop or snapshot the existing deployment;
2. back up persistent data and the external database, if used;
3. build the target NPM Improved commit/image;
4. start it against a copy of production data first;
5. verify management access on port 81;
6. verify proxy hosts, redirects, 404 hosts, streams, certificates, logs, and Protection settings;
7. only then upgrade the live deployment.

## Important compatibility note

NPM Improved is based on Nginx Proxy Manager and intentionally preserves its database/API concepts where practical, but this fork introduces additional settings, generated configuration, certificate lifecycle state, and control-plane behavior.

Do not assume that downgrading to an older upstream or NPM Improved build will understand state written by a newer build.

## Transactional rollback is not a backup

The last-known-good Nginx transaction system protects individual configuration changes. It does not replace backups of the database, certificates, or persistent data volumes.

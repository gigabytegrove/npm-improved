---
outline: deep
---

# Architecture

## Control plane vs. data plane

NPM Improved separates management availability from reverse-proxy traffic.

```text
Management network
      │
      │ :81
      ▼
Go control plane
      │
      ├── serves the compiled admin frontend
      └── proxies /api/ to the existing Node backend
               │
               ├── database
               ├── certificate management
               ├── log/security aggregation
               └── transactional Nginx configuration

Internet / LAN traffic
      │
      │ :80 / :443 / streams
      ▼
Nginx data plane
      │
      ▼
Upstream services
```

The Node backend remains in place while control-plane responsibilities are migrated incrementally. The important reliability boundary is that Nginx no longer owns the management listener.

## Transactional Nginx changes

Generated host configuration follows this sequence:

1. verify the existing Nginx configuration is valid;
2. render a candidate file;
3. move the current live file to a temporary last-known-good location;
4. put the candidate in the live path;
5. run `nginx -t`;
6. reload Nginx only after validation succeeds;
7. remove rollback artifacts only after a successful reload.

If validation fails, the candidate is retained as `.err` and the previous live file is restored without reloading the bad configuration.

If reload fails, the previous file is restored and Nginx is reloaded back to the last-known-good state.

Host database state is also restored when a host transaction fails.

## Settings that affect Nginx

Managed settings that generate Nginx configuration use the same transaction helper. This includes the default site and HTTP Protection policy.

## Durable configuration revisions

Host and stream mutations are recorded in the `config_revision` table at the same transaction boundary used to activate Nginx.

A revision stores:

- object type and object ID;
- operation and actor;
- database snapshot;
- generated Nginx configuration;
- Pending, Active, Superseded, or Failed state;
- exact validation/reload error and failure phase;
- source revision when the change was produced by a restore.

Before the first recorded change to an existing object, NPM Improved captures the currently serving state as a baseline Active revision. This gives upgraded installations a last-known-good restore point without rewriting every host at startup.

Only a successful Nginx activation becomes Active. The previous Active revision becomes Superseded in the same database transaction. Failed candidates remain Failed and the prior Active revision remains authoritative.

Restoring a revision is itself a new transaction:

```text
stored snapshot
      ↓
restore database candidate
      ↓
regenerate Nginx config
      ↓
nginx -t
      ↓
reload
      ↓
new Active revision
```

The source revision remains immutable history. If the restore cannot validate or reload, the current database state is restored and the existing last-known-good Nginx configuration remains in service.

## Certificate lifecycle

A certificate is considered in use when a non-deleted proxy host, redirection host, 404 host, or stream references it. Disabled hosts still count as references.

Unused certificates enter quarantine before automatic cleanup. The retention period and custom-certificate cleanup policy are configurable.

## Logs and security events

Nginx continues to write per-host access and error logs under `/data/logs`. NPM Improved exposes raw views and performs bounded parsing of recent HTTP access logs to create structured security events.

## HTTP Protection

The generated policy lives at:

```text
/data/nginx/protection/policy.conf
```

The policy is loaded at the Nginx `http` level. Per-host profiles can inherit the global policy, override it with Standard/Aggressive values, or explicitly disable managed limits for that host.

Trusted sources use an empty Nginx limiting key, which excludes them from managed request/connection accounting. Untrusted requests are keyed by resolved client address plus host, preventing traffic to one hostname from consuming that client's allowance on another hostname.

The Protection setting itself is transactional: the database setting and generated policy remain aligned with the last configuration that successfully validated and reloaded.

## Backup and disaster recovery

NPM Improved backup bundles store logical application records instead of a raw database file, making the format portable across supported database engines.

Configuration backups preserve runtime configuration and certificate/custom-file state while remapping ownership to the restoring administrator. Full disaster-recovery backups additionally preserve users, authentication state, configuration revisions, and JWT keys.

Restore is a cross-resource transaction boundary: the importer snapshots the current database scope and relevant persistent filesystem state, restores the candidate bundle, regenerates Nginx, validates it, and reloads. A validation or reload failure restores the pre-import database and filesystem state before reloading the previous Nginx configuration.

See [Backup & Disaster Recovery](/guide/disaster-recovery).

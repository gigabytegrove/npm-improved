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

## Health paths

The Go control plane exposes:

```text
/__npm_improved/health
```

This endpoint does not depend on the Node API. It reports only safe diagnostic state for the control plane, compiled frontend, backend reachability, and Nginx PID/config validity. The HTTP endpoint itself remains successful when components are degraded; the JSON `status` field carries the health state.

When the backend is available, administrators can also use:

```text
/api/reports/system-health
```

The authenticated report adds database connectivity, Nginx last-reload state, certificate scheduler state, log-storage health, backend uptime, and revision-engine state.

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

---
outline: deep
---

# System Health

NPM Improved separates normal authenticated health reporting from degraded-mode recovery diagnostics.

## System Health workspace

Administrators can open **System Health** from the main navigation.

The page refreshes automatically and reports:

- Control Plane status and health latency;
- Nginx PID, configuration validity, and last successful reload;
- database connectivity and query latency;
- certificate renewal and lifecycle timer state;
- log directory read/write availability;
- Configuration History Active, Pending, and Failed revision counts;
- instance firewall feature state, verified enforcement, companion health,
  dropped packet/byte counters, and activation confirmation;
- backend process uptime.

A component can be degraded without hiding the rest of the system state.

## Firewall management

System Health includes an administrator-only firewall control. Operators can
enable or disable the feature, request a fresh policy reconciliation, and
confirm an activation still within its two-minute safety window. Configuration
of trusted management CIDRs, deployment mode, and port guidance remains in
the dedicated **Firewall** page.

A disabled feature is not a guarantee that old rules have been removed:
the status remains degraded while the companion reports release pending or
cannot verify rule removal. Existing ports, router settings, and other
containers are never modified by these controls.

## Nginx last reload

After each successful managed Nginx reload, NPM Improved persists the timestamp under:

```text
/data/nginx/.last-reload
```

The timestamp is operational metadata only. Failure to write the timestamp does not turn an otherwise successful Nginx reload into a failed configuration transaction.

## When the management API is unavailable

The admin frontend is served by the independent Go control plane, not the Nginx traffic process.

If the normal `/api` health check fails, the UI switches to a degraded-mode diagnostics screen instead of only showing a generic API failure.

That screen calls:

```text
/__npm_improved/health
```

directly and reports:

- whether the control plane itself is alive;
- whether the Node management API responds;
- whether Nginx has a detectable PID;
- whether the Nginx configuration validates.

The endpoint always returns an HTTP response when the control plane itself is alive. Inspect the JSON `status` field for `ok` or `degraded`.

## Information exposure

The degraded-mode endpoint is intentionally limited because it does not depend on normal API authentication.

It does **not** return:

- domain names;
- generated Nginx configuration;
- validation stderr;
- certificate contents;
- database connection details;
- revision snapshots.

Detailed health information remains available only through the authenticated System Health workspace.

## What System Health does not do yet

System Health is not an unrestricted repair console. The authenticated
firewall controls are narrowly scoped to this node's instance firewall.
Nginx and database repair remain subject to normal authenticated workflows
and Configuration History restore. These controls are not exposed by the
unauthenticated degraded-mode endpoint.
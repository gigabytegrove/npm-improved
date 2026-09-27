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
- backend process uptime.

A component can be degraded without hiding the rest of the system state.

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

System Health diagnoses component state; it is not a privileged repair console.

Configuration repair remains subject to the normal authenticated transactional workflows and Configuration History restore. This avoids creating an unauthenticated emergency endpoint capable of changing Nginx or database state.
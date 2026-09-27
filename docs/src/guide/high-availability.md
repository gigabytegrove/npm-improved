---
outline: deep
---

# Proxy Host High Availability

NPM Improved can route one Proxy Host to multiple backend servers. The hostname, certificate, access policy, WebSocket settings, protection policy, and other host controls remain attached to one Proxy Host while Nginx selects an available backend from its upstream pool.

## Add multiple upstreams

Open **Proxy Hosts**, add or edit a host, and use the **Upstream Pool** section on the Details tab.

Each upstream has:

- **Scheme** — HTTP or HTTPS;
- **Forward Hostname / IP** — the backend DNS name, IPv4 address, or IPv6 address;
- **Port** — backend listener port;
- **Label** — an optional operator-facing name;
- **Weight** — relative traffic share in balancing modes;
- **Max failures** — passive failures before Nginx temporarily considers that peer unavailable;
- **Fail timeout** — the passive failure window and temporary-unavailable period;
- **Enabled** — keeps a defined backend in the host without sending traffic to it.

All enabled targets in one pool use the same scheme. This keeps the Nginx upstream protocol deterministic and avoids accidentally mixing TLS and clear-text backends under one logical pool.

## Distribution modes

### Round robin

The default. Requests rotate across available upstreams according to their configured weights.

### Least connections

Nginx prefers the available upstream with the fewest active connections. This is useful when request duration varies substantially between clients.

### Client IP affinity

Nginx uses the client IP to choose an upstream consistently. This can help applications that still depend on backend-local session state, but application-level shared session storage remains preferable.

### Primary + failover

The first enabled upstream is the primary. Every following enabled upstream is generated as an Nginx `backup` server. Backup servers receive requests only when the primary is unavailable.

Order matters in this mode. Put the preferred production target first.

## Failure behavior

NPM Improved uses native Nginx upstream retry and passive failure detection. For pooled Proxy Hosts, Nginx retries requests on:

- connection errors;
- timeouts;
- invalid upstream headers;
- HTTP 500, 502, 503, and 504 responses.

The retry limit is the number of enabled upstreams.

The current implementation is **passive health detection**: a backend is judged from real request failures. NPM Improved does not claim an active synthetic health probe before traffic reaches a backend.

## Compatibility

Existing single-target Proxy Hosts continue to work. NPM Improved synthesizes a one-member pool from the legacy scheme/host/port fields.

The legacy `forward_scheme`, `forward_host`, and `forward_port` fields remain populated from the first enabled target for compatibility with existing API clients and tooling. If a legacy client updates those fields on a multi-target host, NPM Improved updates the primary target without discarding the secondary targets.

## Two HA layers

Backend pools and NPM Improved instance synchronization solve different failures:

1. **Upstream pools** keep one NPM Improved/Nginx node serving when an application backend fails.
2. **Instance synchronization** keeps multiple NPM Improved/Nginx nodes carrying the same proxy configuration when an entire proxy node fails.

For node-level HA, continue with [Instance Synchronization](/guide/instance-sync).

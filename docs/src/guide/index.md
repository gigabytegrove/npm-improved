---
outline: deep
---

# NPM Improved Guide

NPM Improved is a modernized Nginx Proxy Manager fork built around a simple idea: running a reverse proxy should stay easy even after your setup grows beyond one server and a few test sites.

You can still create a hostname, point it at an app, turn on HTTPS, and move on. NPM Improved adds safer changes, better recovery, high availability, shared databases, observability, and a redesigned Control Center without requiring you to manage raw Nginx files for everyday work.

## Project status

NPM Improved **v1.2.0** adds NPMX secure node pairing/synchronization and cluster-aware Default Site templates.

The active integration branch is:

```text
develop
```

Stable Linux amd64 and arm64 images are published at `ghcr.io/gigabytegrove/npm-improved`. The included Docker installer remains the supported first-install and source-build path.

Do not use an upstream Nginx Proxy Manager container image when you expect NPM Improved features to be present.

## What NPM Improved adds

### A redesigned Control Center

The management interface is built around NPM Improved rather than the inherited upstream layout.

It includes dedicated areas for:

- Proxy Hosts;
- redirects and Streams;
- certificates;
- users and Access Lists;
- logs and security events;
- Configuration History;
- System Health;
- Database & Storage;
- Instance Synchronization;
- Backup & Disaster Recovery;
- Update.

### Safer configuration changes

Nginx changes are tested before they are activated.

If a generated configuration does not validate or reload correctly, NPM Improved restores the previous working state instead of leaving the proxy partially broken.

Configuration History records active, superseded, and failed revisions so administrators can see what changed and restore known-good states.

[Read about Configuration History](/guide/config-history).

### Backend high availability

A Proxy Host can use more than one backend server.

Available balancing/failover choices include:

- round robin;
- least connections;
- client IP affinity;
- primary + failover.

This lets one hostname survive an application-server failure without changing the public URL.

[Read about Proxy Host High Availability](/guide/high-availability).

### Multiple NPM Improved servers

There are two supported ways to run more than one NPM Improved node.

**Instance Synchronization** uses one Primary and one or more Secondary servers. Each server keeps its own database, and **NPMX (NPM Improved Exchange)** handles one-time secure pairing, capability negotiation, encrypted snapshots, certificate/filesystem synchronization, and node heartbeats. Administrators do not manually create or copy cluster secrets.

Default Site custom HTML can also use node/cluster template variables such as `node.hostname`, `node.name`, `node.role`, and `node.version` using the double-brace syntax shown on the Default Site screen. NPMX synchronizes the template while each node renders its own local values.

[Read about Instance Synchronization and NPMX](/guide/instance-sync).

**Shared MySQL mode** lets several NPM Improved servers use one MySQL/MariaDB database. Each node watches the common state and keeps its own Nginx configuration refreshed.

[Read about Database & Shared MySQL](/guide/database).

### SQLite today, MySQL later

You do not have to decide on a permanent database during the first install.

From **Settings → Database & Storage**, NPM Improved can:

- move SQLite to MySQL/MariaDB;
- move MySQL/MariaDB back to SQLite;
- join an existing shared NPM Improved MySQL database;
- test the destination before changing anything;
- copy and verify data before switching.

The original source database is left in place so you have a straightforward recovery path while you verify the move.

### Backup and disaster recovery

NPM Improved can create encrypted configuration or full disaster-recovery backups.

Full recovery backups can include users, authentication state, certificates, configuration, custom Nginx files, recovery credentials, and other state needed to rebuild the same installation.

Restore operations validate the resulting Nginx configuration and roll back if the recovered state cannot safely start.

[Read about Backup & Disaster Recovery](/guide/disaster-recovery).

### Recovery Console

The native Recovery Console is separate from the normal application workflow and is designed for situations where the main management application is unhealthy.

It can help you inspect health, validate Nginx, review failed configuration candidates, and restore retained backups.

[Read about the Native Recovery Console](/guide/recovery-console).

### System Health and observability

The Control Center exposes health information for the major services NPM Improved depends on, including Nginx, database access, certificate processing, logs, and configuration processing.

Logs and structured security-event views are also available in the UI so common troubleshooting does not have to begin at a shell prompt.

[Read about System Health](/guide/system-health).

### HTTP protection

Managed HTTP protection profiles provide common request-rate and connection controls without requiring hand-written Nginx directives for each host.

[Read about HTTP Protection](/guide/protection).

## Quick start

Requirements:

- Docker Engine 24 or newer;
- Docker Compose v2;
- Git.

For the simplest SQLite installation:

```bash
git clone https://github.com/gigabytegrove/npm-improved.git
cd npm-improved
./scripts/install-docker sqlite
```

When the installer finishes, open:

```text
http://<your-server>:81
```

For detailed installation, database, port, update, and storage guidance, see [Docker installation](/setup/) and [DOCKER.md](https://github.com/gigabytegrove/npm-improved/blob/develop/DOCKER.md).

## Normal ports

| Port | Purpose |
| ---: | --- |
| 80 | HTTP traffic |
| 81 | NPM Improved Control Center |
| 443 | HTTPS traffic |

The host-side mappings can be changed without changing the internal application ports.

## Persistent state

The main persistent locations are:

```text
/data
/etc/letsencrypt
```

Keep both on persistent storage and include them in your normal infrastructure backup plan.

Shared MySQL deployments also need shared or replicated certificate/custom file storage between nodes.

## Updating

For normal single-node Docker installations on v1.1.0 or newer, use **Settings → Update**. It shows the stable release, release notes and progress, then performs a health-verified application-container replacement with automatic rollback when the target cannot be verified.

v1.0.0 must be upgraded to v1.1.0 once through the Docker installer because the older release does not yet include the Update manager.

Shared MySQL and Instance Synchronization deployments remain coordinated maintenance updates so all participating nodes stay on a compatible version.

Before upgrading a v1.x system, keep a current backup and verify the important proxy, certificate, database, and recovery workflows after the update.

## Upstream attribution

NPM Improved is based on [Nginx Proxy Manager](https://github.com/NginxProxyManager/nginx-proxy-manager) and retains the applicable upstream MIT license and attribution.

Project page: [Gigabyte Grove Projects](https://www.gigabytegrove.com/projects)

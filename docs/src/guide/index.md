---
outline: deep
---

# NPM Improved Guide

NPM Improved is a modernized Nginx Proxy Manager fork built around a simple idea: running a reverse proxy should stay easy even after your setup grows beyond one server and a few test sites.

You can still create a hostname, point it at an app, turn on HTTPS, and move on. NPM Improved adds safer changes, better recovery, high availability, shared databases, observability, and a redesigned Control Center without requiring you to manage raw Nginx files for everyday work.

## Project status

NPM Improved [v1.8.0](https://github.com/gigabytegrove/npm-improved/releases/tag/v1.8.0) is the pinned stable installation release. The `develop` branch is for integration. Published Linux amd64 and arm64 images are available at `ghcr.io/gigabytegrove/npm-improved`; normal installation does not build source.

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

### Analytics Center

Use the [Analytics Center](/guide/analytics-center) for node-local HTTP routing and TCP/UDP stream session metrics, with links back to each Proxy Host's full Analytics view. NPMX synchronizes configuration but never duplicates node traffic statistics.

### Proxy Host Analytics

Click **Analytics** on an individual Proxy Host to review requests, bandwidth, response codes, latency, trends, per-host activity and sanitized CSV exports. See [Proxy Host Analytics](/guide/proxy-host-analytics) for retention, privacy and node-local scope.

### System Health and observability

The Control Center exposes health information for the major services NPM Improved depends on, including Nginx, database access, certificate processing, logs, and configuration processing.

Logs and structured security-event views are also available in the UI so common troubleshooting does not have to begin at a shell prompt.

[Read about System Health](/guide/system-health).

### HTTP protection

Managed HTTP protection profiles provide common request-rate and connection controls without requiring hand-written Nginx directives for each host.

[Read about HTTP Protection](/guide/protection).

## Quick start

NPM Improved runs as Linux containers on Docker. It is not tied to Ubuntu, Debian, or an x86-64 host OS. The v1.8.0 deployment targets **linux/amd64 and linux/arm64**. Use a compatible Docker Engine or Docker Desktop in Linux-container mode, including supported Linux distributions, Windows, macOS, and NAS platforms. Windows-native containers and other CPU architectures are not supported by these images. Host networking, storage permissions, and capability restrictions vary by platform.

### Standard Docker Compose (recommended for portable deployment)

Requires Docker and Docker Compose v2. No systemd, Linux package manager, Git clone, compilation, or local image build is needed.

Create a dedicated project directory and save [compose.yaml](https://github.com/gigabytegrove/npm-improved/blob/develop/deploy/compose.yaml) into it as `compose.yaml` (use **Raw** or download the file on GitHub). This SQLite template contains only published image references and persistent mounts. From that directory, run these commands in your usual terminal, including PowerShell:

```bash
docker compose pull
docker compose up -d --no-build --pull never --wait --wait-timeout 240
docker compose ps
```

Open `http://localhost:81` on the Docker host, or port 81 on the remote Docker host. For alternate host ports, create a file named `.env` next to the Compose file:

```dotenv
HTTP_PORT=8080
ADMIN_PORT=8181
HTTPS_PORT=8443
```

For example, the management UI then uses port 8181. Use the same project directory for all future operations.

**Security:** Restrict the management port to a trusted network or VPN. The default SQLite template includes the release's firewall companion, which requires Docker support for `NET_ADMIN` in the application network namespace. If your host cannot grant this capability, explicitly deploy only the app with `docker compose pull app` followed by `docker compose up -d --no-build --pull never --wait app`; the companion's instance-level network filtering is then unavailable. Use an appropriate host firewall. This is a reduced-feature deployment, not a way to bypass a host security policy. Docker Desktop and NAS deployments must provide persistent writable storage with Linux-compatible file permissions. For clustered deployments set a unique `NPM_NODE_HOSTNAME` in `.env`.

If a registry pull fails, stop and use the verified release archive recovery path in the Docker guide; never build from source.

For database variants and optional native systemd lifecycle management, see [Docker installation](/setup/).

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


## Origins and brand identity

NPM Improved is an independently maintained Gigabyte Grove project that originated as a fork of [Nginx Proxy Manager](https://github.com/NginxProxyManager/nginx-proxy-manager). It is not an official upstream release and is not affiliated with or endorsed by the upstream maintainers.

Current NPM Improved visual branding is distinct from the upstream project's imagery. We acknowledge the original developers and contributors and retain applicable MIT license notices for inherited software. See the repository's [Origins and Credits](https://github.com/gigabytegrove/npm-improved/blob/develop/CREDITS.md) and [LICENSE](https://github.com/gigabytegrove/npm-improved/blob/develop/LICENSE) for details.

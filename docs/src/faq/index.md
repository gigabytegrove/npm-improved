---
outline: deep
---

# FAQ

## Is NPM Improved the same project as Nginx Proxy Manager?

No. NPM Improved is a fork based on Nginx Proxy Manager. It intentionally keeps compatible workflows where practical but has its own control-plane, rollback, lifecycle, observability, and protection work.

## Is there a stable NPM Improved Docker image?

Yes. Beginning with v1.1.0, stable NPM Improved releases publish official Linux amd64 and arm64 images to `ghcr.io/gigabytegrove/npm-improved`.

Do not use an upstream `jc21/nginx-proxy-manager` image and expect NPM Improved features to be present.

## Can NPM Improved update itself?

Yes, on normal single-node Docker deployments running v1.1.0 or newer. Open **Settings → Update** to check the latest stable release, read release notes, install the update, restart the application, or roll back to the previous image when rollback state is available.

There is no permanent update-worker container. NPM Improved launches a temporary self-cleaning Docker handoff only while replacing or restarting the running application container.

Shared MySQL and Instance Synchronization deployments require a coordinated maintenance update and are blocked from the single-node Update action.

## Which architectures can I build?

The production build script targets:

- `linux/amd64`
- `linux/arm64`

## Can I start with SQLite and move to MySQL later?

Yes. Open **Settings → Database & Storage**.

NPM Improved can copy SQLite to MySQL/MariaDB, verify the destination, switch the backend, and restart. It can also move a MySQL/MariaDB installation back to SQLite.

The source database is not automatically deleted after a migration.

## Can several NPM Improved servers use the same MySQL database?

Yes. Enable **Shared MySQL mode**.

Every node uses the same database, coordinates login signing identity, publishes node presence, and refreshes its own local Nginx configuration when shared state changes.

Certificate and custom files are still filesystem data, so those paths must also be shared or replicated between nodes.

See [Database & Shared MySQL](/guide/database).

## Should I use Shared MySQL or Instance Synchronization?

Use **Shared MySQL** when all NPM Improved nodes can reliably reach one common MySQL/MariaDB database.

Use **Instance Synchronization** when each node should keep its own database and one Primary should replicate configuration to Secondary nodes.

NPM Improved does not run both database-replication models at the same time.

## Why does the management UI stay up when Nginx is broken?

Port 81 is served by the standalone Go control-plane process. It is deliberately separate from the Nginx traffic process.

## What happens if I save a bad Nginx configuration?

Generated host changes are rendered as candidates and validated with `nginx -t`. A validation failure restores the previous live file without reloading the bad candidate. A reload failure also triggers last-known-good restoration and recovery reload.

## Does Protection stop DDoS attacks?

It mitigates application-layer request floods, excessive source connections, and slow-client resource exhaustion that reach Nginx.

It cannot stop a volumetric attack that saturates your network connection upstream of the server.

## Can I exempt my LAN from Protection?

Yes, but only add networks you actually trust. Settings → Protection accepts IPv4/IPv6 addresses and CIDR networks. Trusted sources bypass managed rate/connection accounting.

## Why are certificates listed as Unused?

A certificate is unused when no non-deleted Proxy Host, Redirection Host, 404 Host, or Stream references it. Unused certificates enter quarantine before automatic cleanup according to the Certificate Lifecycle settings.

## Are third-party NPM integrations guaranteed to work?

No. Many third-party integrations target upstream Nginx Proxy Manager. NPM Improved intentionally preserves API compatibility where practical, but compatibility must be verified per integration and version.

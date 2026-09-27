---
outline: deep
---

# NPM Improved Guide

NPM Improved is a compatibility-focused fork of Nginx Proxy Manager. It keeps Nginx as the traffic engine and the familiar host/certificate workflow, but changes the failure model and management architecture so configuration mistakes are recoverable instead of destructive.

## Development status

NPM Improved is currently pre-1.0. The `develop` branch is the integration branch. There is not yet a stable published NPM Improved container image, so production deployments should not be inferred from upstream Nginx Proxy Manager image tags.

## Key differences from upstream NPM

- the management listener is served by a standalone Go control-plane process;
- Nginx host changes are transactional and retain a last-known-good configuration;
- database host state is rolled back when the Nginx transaction fails;
- durable Configuration History records active, superseded, and failed revisions with safe restore;
- certificates have active/unused lifecycle states and quarantine cleanup;
- raw logs and structured security events are exposed in the UI;
- HTTP hosts can use managed Protection profiles;
- Proxy Hosts can use native Nginx upstream pools for backend load balancing and failover;
- multiple NPM Improved instances can synchronize through a primary/secondary HA model;
- SQLite installations can migrate to MySQL/MariaDB from the UI and back again later;
- Shared MySQL mode lets multiple NPMi proxy nodes use one database with Primary/Secondary write safety;
- repository rules and required checks are versioned with the project.

## Development setup

Requirements:

- Docker and Docker Compose;
- Git;
- `jq`.

Clone and start the development stack:

```bash
git clone https://github.com/gigabytegrove/npm-improved.git
cd npm-improved
./scripts/start-dev
```

The startup script prints the live development endpoints. The default development mapping exposes:

- admin UI: `http://127.0.0.1:3081`;
- Nginx HTTP listener: `http://127.0.0.1:3080`;
- Swagger UI: `http://127.0.0.1:3082`.

Stop the environment with:

```bash
./scripts/stop-dev
```

## Building an image from source

Until an official NPM Improved image is published, build directly from this repository:

```bash
./scripts/buildx --load -t npm-improved:dev
```

The production Dockerfile supports `linux/amd64` and `linux/arm64`.

## Management and traffic separation

The normal production ports remain:

| Port | Purpose |
| --- | --- |
| 80 | HTTP traffic |
| 81 | NPM Improved management control plane |
| 443 | HTTPS traffic |

Port 81 is no longer owned by the Nginx traffic process.

## Persistent state

Back up both locations before upgrades:

```text
/data
/etc/letsencrypt
```

See [Upgrading](/upgrading/) before moving between development snapshots.

## Configuration History

Administrators can inspect generated configuration revisions and restore superseded known-good states from **Configuration History**. See [Configuration History](/guide/config-history).

## Protection

See [HTTP Protection](/guide/protection) for profile behavior, trusted networks, per-host overrides, and limitations.

## Upstream attribution

NPM Improved is based on [Nginx Proxy Manager](https://github.com/NginxProxyManager/nginx-proxy-manager) and retains the upstream MIT license and attribution.

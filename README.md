# NPM Improved

**NPM Improved** is a compatibility-focused fork of [Nginx Proxy Manager](https://github.com/NginxProxyManager/nginx-proxy-manager) that keeps the familiar reverse-proxy workflow while fixing reliability, recovery, certificate lifecycle, observability, and security gaps that are difficult to solve as small upstream UI changes.

Repository: https://github.com/gigabytegrove/npm-improved

> **Development status:** NPM Improved is currently pre-1.0. The `develop` branch is the integration branch and should be treated as development software until a stable release is published.

## Why NPM Improved exists

The project keeps Nginx as the traffic engine, but moves toward a safer control-plane/data-plane design.

The major goals are:

- keep the management interface available when Nginx traffic configuration is broken;
- never replace a working Nginx host configuration with an invalid one;
- automatically restore the last-known-good configuration when validation or reload fails;
- keep database state aligned with the configuration that actually went live;
- make certificate ownership, usage, quarantine, renewal, and cleanup visible;
- expose access/error logs and structured security events in the UI;
- add polished application-layer request/connection protection without requiring users to write raw Nginx directives;
- retain practical compatibility with Nginx Proxy Manager configuration and workflows where possible.

## Current NPM Improved features

### Independent management control plane

The admin listener on port `81` is served by a standalone Go control-plane process instead of the Nginx traffic process.

The existing Node API remains behind that control plane while the backend is migrated incrementally. This separation means a broken site configuration or stopped Nginx data plane does not have to make the management listener disappear with it.

Control-plane health endpoint:

```text
/__npm_improved/health
```

### Transactional Nginx configuration

HTTP hosts and streams use a last-known-good transaction model:

```text
render candidate
      ↓
validate with nginx -t
      ↓
activate candidate
      ↓
reload Nginx
      ↓
commit
```

If validation or reload fails, the previous working configuration is restored automatically and the failed candidate is retained for diagnostics.

Database changes for proxy hosts, redirection hosts, 404 hosts, and streams are also restored when the Nginx transaction does not commit.

Settings that regenerate Nginx configuration use the same rollback model.

### Configuration History

NPM Improved records durable configuration revisions for Proxy Hosts, Redirection Hosts, 404 Hosts, and Streams.

Each revision records the operation, actor, database snapshot, generated Nginx configuration, state, exact activation error when applicable, and restore ancestry. Revisions move through **Pending**, **Active**, **Superseded**, or **Failed** states.

Existing hosts receive a baseline revision automatically before their first post-upgrade change. Failed candidates remain inspectable but cannot be restored. Superseded known-good revisions can be restored by an administrator; a restore regenerates and validates Nginx through the normal transactional path and creates a new active revision rather than rewriting history.

### Native recovery console

The standalone Go control plane exposes an emergency console at `/recovery/`. It remains available independently of the Node management API and normal React application.

The console uses a separate recovery token stored under `/data/recovery-access.json` with mode `0600`; the token is never emitted to application logs. It can report control-plane/backend/Nginx/storage health, run `nginx -t`, perform a validated Nginx reload, show failed configuration candidates, and download retained encrypted recovery backups.

See [Native Recovery Console](docs/src/guide/recovery-console.md).

### Backup & disaster recovery

Settings → **Backup & Recovery** can create encrypted, versioned `.npmibak` bundles.

**Configuration backups** are portable and contain hosts, streams, access lists, settings, configuration history, certificate records/material, Let's Encrypt state, and custom Nginx/default-site files while leaving destination user/JWT identity intact.

**Full disaster recovery backups** additionally preserve users, permissions, authentication/2FA records, configuration history, and the instance JWT keys so the same NPM Improved installation can be rebuilt after host or storage loss.

Backups require a passphrase and are encrypted with AES-256-GCM. Restore supports a non-destructive inspection step first, takes a local rollback snapshot before applying changes, regenerates all Nginx configuration, and automatically restores the prior database/filesystem state if `nginx -t` or reload fails.

See [Backup & Disaster Recovery](docs/src/guide/disaster-recovery.md).

### Certificate lifecycle management

Certificates are separated into active and unused states.

NPM Improved tracks certificate references across proxy hosts, redirection hosts, 404 hosts, and streams. Unused certificates enter a configurable quarantine before automatic cleanup, and referenced certificates cannot be deleted underneath a host.

### Logs and security observability

The UI includes raw system, Let's Encrypt, access, and error log viewing plus structured HTTP security events derived from recent access logs.

Security-event classification includes common probes such as:

- sensitive-file and `.env` requests;
- source/config disclosure attempts;
- path traversal patterns;
- SQL-injection-shaped requests;
- XSS-shaped requests;
- exploit endpoint probes;
- CMS/admin scanning;
- web-shell filename probes.

These classifications describe observed request patterns; they are not presented as proof of attacker intent.

### HTTP Protection

NPM Improved provides managed application-layer protection profiles for HTTP proxy, redirection, and 404 hosts:

- **Off** — no managed request/connection limiting;
- **Standard** — 30 requests/second per client per host, burst 60, up to 40 concurrent connections, and conservative slow-client timeouts;
- **Aggressive** — 10 requests/second per client per host, burst 20, up to 15 concurrent connections, and tighter slow-client timeouts;
- **Inherit** — per-host option that uses the global policy.

The global profile is managed from **Settings → Protection**. Hosts can override it individually without raw Nginx directives. Trusted IPv4/IPv6 addresses and CIDR networks can bypass managed request/connection accounting.

The policy is generated under `/data/nginx/protection/policy.conf` and changed transactionally: a new policy must pass `nginx -t` and reload successfully or the previous policy and database setting are restored.

Protection uses native Nginx request-rate, concurrent-connection, timeout, and timed-out-connection controls. It is intended to reduce application-layer floods and resource exhaustion. It cannot stop a volumetric DDoS attack that saturates the network connection before packets reach Nginx.

## Development environment

The repository retains the upstream development stack and scripts.

Requirements include Docker, Docker Compose, Git, and `jq`.

Start the development environment:

```bash
git clone https://github.com/gigabytegrove/npm-improved.git
cd npm-improved
./scripts/start-dev
```

The development script reports the local URLs when startup completes. By default the development admin UI is exposed on port `3081`, with the Nginx traffic listener on port `3080`.

Stop the development stack with:

```bash
./scripts/stop-dev
```

## Building the production image

NPM Improved does not currently advertise a stable published container image.

To build from source with the repository buildx script:

```bash
./scripts/buildx --load -t npm-improved:dev
```

For multi-platform publishing, pass the appropriate buildx output/push arguments instead of `--load`.

Do not substitute the upstream `jc21/nginx-proxy-manager` image when testing NPM Improved features; that image is the upstream project and does not contain this fork's changes.

## Ports and persistent data

The production container architecture continues to use the familiar ports:

| Port | Purpose |
| --- | --- |
| 80 | HTTP traffic |
| 81 | NPM Improved management control plane |
| 443 | HTTPS traffic |

Persistent data remains under:

```text
/data
/etc/letsencrypt
```

Back up both locations before testing upgrades.

## Compatibility and upgrades

NPM Improved is intentionally based on Nginx Proxy Manager and preserves its existing host types, database model, certificate workflow, and API patterns where practical.

However, this fork introduces new generated configuration, settings, control-plane services, certificate lifecycle behavior, and security features. Until a stable migration contract is published:

1. back up `/data` and `/etc/letsencrypt`;
2. test upgrades on a copy of the deployment first;
3. do not assume downgrade compatibility after the fork writes new state;
4. verify the admin control plane, proxy hosts, certificates, streams, and logs after each upgrade.

See the documentation under `docs/src/upgrading/` for current upgrade notes.

## Security

Please do **not** open public issues for security vulnerabilities.

See [SECURITY.md](SECURITY.md) for private reporting instructions and current support status.

## Documentation

Project documentation lives in `docs/` and is built with VitePress.

Build it locally with:

```bash
./scripts/docs-build
```

## Contributing

Changes should target the `develop` branch through pull requests and must pass the repository's required checks.

NPM Improved intentionally keeps attribution to the upstream Nginx Proxy Manager project. The upstream project is licensed under the MIT License; this fork remains under the repository's included MIT license.

## Upstream project

NPM Improved would not exist without Nginx Proxy Manager and its contributors:

https://github.com/NginxProxyManager/nginx-proxy-manager

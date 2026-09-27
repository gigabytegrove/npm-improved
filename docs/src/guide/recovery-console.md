---
outline: deep
---

# Native Recovery Console

NPM Improved includes a recovery console served directly by the standalone Go control plane.

Open:

```text
http://<npm-host>:81/recovery/
```

The recovery console does **not** depend on the Node management API or the normal React administration application. It is intended for situations where the normal management application is unavailable or Nginx configuration needs to be diagnosed independently.

## Recovery credential

The first time the control plane starts with recovery enabled, it creates a cryptographically random recovery token and stores it at:

```text
/data/recovery-access.json
```

The file is created with mode `0600`. The token is deliberately **not** written to application or container logs.

For the standard container, an administrator with host/container access can retrieve it with:

```bash
docker exec <container-name> cat /data/recovery-access.json
```

The token is separate from normal NPM Improved user authentication so recovery remains possible when the application database or Node backend is unavailable.

Store the recovery token with your disaster-recovery documentation or password manager. Anyone with this token and network access to the management port can access recovery operations.

The token remains stable across restarts as long as `/data/recovery-access.json` is preserved.

## Current recovery functions

The native console reports independent health for:

- the Go control plane;
- the Node management API;
- the Nginx process;
- the `/data` persistent-data path;
- the `/etc/letsencrypt` certificate path.

It also displays:

- failed generated configuration candidates retained as `.err` files, including authenticated read-only inspection of the rejected generated config;
- encrypted `.npmibak` recovery backups retained under `/data/backups`.

Available recovery operations include:

- run `nginx -t`;
- validate and reload Nginx;
- download retained encrypted recovery backups, including scheduled backups created under `/data/backups`.

A recovery-triggered Nginx reload is never attempted unless `nginx -t` succeeds first.

## Authentication behavior

Recovery authentication uses the separate recovery token rather than a normal NPM Improved login.

After successful authentication, the control plane creates a short-lived HttpOnly, SameSite=Strict recovery cookie. The recovery page uses same-origin requests and does not load external scripts, fonts, styles, or other assets.

Recovery API endpoints remain unavailable without the recovery credential even though the recovery page itself can be loaded.

## When to use it

Typical cases include:

- the normal admin UI loads but its API is unavailable;
- the Node backend is repeatedly restarting;
- Nginx is stopped;
- a generated configuration candidate failed validation;
- an operator needs a retained pre-restore backup while the main application is unhealthy;
- you need to test Nginx configuration without relying on the Node API.

## Relationship to Backup & Disaster Recovery

The normal **Settings → Backup & Recovery** workflow is the preferred way to create, inspect, and restore encrypted backups when the management application is healthy.

The native recovery console provides an independent emergency path to inspect system health and retrieve retained recovery bundles when the normal management stack is not healthy.

See [Backup & Disaster Recovery](/guide/disaster-recovery) for backup contents, encryption, restore validation, and rollback behavior.

## Environment overrides

The production defaults are:

| Setting | Default |
| --- | --- |
| Recovery token file | `/data/recovery-access.json` |
| Backup directory | `/data/backups` |
| Persistent data root | `/data` |
| Let's Encrypt root | `/etc/letsencrypt` |
| Nginx binary | `/usr/sbin/nginx` |
| Nginx PID file | `/run/nginx/nginx.pid` |

Advanced deployments can override these paths with:

```text
NPM_RECOVERY_TOKEN_FILE
NPM_BACKUPS_DIR
NPM_DATA_DIR
NPM_LETSENCRYPT_DIR
NPM_NGINX_BINARY
NPM_NGINX_PID_FILE
```

Changing these values is normally unnecessary in the standard container image.

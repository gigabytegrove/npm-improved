---
outline: deep
---

# Advanced Configuration

## Runtime user/group

The container starts as root for initialization and can run services under the configured PUID/PGID afterward.

```yaml
services:
  app:
    image: npm-improved:dev
    environment:
      PUID: 1000
      PGID: 1000
```

Startup adjusts ownership of required persistent/runtime paths. Test custom IDs before using them on production data.

## Docker network best practice

When upstream applications run on the same Docker host, place them on a private Docker network and proxy to service names instead of publishing every upstream port on the host.

```bash
docker network create proxy
```

Then attach NPM Improved and the upstream application to that external network.

```yaml
networks:
  default:
    external: true
    name: proxy
```

## Docker file secrets

Environment variables can be populated from files by appending `__FILE` to the variable name.

Example:

```yaml
secrets:
  mysql_password:
    file: .secrets/mysql_password

services:
  app:
    image: npm-improved:dev
    environment:
      DB_MYSQL_HOST: db
      DB_MYSQL_USER: npm
      DB_MYSQL_PASSWORD__FILE: /run/secrets/mysql_password
      DB_MYSQL_NAME: npm
    secrets:
      - mysql_password
```

## IPv6

If IPv6 is unavailable on the Docker host:

```yaml
environment:
  DISABLE_IPV6: "true"
```

## Disable dynamic resolver generation

```yaml
environment:
  DISABLE_RESOLVER: "true"
```

When disabled, Nginx falls back to the container's normal host/resolver behavior.

## IP range fetch

The inherited CDN IP-range update can be disabled in restricted environments:

```yaml
environment:
  IP_RANGES_FETCH_ENABLED: "false"
```

## Custom Nginx configuration

Custom snippets remain available under `/data/nginx/custom`.

Supported include points include:

- `root_top.conf`
- `root.conf`
- `http_top.conf`
- `http.conf`
- `events.conf`
- `stream.conf`
- `server_proxy.conf`
- `server_redirect.conf`
- `server_stream.conf`
- `server_stream_tcp.conf`
- `server_stream_udp.conf`
- `server_dead.conf`

Every file is optional.

::: warning
Custom Nginx directives can override or conflict with managed configuration. NPM Improved validates generated changes before commit, but advanced directives remain the administrator's responsibility.
:::

## Managed HTTP Protection

NPM Improved writes the global generated policy to:

```text
/data/nginx/protection/policy.conf
```

Do not edit that file manually; Settings → Protection owns it and updates it transactionally.

For supported controls and per-host overrides, see [HTTP Protection](/guide/protection).

## X-Frame-Options for the management UI

```yaml
environment:
  X_FRAME_OPTIONS: "SAMEORIGIN"
```

The default is `DENY`.

## Log rotation

The default logrotate file remains:

```text
/etc/logrotate.d/nginx-proxy-manager
```

You can mount your own configuration there if your retention requirements differ.

## GeoIP2

The inherited Nginx build includes dynamic modules. To load GeoIP2 through a custom root-level snippet, create `/data/nginx/custom/root_top.conf` with the appropriate `load_module` directives for the installed module paths.

Verify the exact module paths in the image you built before enabling them.

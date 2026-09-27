---
outline: deep
---

# Security

## Management-plane resilience

The admin listener is independent from the Nginx traffic process. A broken generated site configuration should not make port 81 disappear with it.

The control-plane health endpoint is:

```text
/__npm_improved/health
```

It intentionally exposes only coarse component state needed for degraded-mode diagnosis. Raw Nginx validation errors, configuration text, database details, and other sensitive diagnostics remain behind authenticated administration APIs.

## Configuration safety

Generated changes are validated with `nginx -t` before they are allowed to replace the last-known-good configuration. Failed candidates are retained for diagnostics.

## Recovery history

Configuration History keeps durable known-good revisions and failed candidates for administrators. Restores are revalidated with `nginx -t` and normal reload handling; historical configuration files are never copied blindly into service.

## Logs and security observability

The Logs workspace includes raw logs and structured Security Events. Event classification identifies request patterns such as sensitive-file probes, path traversal, injection-shaped requests, CMS scanning, and exploit endpoint probes.

These are classifications of request behavior, not definitive attribution of malicious intent.

## HTTP Protection

Use Settings → Protection for managed request/connection controls. See [HTTP Protection](/guide/protection).

## Certificate safety

Certificates referenced by active database objects cannot be removed through normal lifecycle cleanup. Unused certificates enter quarantine before purge.

DNS-provider credentials are only written to the Certbot credential file when needed for a Certbot operation and are removed afterward.

## Vulnerability reporting

Do not disclose an unpatched vulnerability in a public issue or pull request.

Use the private reporting path documented in the repository [SECURITY.md](https://github.com/gigabytegrove/npm-improved/blob/develop/SECURITY.md).

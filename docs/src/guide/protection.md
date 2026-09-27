---
outline: deep
---

# HTTP Protection

NPM Improved includes managed application-layer protection for HTTP proxy hosts, redirection hosts, and 404 hosts.

The goal is to provide useful abuse and resource-exhaustion controls without requiring administrators to hand-author Nginx rate-limit directives.

## Global profiles

Configure the global policy under **Settings → Protection**.

### Off

No global managed request or connection limiting is applied.

Hosts can still explicitly select Standard or Aggressive.

### Standard

Designed as the normal public-service default:

- 30 requests/second per client per host;
- burst allowance of 60 requests;
- 40 concurrent connections per client per host;
- 15-second client-header timeout;
- 30-second client-body timeout;
- 30-second send timeout;
- timed-out connections are reset;
- request/connection limiting returns HTTP 429.

### Aggressive

For low-volume or higher-risk public endpoints:

- 10 requests/second per client per host;
- burst allowance of 20 requests;
- 15 concurrent connections per client per host;
- 10-second client-header timeout;
- 15-second client-body timeout;
- 20-second send timeout;
- timed-out connections are reset;
- request/connection limiting returns HTTP 429.

## Per-host policy

Proxy Hosts, Redirection Hosts, and 404 Hosts have a **Protection** tab with:

- **Inherit global policy**
- **Off**
- **Standard**
- **Aggressive**

A host-specific selection replaces the inherited managed request/connection policy for that server block. Selecting **Off** suppresses the inherited managed limiter and restores relaxed client timeouts for that host.

## Trusted networks

Settings → Protection accepts one IPv4/IPv6 address or CIDR per line.

Examples:

```text
10.0.0.0/8
192.168.1.50
172.16.0.0/12
2001:db8::/32
```

Addresses without a prefix are normalized to `/32` for IPv4 or `/128` for IPv6. Loopback is always trusted.

Trusted sources are excluded from the managed rate and connection counters.

Accounting uses Nginx's resolved client address after the configured real-IP processing, combined with the requested host. One client therefore has a separate allowance for each proxied hostname instead of sharing one rate bucket across the entire NPM Improved instance.

Only add networks you actually trust. Broad private ranges should not be entered merely because they are private if untrusted clients can reach NPM Improved from those networks.

## What this protects against

The managed profiles are intended to reduce:

- HTTP request floods that reach Nginx;
- excessive parallel connections from one source;
- Slowloris-style header starvation;
- slow request-body resource use;
- slow response-reader resource retention;
- repeated abusive requests that would otherwise consume upstream resources.

## What this does not protect against

NPM Improved cannot stop traffic that has already saturated the network link.

For example, a 10 Gbit/s volumetric attack against a 1 Gbit/s Internet connection cannot be solved by Nginx because the connection is congested before Nginx can process or reject the packets.

Large volumetric attacks require upstream mitigation from an ISP, CDN, reverse-proxy provider, hosting network, or dedicated DDoS service.

## WebSockets and long-lived applications

Standard defaults are intentionally less aggressive than the Aggressive profile, but some applications may legitimately require unusual connection behavior.

If a service is sensitive to connection limits or timeout behavior, set that host to **Off** or use a less restrictive profile and verify application behavior.

## Security event visibility

Rate-limited responses use status 429 and appear in access logs. The Security Events workspace also counts denied/throttled responses alongside classified probe patterns.

## Transactional policy changes

The generated global policy is stored at:

```text
/data/nginx/protection/policy.conf
```

Saving Protection settings creates a candidate policy, validates the complete Nginx configuration with `nginx -t`, reloads Nginx, and only then commits the change. If validation or reload fails, NPM Improved restores both the previous policy file and the previous database setting.

## Upgrade behavior

Existing installations receive the managed policy file automatically. The default global profile is **Standard**. Review the Protection page after upgrading, especially for high-throughput APIs, WebSocket-heavy applications, or services where a single client legitimately opens many parallel connections.

# Analytics Center — Local node traffic

Open **Analytics Center** in the System sidebar to see traffic processed by the NPM Improved node you are currently managing.

**This view is node-local.** NPMX configuration synchronization does not merge or replicate analytics. A request handled by node A appears only on A, even if the same Proxy Host exists on nodes B, C and D.

## Coverage

The Node Analytics Center uses two separate sources and never adds their counters together:

### HTTP request analytics
- Proxy Hosts: HTTP/HTTPS requests forwarded to upstreams.
- Redirection Hosts: requests returning redirects.
- 404 Hosts: configured unmatched/blocked responses.
- Generated default site and built-in fallback HTTP routing.

HTTP metrics include total requests, 2xx/3xx/4xx/5xx breakdowns, response/request-size bytes, traffic by hour/day, top hosts/domains/methods/protocols, URL paths, device classes, upstream statuses, response-time percentiles, slow routes, 4xx/5xx paths, and sanitized request explorer/CSV. Admins can filter by source, status class or period and link from a Proxy Host row to the **unchanged** Host Analytics page.

### TCP / UDP stream analytics
- Configured NPMi Layer 4 streams and stream fallback.
- Completed TCP/UDP session counts, bytes received/sent, per-stream port, and timeseries totals.
- Nginx stream sessions are *not* HTTP requests. Long-lived connections show up after they close; UDP session semantics follow Nginx stream session accounting.

### Collection
Nginx writes structured `*_analytics.log` events. The app consumes these locally every ~10 seconds with durable inode/offset checkpoints, partial-line handling, log rotation support and malformed-event rejection. Two independent SQLite datasets store HTTP requests and stream sessions in `/data/analytics.sqlite` with raw event retention (default seven days) and hourly rollups (default 90 days).

Old persisted proxy, redirect, 404, default and stream Nginx configs are updated automatically on startup using validated Nginx configuration and rollback on error. No existing Host Analytics routes or stored data are removed.

### Full traffic investigations (v1.5.0+)
The Analytics Center now stores additional structured fields for **new** managed
HTTP requests: effective source IP, upstream peer IP, full user-agent string
(up to 1024 characters), request ID, Nginx connection ID and request count,
millisecond timestamp, HTTP/HTTPS scheme, TLS version, bot-category heuristic,
and a reason when a request was blocked by a node-local rule.

Dedicated **Client IPs** and **User agents & bots** tabs show high-volume
sources and claimed bot families. Clicking a source opens a filtered request
history; the explorer can additionally filter by exact agent, bot category or
connection ID. CSV exports include the investigation fields. The request
history is *HTTP request-level*; it does not claim to provide packet captures
or every TCP handshake. TCP/UDP stream sessions remain a separate tab.

**Blocking:** Authorized administrators can add and remove IPv4/IPv6 addresses,
CIDR ranges, or case-insensitive literal user-agent substring rules from the
**IP / agent blocking** tab. Changes activate in Nginx immediately with
configuration validation, reload and automatic rollback if validation fails.
403 responses are logged as blocked events. The policy and audit trail stay
on the individual node (NPMX sync does not copy node observations or deny
rules). An explicit opt-in scanner-signature action installs a conservative
collection of scanner UA patterns; common search crawler claims are not
automatically banned.

### History, accuracy, and privacy
- Default detailed HTTP history: **30 days** (configurable 1–90 via
  `NPM_ANALYTICS_RAW_DAYS`); hourly rollups: **365 days** (configurable
  30–365 via `NPM_ANALYTICS_ROLLUP_DAYS`). Longer raw retention increases
  disk usage; monitor `/data/analytics.sqlite`.
- Source IPs and full user agents are retained on the **local node only** and
  returned only through authenticated administrator analytics endpoints. Backups
  containing `analytics.sqlite` should be protected as sensitive data.
- IP addresses identify network endpoints, not people. Shared IPs, VPNs,
  proxies and forged user-agent strings mean request counts do not establish
  unique individuals or verified bots. Do not automatically block mainstream
  claimed crawlers without verifying their network identity.
- With `real_ip_header X-Real-IP`, the effective IP depends on the
  administrator's trusted-proxy configuration. Review and tighten trusted
  upstream ranges before making decisions on forwarded addresses.
- No request bodies, cookies, authentication headers, query values or full
  referrer URLs are recorded in the analytics database. Paths are sanitized.
- Countries/cities/ASN are **not** inferred without a configured and maintained
  GeoIP dataset. Handshakes rejected before an HTTP request and port-81 UI
  traffic are not counted as proxied HTTP requests.
- Events predating v1.5.0 do not gain IPs or full user agents retroactively.
  Extended breakdowns are unavailable once raw events expire, while aggregate
  status/byte/time trends remain.
- Raw CSV export is capped at 10,000 sanitized requests with formula-escaping.
  The detailed request explorer is paged.

## NPMX at 30 seconds and WAN nodes
The default NPMX polling interval for *new* pairings is 30 seconds; existing nodes retain their explicit saved intervals. Set older nodes to 30 in **Settings → Instance Synchronization** if desired. Secondary nodes pull changes from the Primary. More geographically distributed nodes mean more snapshot requests to the Primary; the current protocol is polling-based and does not yet provide event-driven push, change-only deltas, or a multi-primary write topology. Provision bandwidth and monitor sync errors accordingly.

The source node can be identified by its NPMX node name/ID in the Analytics Center. **Never treat a local-node total as the combined traffic for all synchronized instances.**

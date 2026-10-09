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

### Limits and privacy
- Only traffic logged by NPMi's managed Nginx routes is measurable. Port-81 Control Center traffic and handshakes rejected before an HTTP request are not proxy traffic.
- No IP addresses, cookies, authorization headers, query values, bodies or full user agents are stored in the analytics database. Existing standard logs have their own retention policies.
- Unique humans, cities, countries, session-user tracking and attribution are **not** inferred from request counts. Automated device type is estimated from user agents.
- Historical detail not present before instrumentation cannot be reconstructed. Detailed paths and latency percentiles are not available after raw-record expiry; aggregate totals remain.
- CSV exports are capped at 10,000 sanitized HTTP events. Node-wide analytics are restricted to administrators (Settings read permission).

## NPMX at 30 seconds and WAN nodes
The default NPMX polling interval for *new* pairings is 30 seconds; existing nodes retain their explicit saved intervals. Set older nodes to 30 in **Settings → Instance Synchronization** if desired. Secondary nodes pull changes from the Primary. More geographically distributed nodes mean more snapshot requests to the Primary; the current protocol is polling-based and does not yet provide event-driven push, change-only deltas, or a multi-primary write topology. Provision bandwidth and monitor sync errors accordingly.

The source node can be identified by its NPMX node name/ID in the Analytics Center. **Never treat a local-node total as the combined traffic for all synchronized instances.**

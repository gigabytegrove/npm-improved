# Exhaustive Proxy Host Analytics

**Status: design specification; functionality not yet implemented.**

## Existing capabilities
`backend/templates/proxy_host.conf` already sends requests to `/data/logs/proxy-host-{{ id }}_access.log` with `proxy` log format and errors to `/data/logs/proxy-host-{{ id }}_error.log`. Confirm the actual `log_format proxy` before claiming historical field availability.

## Host drill-down UI
Each Proxy Host row/name opens a detail page with an **Analytics** section and the following panels:
- **Overview:** total requests, RPS, bytes in/out when measurable, distinct IP addresses (not people), 2xx/3xx/4xx/5xx, error percentages, latency percentiles p50/p95/p99 when instrumented.
- **Traffic:** per-minute/hour/day charts, status breakdown, hostname (multi-domain), HTTP method/protocol, bandwidth, compared period.
- **Performance:** total/upstream response time, slow routes, upstream response status/address, 502/503/504 trends, backend failures.
- **Visitors:** unique IP estimates, user agents, referrers, bot heuristics, optional privacy-safe country/ASN; explicitly separate measured vs inferred.
- **Requests:** top paths/resources, method/status filters, request timeline and searchable paginated event details.
- **Security:** 401/403/404/429 trends, rejected requests, access list/protection events when recorded; never infer threat classification from HTTP status alone.
- **Errors:** filtered Nginx errors with correlated traffic and upstream failures.
- **Export:** restricted CSV/JSON by permission; aggregate export and optional sanitized event export.

Filters: live, 1h, 24h, 7d, 30d, custom; timezone; hostname; response class; compare period; local source node. Responsive graphs/tables, accessibility, data definitions, and honest no-data states.

## Collection and storage
1. Add reliably escaped structured per-host Nginx access logs with stable host ID, node ID, timestamp, hostname, method, URI **path excluding query string**, protocol, status, request/response bytes, total and upstream timings, upstream address/status, referrer and user agent when safe, and request ID.
2. Never trust client forwarded headers except from explicitly configured trusted proxies. Do not record request/response bodies, Authorization/Cookie headers, session tokens, or query parameters by default. Configurable anonymization and bounded retention.
3. Background ingestion with durable file cursor/inode, log rotation handling, restart recovery, malformed-record quarantine, idempotency and backpressure; no data ingestion in the Nginx serving path.
4. Maintain bounded raw log retention (suggest default 7 days) and longer aggregated buckets (suggest 90 days), with disk caps, pruning, indexes and suitable batch operations. Support both SQLite and MySQL.
5. API: host-scoped overview, timeseries, breakdowns, searchable events, error events, export. Server-side filters/pagination/time range limits and permission enforcement using existing Proxy Host visibility controls.
6. NPMX: analytics remain node-local unless safe aggregate exchange supports explicit node/event IDs to avoid double counting; NPMX config sync must never blindly replicate raw metrics as if independent observations.

## Acceptance tests
- Reconcile request totals/status/bytes with controlled access logs; latency accuracy verified with fixtures.
- Rotations/truncation/restarts produce no duplicates.
- Existing host routing/TLS/config migrations remain working.
- A user with no host permission cannot query or export its analytics.
- Heavy traffic does not slow down request forwarding; cleanup enforces storage limits.
- Cross-node summaries label individual node and do not count replicated events twice.
- Historical data not present in the original logs is clearly marked unavailable rather than fabricated.

## Delivery phases
1. Structured logging and database ingestion/aggregation with tests.
2. Authenticated host-scoped API and privacy/retention settings.
3. Host detail Analytics UX, charts, filtering, exports.
4. Advanced performance/security and optional clustered aggregation with benchmarks.

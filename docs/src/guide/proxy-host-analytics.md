# Proxy Host Analytics

NPM Improved records **node-local** traffic metrics for each Proxy Host using a dedicated structured Nginx access log. Open **Proxy Hosts → Analytics** on an individual host.

## Available metrics
- HTTP request counts, 2xx/3xx/4xx/5xx distribution and traffic over time.
- Response bytes sent and inbound request size (not request body contents).
- p50, p95 and p99 response-time estimates for retained raw records.
- Most requested paths (sanitized), methods, hostnames, upstream response codes and inferred device categories.
- Bounded, paginated individual request details with optional status filtering.
- One-hour, one-day, seven-day, 30-day and 90-day windows. Longer windows use hourly rollups.

## Collection and data policy
- Structured events are written to `/data/logs/proxy-host-<id>_analytics.log`. Existing access/error logs continue unchanged.
- The backend reads events in the background, checkpoints source file offsets, handles truncation and one uncompressed rotated log, and saves node-local records to `/data/analytics.sqlite`.
- The collector does **not** persist raw IPs, cookies, authorization headers, bodies, full query strings or full user agents. Path segments with opaque keys, UUIDs and emails are redacted where recognized. Existing traditional Nginx access logs retain their own logging policy.
- Default retention: raw events seven days and hourly aggregates 90 days. Configure `NPM_ANALYTICS_RAW_DAYS` (1–30) and `NPM_ANALYTICS_ROLLUP_DAYS` (30–365).
- Set `NPM_ANALYTICS_ENABLED=false` to disable background ingestion. This does not disable Nginx writing structured analytics log files.
- Historical metrics before the analytics logging update are **not** backfilled. Metrics missing from older log formats are shown as unavailable.
- NPMX does not synchronize analytics traffic data. Traffic served by each node is measured on that node alone.

## Privacy and accuracy
Distinct IP counts and geographic enrichment are not collected. Device classes inferred from user agents are estimates. HTTP 401/403/404 statuses are not, by themselves, evidence of an attack. Raw event retention and storage requirements should be reviewed for large deployments.

## Operational verification
Check that new requests generate `/data/logs/proxy-host-<id>_analytics.log`, that the collector creates `/data/analytics.sqlite`, and that the host-specific API `GET /api/nginx/proxy-hosts/<id>/analytics?hours=24` returns growing request counts. The API requires the same read permission as accessing the Proxy Host.

## Exports
The Requests tab can export up to 10,000 sanitized records in CSV format for the selected raw-retention window. Downloads enforce the same host permission as the analytics page. If the window contains more than 10,000 requests, the response marks the export as truncated.

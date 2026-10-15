# Analytics Center — Dedicated section pages

The Analytics Center is a **full section of NPM Improved** under System → Analytics Center. It reports **only measurements recorded on the current node**, even when that node shares configuration through NPMX with other locations.

## Pages and links

| Section | URL | Purpose |
| --- | --- | --- |
| Overview | `/analytics` | Node summary, status breakdown, most active hosts |
| Trends | `/analytics/trends` | Requests, sent bytes and server errors over time, interval breakdown |
| Traffic Breakdown | `/analytics/traffic` | Top paths, domains, HTTP methods/protocols, device estimates and upstreams |
| HTTP Routes | `/analytics/hosts` | All measured proxy hosts, redirects, 404, default and fallback HTTP routes; click into unchanged Host Analytics |
| TCP/UDP Streams | `/analytics/streams` | Completed Nginx Layer 4 sessions and bytes (never combined into HTTP requests) |
| Request History | `/analytics/requests` | Individual timestamps, IPs, full user agents, request and connection IDs, statuses, latency and export |
| Connection History | `/analytics/connections` | Recorded Nginx connection identifiers grouped from request events, with IP and ID filters |
| IP Addresses | `/analytics/ips` | Distinct source addresses, request counts, errors and first/last observations |
| User Agents & Bots | `/analytics/user-agents` | Full user-agent strings, bot classes and request history |
| Errors & Security | `/analytics/security` | Error paths, upstream failures and status details |
| Blocking & Enforcement | `/analytics/blocking` | Node-local IP/CIDR and user-agent rules, scanner signature presets, audit, removal |
| Performance | `/analytics/performance` | P50/P95/P99 latency and slow endpoints |

Every destination is a separate URL and a dedicated lazily loaded page. Browser Back/Forward work; users can bookmark and directly open a section. Date, host and response-class filters remain in the common section header. Clicking an IP, bot or user agent opens **Request History** with the relevant URL filter. Preparing a block opens **Blocking & Enforcement** with its target populated.

The original per-proxy-host detailed Analytics page at `/nginx/proxy/:id/analytics` is unchanged. The new section does not remove, rename or replace it.

## Scope, collection and limitations

NPMi collects local structured Nginx HTTP events. The request explorer can filter by IP, full user agent, bot classification and Nginx connection identifier.

The IP Addresses and User Agents & Bots pages each have a **server-paginated directory** over the complete retained raw-event data set. They include substring search, 50-row pages, per-value request/error/blocked counts, bytes, first/last seen, request-history drill-down and links to prepare local blocking rules. These directories are **not** capped by the Overview report's top-100/top-60 summaries. Filters apply to retained raw events, not aggregate rollups. Old requests or IPs that weren't recorded cannot be backfilled.

**Connection History is an HTTP log-based reconstruction.** A row indicates first and last observed completed *requests* for a connection identifier in the displayed page of events. It is not an OS-level socket/session monitor, not SYN/FIN timestamps, and cannot guarantee a complete connection session across log rotation or pagination. TCP/UDP Nginx Stream data is a separate page.

Block policies are local to the current node. Nginx validates generated changes before reloading, and failed activations roll back. Scanner presets are opt-in; user-agent classifications are self-asserted and not cryptographic bot identities. Blocking a user agent can affect legitimate traffic. Node-specific blocking and analytics do not automatically replicate through NPMX.

Raw IP and user-agent data is sensitive operational telemetry. Restrict administrator access and set retention appropriately. Never interpret one IP as one human visitor.

## Navigation and usability

The Analytics Center uses a persistent section navigation grouped into Reporting, Investigation and Security, with responsive scrolling on narrow screens. The root path remains a landing page but is not the only content view. Page-level modules load only when their route is visited. An explicit data-coverage footer shows the retention scope and node identity.



## Near-real-time per-route investigation (development branch)

The new **Live Host Traffic** view is reached from **HTTP Routes → Live traffic**, **Route analytics → Inspect live traffic**, or **Proxy Host Analytics → Live traffic & threats**. It is a separate source-scoped API and page, shared conceptually with the planned Android client. It does not replace the existing reporting pages.

- 5-, 15-, or 60-minute windows; retained structured log events; 10-second ingestion and 10-second foreground refresh (pausable).
- Per-minute request volume, bytes served, HTTP error counts, unique source IPs, recently denied requests, path totals and recent timestamped requests.
- Browser and client families are inferred from the **claimed** user-agent header, not verified browser identity.
- Candidate IP addresses and user agents are ranked using recorded sensitive-path probes, high volumes of 404 responses, elevated request rates and previously denied requests. A user agent merely calling itself YandexBot or another crawler is **not** automatically malicious.
- Each client can be investigated through the existing full IP/UA profiles. The current **prepare block** workflow is intentionally labeled **node-wide**: existing Nginx deny rules affect every HTTP host served by the node. Enforcement stays manual, admin-only and requires confirmation.
- Geographic enrichment is explicitly unavailable until a local, privacy-preserving GeoIP source has been configured. No guessed country, city or map location is rendered.
- This feature reads completed ingested requests, not active sockets, TCP packets, raw application payloads or unrecorded traffic.

High-confidence host-specific deny rules, reversible temporary blocks, trusted bot verification, ASN/country enrichment and remote multi-node aggregation require additional security and performance work; they are not part of this initial live view.

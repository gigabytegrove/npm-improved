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

NPMi collects local structured Nginx HTTP events. The request explorer can filter by IP, full user agent, bot classification and Nginx connection identifier. Filters apply to retained raw events, not aggregate rollups. Old requests or IPs that weren't recorded cannot be backfilled.

**Connection History is an HTTP log-based reconstruction.** A row indicates first and last observed completed *requests* for a connection identifier in the displayed page of events. It is not an OS-level socket/session monitor, not SYN/FIN timestamps, and cannot guarantee a complete connection session across log rotation or pagination. TCP/UDP Nginx Stream data is a separate page.

Block policies are local to the current node. Nginx validates generated changes before reloading, and failed activations roll back. Scanner presets are opt-in; user-agent classifications are self-asserted and not cryptographic bot identities. Blocking a user agent can affect legitimate traffic. Node-specific blocking and analytics do not automatically replicate through NPMX.

Raw IP and user-agent data is sensitive operational telemetry. Restrict administrator access and set retention appropriately. Never interpret one IP as one human visitor.

## Navigation and usability

The Analytics Center uses a persistent section navigation grouped into Reporting, Investigation and Security, with responsive scrolling on narrow screens. The root path remains a landing page but is not the only content view. Page-level modules load only when their route is visited. An explicit data-coverage footer shows the retention scope and node identity.


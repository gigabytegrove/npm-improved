import {
  IconActivity, IconArrowUpRight, IconChartBar, IconDownload,
  IconRefresh, IconServer, IconShieldCheck, IconTransfer,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  exportNodeAnalytics, getNodeAnalytics, getNodeAnalyticsRequests,
  type HttpStatusClass, type NodeBreakdown, type NodeFilters,
  type NodeHours, type NodeHost, type NodeReport,
} from "src/api/backend";
import { HasPermission } from "src/components";
import { ADMIN } from "src/modules/Permissions";
import "./analytics-center.css";

type Tab = "overview" | "hosts" | "traffic" | "streams" | "performance" | "security" | "requests";
const tabs: Array<{ id: Tab; text: string }> = [
  { id: "overview", text: "Overview" },
  { id: "hosts", text: "HTTP Routes" },
  { id: "streams", text: "TCP / UDP Streams" },
  { id: "traffic", text: "Traffic & breakdowns" },
  { id: "performance", text: "Performance" },
  { id: "security", text: "Errors & security" },
  { id: "requests", text: "Request explorer" },
];
const periods: Array<{ hours: NodeHours; label: string }> = [
  { hours: 1, label: "Last hour" },
  { hours: 24, label: "Last 24 hours" },
  { hours: 168, label: "Last 7 days" },
  { hours: 720, label: "Last 30 days" },
  { hours: 2160, label: "Last 90 days" },
];
const statusClasses: HttpStatusClass[] = ["2xx", "3xx", "4xx", "5xx"];
const formatNumber = (value: number) => Number(value || 0).toLocaleString();
const formatBytes = (value: number) => {
  if (!value) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const position = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** position).toFixed(position ? 1 : 0)} ${units[position]}`;
};
const formatMs = (value: number | null) => value === null ? "Unavailable" : `${value.toFixed(1)} ms`;
const formatDate = (value: string | null) => value ? new Date(value).toLocaleString() : "No measurements yet";

function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="col-sm-6 col-xl-3">
    <div className="card h-100 npmi-center-metric"><div className="card-body">
      <div className="text-secondary small">{label}</div>
      <div className="h2 mt-2 mb-1">{value}</div>
      <div className="text-secondary small">{sub}</div>
    </div></div>
  </div>;
}

function MetricChart({ timeline, kind }: {
  timeline: NodeReport["timeline"];
  kind: "requests" | "bytesOut" | "errors";
}) {
  const width = 900;
  const height = 200;
  const pad = 12;
  const maximum = Math.max(1, ...timeline.map((point) => point[kind]));
  const positions = timeline.map((point, index) => ({
    x: pad + (timeline.length < 2 ? 0 : index * (width - 2 * pad) / (timeline.length - 1)),
    y: height - pad - point[kind] / maximum * (height - 2 * pad),
  }));
  const path = positions.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  return <div className="npmi-center-chart">
    {timeline.length ? <>
      <svg role="img" aria-label={`Local node ${kind} over time`} viewBox="0 0 900 200" preserveAspectRatio="none">
        <title>Node traffic chart</title>
        <line x1="12" x2="888" y1="188" y2="188" stroke="currentColor" opacity=".2"/>
        <path d={path} fill="none" stroke="#238cce" strokeWidth="3" vectorEffect="non-scaling-stroke"/>
        {positions.map((point, index) =>
          <circle key={timeline[index].at} cx={point.x} cy={point.y} r="3.5" fill="#238cce">
            <title>{new Date(timeline[index].at).toLocaleString()}: {kind === "bytesOut"
              ? formatBytes(timeline[index][kind]) : formatNumber(timeline[index][kind])}</title>
          </circle>)}
      </svg>
      <div className="d-flex justify-content-between text-secondary small gap-2">
        <span>{new Date(timeline[0].at).toLocaleString()}</span>
        <span>Peak: {kind === "bytesOut" ? formatBytes(maximum) : formatNumber(maximum)}</span>
        <span>{new Date(timeline[timeline.length - 1].at).toLocaleString()}</span>
      </div>
    </> : <div className="text-secondary py-5 text-center">No request data in this period.</div>}
  </div>;
}

function Breakdown({ title, items, empty = "No retained raw records.", limit = 15 }: {
  title: string; items: NodeBreakdown[]; empty?: string; limit?: number;
}) {
  const max = Math.max(1, ...items.map((item) => item.requests));
  return <div className="card h-100">
    <div className="card-header"><h3 className="card-title">{title}</h3></div>
    <div className="table-responsive">
      <table className="table table-vcenter card-table">
        <thead><tr><th>Value</th><th className="text-end">Requests</th><th className="text-end">Traffic</th></tr></thead>
        <tbody>
          {items.slice(0, limit).map((item, index) =>
            <tr key={`${item.label}-${index}`}>
              <td className="npmi-center-breakdown-label">
                <div className="text-break">{item.label || "Unknown"}</div>
                <div className="npmi-center-bar"><div style={{width: `${100 * item.requests / max}%`}}/></div>
              </td>
              <td className="text-end">{formatNumber(item.requests)}</td>
              <td className="text-end">{formatBytes(item.bytesOut)}</td>
            </tr>)}
          {!items.length ? <tr><td colSpan={3} className="text-secondary">{empty}</td></tr> : null}
        </tbody>
      </table>
    </div>
  </div>;
}

const routeName = (host: NodeHost) => host.kind === "default" ? "Default site"
  : host.kind === "fallback" ? "Fallback HTTP"
    : host.domains.join(", ") || `${host.kind === "proxy" ? "Proxy Host" : host.kind === "redirection" ? "Redirect" : "404 Host"} #${host.routeId}`;

function RouteRef({ hostId }: {hostId: number}) {
  return hostId > 0 ? <Link to={`/nginx/proxy/${hostId}/analytics`}>#{hostId}</Link>
    : <span className="text-secondary">{hostId <= -3000000 ? "Default / fallback" : hostId < -2000000 ? "404 Host" : "Redirect"}</span>;
}

function HostTable({ hosts }: { hosts: NodeHost[] }) {
  const max = Math.max(1, ...hosts.map((item) => item.requests));
  return <div className="card">
    <div className="card-header d-flex align-items-center justify-content-between">
      <h3 className="card-title">HTTP requests by route</h3>
      <span className="text-secondary small">{hosts.length} reporting hosts</span>
    </div>
    <div className="table-responsive">
      <table className="table table-vcenter card-table">
        <thead><tr><th>Proxy Host</th><th className="text-end">Requests</th>
          <th className="text-end">Bandwidth out</th><th className="text-end">5xx</th><th>Volume</th></tr></thead>
        <tbody>
          {hosts.map((host) => <tr key={host.hostId}>
            <td className="text-break">
              {host.kind === "proxy" && host.configured
                ? <Link to={`/nginx/proxy/${host.routeId}/analytics`} className="fw-semibold">
                    {routeName(host)} <IconArrowUpRight size={15}/>
                  </Link>
                : host.kind === "redirection" || host.kind === "dead"
                  ? <Link className="fw-semibold" to={host.kind === "redirection" ? "/nginx/redirection" : "/nginx/404"}>
                      {routeName(host)} <IconArrowUpRight size={15}/>
                    </Link>
                  : <span className="fw-semibold">{routeName(host)}</span>}
              <div className="text-secondary small">{host.kind} · {host.routeId ?? "node"}
                {host.enabled === false ? " · Disabled" : ""}
                {!host.configured ? " · Removed" : ""}
              </div>
            </td>
            <td className="text-end">{formatNumber(host.requests)}</td>
            <td className="text-end">{formatBytes(host.bytesOut)}</td>
            <td className="text-end">{formatNumber(host.errors)}</td>
            <td className="npmi-center-host-bar"><div className="npmi-center-bar">
              <div style={{width: `${100 * host.requests / max}%`}}/>
            </div></td>
          </tr>)}
          {!hosts.length ? <tr><td colSpan={5} className="text-secondary">No hosts have recorded traffic for this period.</td></tr> : null}
        </tbody>
      </table>
    </div>
  </div>;
}

export default function AnalyticsCenter() {
  const [hours, setHours] = useState<NodeHours>(24);
  const [hostId, setHostId] = useState<number | null>(null);
  const [statusClass, setStatusClass] = useState<HttpStatusClass | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [chartType, setChartType] = useState<"requests" | "bytesOut" | "errors">("requests");
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const filters: NodeFilters = { hours, hostId, statusClass };
  const report = useQuery({
    queryKey: ["node-analytics-center", hours, hostId, statusClass],
    queryFn: () => getNodeAnalytics(filters),
    refetchInterval: 20000,
  });
  const recent = useQuery({
    queryKey: ["node-analytics-requests", hours, hostId, statusClass, offset],
    queryFn: () => getNodeAnalyticsRequests(filters, offset),
    enabled: tab === "requests" && hours <= 168,
    refetchInterval: tab === "requests" ? 20000 : false,
  });
  const data = report.data;
  const unfiltered = useQuery({
    queryKey: ["node-analytics-all-hosts"],
    queryFn: () => getNodeAnalytics({ hours: 24 }),
    refetchInterval: 120000,
  });
  const candidateHosts = useMemo(() => unfiltered.data?.hosts || data?.hosts || [], [unfiltered.data?.hosts, data?.hosts]);
  const changed = () => setOffset(0);
  const exportNow = async () => {
    setExportError("");
    setExporting(true);
    try { await exportNodeAnalytics(filters); }
    catch (err) { setExportError(err instanceof Error ? err.message : String(err)); }
    finally { setExporting(false); }
  };
  return <HasPermission section={ADMIN} pageLoading loadingNoLogo>
    <div className="npmi-center mt-4">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
        <div>
          <h1 className="h2 d-flex align-items-center gap-2 mb-1"><IconChartBar size={25}/> Analytics Center</h1>
          <p className="text-secondary mb-0">Traffic handled by this node: HTTP routes and TCP/UDP stream sessions, counted separately.</p>
        </div>
        <button type="button" className="btn btn-outline-secondary" onClick={() => void report.refetch()}>
          <IconRefresh size={16}/> Refresh
        </button>
      </div>
      {data ? <div className="npmi-center-node card mb-3">
        <div className="card-body d-flex flex-wrap align-items-center gap-3">
          <IconServer size={26}/>
          <div className="flex-grow-1">
            <strong>{data.node.name}</strong>
            <div className="text-secondary small">Local node only · {data.node.role} · {data.node.version || "unknown version"}
              {data.node.id ? ` · ${data.node.id}` : ""}
            </div>
          </div>
          <span className="badge bg-success-lt text-success">Node-local analytics</span>
        </div>
      </div> : null}
      <div className="card mb-3"><div className="card-body">
        <div className="d-flex flex-wrap gap-3 align-items-end">
          <div><label htmlFor="npmi-center-range" className="form-label">Reporting period</label>
            <select id="npmi-center-range" className="form-select" value={hours} onChange={(e) => {
              setHours(Number(e.target.value) as NodeHours); changed();
            }}>{periods.map((p)=><option value={p.hours} key={p.hours}>{p.label}</option>)}</select>
          </div>
          <div className="flex-grow-1 npmi-center-select">
            <label htmlFor="npmi-center-host" className="form-label">Proxy Host</label>
            <select id="npmi-center-host" className="form-select" value={hostId ?? ""} onChange={(e) => {
              setHostId(e.target.value ? Number(e.target.value) : null); changed();
            }}>
              <option value="">All HTTP routes on this node</option>
              {candidateHosts.map((host) => <option value={host.hostId} key={host.hostId}>
                {routeName(host)}
              </option>)}
            </select>
          </div>
          <div><label htmlFor="npmi-center-status" className="form-label">HTTP status</label>
            <select id="npmi-center-status" className="form-select" value={statusClass ?? ""} onChange={(e) => {
              setStatusClass(e.target.value ? e.target.value as HttpStatusClass : null); changed();
            }}>
              <option value="">All responses</option>
              {statusClasses.map((value)=><option key={value} value={value}>{value}</option>)}
            </select>
          </div>
        </div>
      </div></div>
      {report.error ? <div className="alert alert-danger">{report.error.message}</div> : null}
      {report.isPending ? <div className="py-5 text-secondary">Loading node analytics…</div> : null}
      {data ? <>
        <div className="row row-cards mb-3">
          <SummaryCard label="HTTP requests" value={formatNumber(data.requests)} sub="Recorded on this node"/>
          <SummaryCard label="Response bandwidth" value={formatBytes(data.bytesOut)} sub={`Inbound request sizes: ${formatBytes(data.bytesIn)}`}/>
          <SummaryCard label="Server errors" value={`${(data.serverErrorRate * 100).toFixed(2)}%`} sub={`${formatNumber(data.status["5xx"] || 0)} HTTP 5xx`}/>
          <SummaryCard label="HTTP routes with traffic" value={formatNumber(data.activeHosts)} sub={`P95 response: ${formatMs(data.latencyMs.p95)}`}/>
        </div>
        <div className="card mb-3">
          <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
            <h3 className="card-title">Node traffic trend</h3>
            <div className="btn-group btn-group-sm">
              {(["requests", "bytesOut", "errors"] as const).map((kind) =>
                <button type="button" key={kind} className={`btn ${chartType === kind ? "btn-primary" : "btn-outline-secondary"}`}
                  onClick={() => setChartType(kind)}>{kind === "bytesOut" ? "Bandwidth" : kind === "errors" ? "5xx errors" : "Requests"}</button>)}
            </div>
          </div>
          <div className="card-body"><MetricChart timeline={data.timeline} kind={chartType}/></div>
        </div>
        <div className="d-flex flex-wrap gap-2 mb-3" role="tablist" aria-label="Analytics Center sections">
          {tabs.map((item)=><button type="button" key={item.id} role="tab" aria-selected={tab === item.id}
            className={`btn btn-sm ${tab === item.id ? "btn-primary" : "btn-outline-secondary"}`}
            onClick={() => { setTab(item.id); changed(); }}>{item.text}</button>)}
        </div>
        {tab === "overview" ? <>
          <div className="card mb-3"><div className="card-header"><h3 className="card-title">HTTP response distribution</h3></div>
            <div className="card-body">
              <div className="npmi-center-status" role="img" aria-label="HTTP response distribution">
                {statusClasses.map((status) => <div key={status} className={`npmi-center-status-${status}`}
                  style={{ width: `${data.requests ? 100 * (data.status[status] || 0) / data.requests : 0}%` }}/>)}
              </div>
              <div className="d-flex flex-wrap gap-4 small mt-3">
                {statusClasses.map((s) => <span key={s}><strong>{s}</strong> {formatNumber(data.status[s] || 0)}</span>)}
              </div>
            </div></div>
          <div className="row row-cards mb-3">
            <div className="col-lg-6"><Breakdown title="Top hostnames" items={data.domains}/></div>
            <div className="col-lg-6"><Breakdown title="HTTP methods" items={data.methods}/></div>
          </div>
          <HostTable hosts={data.hosts.slice(0, 15)}/>
        </> : null}
        {tab === "hosts" ? <HostTable hosts={data.hosts}/> : null}
        {tab === "streams" ? <>
          <div className="alert alert-info">{data.streamTraffic.limitations}</div>
          <div className="row row-cards mb-3">
            <SummaryCard label="Stream sessions" value={formatNumber(data.streamTraffic.sessions)} sub="TCP and UDP sessions, not HTTP requests"/>
            <SummaryCard label="Sent by node" value={formatBytes(data.streamTraffic.bytesSent)} sub="Stream network bytes sent"/>
            <SummaryCard label="Received by node" value={formatBytes(data.streamTraffic.bytesReceived)} sub="Stream network bytes received"/>
            <SummaryCard label="TCP / UDP" value={`${formatNumber(data.streamTraffic.tcp)} / ${formatNumber(data.streamTraffic.udp)}`} sub="Completed stream sessions"/>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="card-title">Layer 4 traffic by configured stream</h3></div>
            <div className="table-responsive"><table className="table card-table">
              <thead><tr><th>Stream</th><th>Protocol</th><th className="text-end">Sessions</th><th className="text-end">Sent</th><th className="text-end">Received</th></tr></thead>
              <tbody>
                {data.streamTraffic.streams.map((stream) => <tr key={`${stream.streamId}-${stream.protocol}`}>
                  <td>{stream.streamId === 0 ? "Unclassified / fallback stream" : <Link to="/nginx/stream">
                    {stream.incomingPort ? `Port ${stream.incomingPort}` : `Stream #${stream.streamId}`}
                  </Link>}</td>
                  <td>{stream.protocol}</td>
                  <td className="text-end">{formatNumber(stream.sessions)}</td>
                  <td className="text-end">{formatBytes(stream.bytesSent)}</td>
                  <td className="text-end">{formatBytes(stream.bytesReceived)}</td>
                </tr>)}
                {!data.streamTraffic.streams.length ? <tr><td colSpan={5} className="text-secondary">No stream sessions recorded in this period.</td></tr> : null}
              </tbody>
            </table></div>
          </div>
        </> : null}
        {tab === "traffic" ? <div className="row row-cards">
          <div className="col-lg-6"><Breakdown title="Top URLs / paths" items={data.paths} limit={25}/></div>
          <div className="col-lg-6"><Breakdown title="Hostnames" items={data.domains}/></div>
          <div className="col-lg-6"><Breakdown title="HTTP methods" items={data.methods}/></div>
          <div className="col-lg-6"><Breakdown title="HTTP protocols" items={data.protocols}/></div>
          <div className="col-lg-6"><Breakdown title="Device categories (estimated)" items={data.devices}/></div>
          <div className="col-lg-6"><Breakdown title="Upstream response codes" items={data.upstreams}/></div>
          <div className="col-lg-6"><Breakdown title="Exact HTTP status codes" items={data.statusCodes}/></div>
        </div> : null}
        {tab === "performance" ? <>
          <div className="row row-cards mb-3">
            <SummaryCard label="P50 response time" value={formatMs(data.latencyMs.p50)} sub="Median"/>
            <SummaryCard label="P95 response time" value={formatMs(data.latencyMs.p95)} sub="95th percentile"/>
            <SummaryCard label="P99 response time" value={formatMs(data.latencyMs.p99)} sub="99th percentile"/>
            <SummaryCard label="Timed requests" value={formatNumber(data.latencyMs.samples)} sub="Measured raw events"/>
          </div>
          <div className="card"><div className="card-header"><h3 className="card-title">Slowest URL paths (by average)</h3></div>
            <div className="table-responsive"><table className="table card-table">
              <thead><tr><th>Proxy Host</th><th>Path</th><th className="text-end">Samples</th><th className="text-end">Average</th><th className="text-end">Maximum</th></tr></thead>
              <tbody>
                {data.slowPaths.map((row, index) => <tr key={`${row.hostId}-${row.path}-${index}`}>
                  <td><RouteRef hostId={row.hostId}/></td>
                  <td className="text-break">{row.path}</td><td className="text-end">{formatNumber(row.requests)}</td>
                  <td className="text-end">{formatMs(row.averageMs)}</td><td className="text-end">{formatMs(row.maxMs)}</td>
                </tr>)}
                {!data.slowPaths.length ? <tr><td colSpan={5} className="text-secondary">No retained timing records.</td></tr> : null}
              </tbody></table></div></div>
        </> : null}
        {tab === "security" ? <>
          <div className="alert alert-info d-flex gap-2"><IconShieldCheck size={20}/>
            HTTP errors are indicators, not proof of an attack. Source IPs and unique visitors are not collected by this analytics database.
          </div>
          <div className="row row-cards mb-3">
            <div className="col-lg-6"><Breakdown title="HTTP error status codes" items={data.statusCodes.filter((r)=>Number(r.label) >= 400)}/></div>
            <div className="col-lg-6"><Breakdown title="Upstream statuses" items={data.upstreams}/></div>
          </div>
          <div className="card"><div className="card-header"><h3 className="card-title">Most common error paths</h3></div>
            <div className="table-responsive"><table className="table card-table">
              <thead><tr><th>Proxy Host</th><th>Path</th><th className="text-end">4xx + 5xx</th><th className="text-end">5xx</th></tr></thead>
              <tbody>
                {data.errorPaths.map((row, index)=><tr key={`${row.hostId}-${row.path}-${index}`}>
                  <td><Link to={`/nginx/proxy/${row.hostId}/analytics`}>#{row.hostId}</Link></td>
                  <td className="text-break">{row.path}</td><td className="text-end">{formatNumber(row.requests)}</td>
                  <td className="text-end">{formatNumber(row.serverErrors)}</td>
                </tr>)}
                {!data.errorPaths.length ? <tr><td colSpan={4} className="text-secondary">No error path records retained.</td></tr> : null}
              </tbody></table></div></div>
        </> : null}
        {tab === "requests" ? <div className="card">
          <div className="card-header d-flex align-items-center flex-wrap justify-content-between gap-2">
            <h3 className="card-title">Recent requests across this node</h3>
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled={hours > 168 || exporting}
              onClick={() => void exportNow()}><IconDownload size={16}/> Export CSV (up to 10,000)</button>
          </div>
          {exportError ? <div className="alert alert-danger m-3">{exportError}</div> : null}
          {hours > 168 ? <div className="p-3 text-secondary">Individual requests are available only within raw-event retention ({data.retainedRawDays} days). Choose a shorter range.</div>
            : <>
              {recent.error ? <div className="alert alert-danger m-3">{recent.error.message}</div> : null}
              {recent.isPending ? <div className="p-3 text-secondary">Loading requests…</div> : null}
              <div className="table-responsive"><table className="table card-table">
                <thead><tr><th>Time</th><th>Host</th><th>Request</th><th>Status</th><th className="text-end">Latency</th><th className="text-end">Sent</th></tr></thead>
                <tbody>
                  {recent.data?.entries.map((item)=><tr key={item.id}>
                    <td className="text-nowrap">{new Date(item.at).toLocaleString()}</td>
                    <td><Link to={`/nginx/proxy/${item.hostId}/analytics`}>#{item.hostId}</Link></td>
                    <td className="text-break">{item.method} {item.domain}{item.path}</td><td>{item.status}</td>
                    <td className="text-end">{formatMs(item.durationMs)}</td>
                    <td className="text-end">{formatBytes(item.bytesOut)}</td>
                  </tr>)}
                  {recent.data && !recent.data.entries.length ? <tr><td colSpan={6} className="text-secondary">No matching requests.</td></tr> : null}
                </tbody></table></div>
              <div className="card-footer d-flex align-items-center justify-content-between gap-2">
                <span className="text-secondary small">{formatNumber(recent.data?.total || 0)} matching requests</span>
                <div className="btn-group btn-group-sm">
                  <button type="button" className="btn btn-outline-secondary" disabled={offset===0}
                    onClick={()=>setOffset(Math.max(0,offset-50))}>Previous</button>
                  <button type="button" className="btn btn-outline-secondary"
                    disabled={!recent.data || offset + recent.data.entries.length >= recent.data.total || offset >= 10000}
                    onClick={()=>setOffset(offset+50)}>Next</button>
                </div>
              </div>
            </>}
        </div> : null}
        {data.accuracy === "hourly-rollup" ? <div className="alert alert-info mt-3">
          This range uses hourly historical aggregates. Detailed paths, performance percentiles and request records may be unavailable after raw data expires.
        </div> : null}
        <div className="card mt-3"><div className="card-body">
          <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
            <IconActivity size={18}/> <strong>Data coverage & collection</strong>
          </div>
          <div className="text-secondary small">Last collected: {formatDate(data.lastIngestedAt)} · Latest request: {formatDate(data.lastSeen)}</div>
          <div className="text-secondary small mt-2">{data.limitations.node}</div>
          <div className="text-secondary small">{data.limitations.coverage}</div>
          <div className="text-secondary small">{data.limitations.visitors}</div>
          <div className="text-secondary small">Raw events: {data.retainedRawDays} days · Aggregate history: {data.retainedRollupDays} days.</div>
          <div className="text-secondary small mt-2 d-flex align-items-center gap-1"><IconTransfer size={16}/> NPMX copies configuration, not this node's traffic measurements.</div>
        </div></div>
      </> : null}
    </div>
  </HasPermission>;
}

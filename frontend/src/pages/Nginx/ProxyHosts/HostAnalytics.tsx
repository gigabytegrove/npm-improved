import { IconArrowLeft, IconChartBar, IconRefresh } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getHostAnalytics,
  getHostAnalyticsRequests,
  getProxyHost,
  type AnalyticsBreakdown,
} from "src/api/backend";
import { HasPermission } from "src/components";
import { download } from "src/api/backend/base";
import { PROXY_HOSTS, VIEW } from "src/modules/Permissions";
import "./analytics.css";

type Tab = "overview" | "traffic" | "performance" | "visitors" | "security" | "requests";
const tabs: Array<{ value: Tab; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "traffic", label: "Traffic" },
  { value: "performance", label: "Performance" },
  { value: "visitors", label: "Visitors" },
  { value: "security", label: "Security" },
  { value: "requests", label: "Requests" },
];
const ranges = [
  { hours: 1, label: "1 hour" },
  { hours: 24, label: "24 hours" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
  { hours: 2160, label: "90 days" },
];

function humanBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value === 0) return "0 B";
  const unit = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** unit).toFixed(unit ? 1 : 0)} ${["B", "KiB", "MiB", "GiB", "TiB"][unit]}`;
}
function humanLatency(value: number | null): string {
  return value === null ? "Not measured" : `${value.toFixed(value < 10 ? 1 : 0)} ms`;
}
function Breakdown({ title, data }: {
  title: string;
  data: AnalyticsBreakdown[];
}) {
  return (
    <section className="card npmi-analytics-panel">
      <div className="card-header"><h3 className="card-title">{title}</h3></div>
      <div className="table-responsive">
        <table className="table table-vcenter card-table">
          <thead><tr><th>Value</th><th className="text-end">Requests</th><th className="text-end">Bandwidth</th></tr></thead>
          <tbody>
            {data.length ? data.map((item) => (
              <tr key={item.label}>
                <td className="text-break">{item.label || "Unknown"}</td>
                <td className="text-end">{item.requests.toLocaleString()}</td>
                <td className="text-end">{humanBytes(item.bytesOut)}</td>
              </tr>
            )) : <tr><td colSpan={3} className="text-secondary">No breakdown data in the selected period.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function TrafficChart({ points }: { points: Array<{ at: string; requests: number }> }) {
  const width = 720;
  const height = 180;
  const pad = 12;
  const max = Math.max(1, ...points.map((item) => item.requests));
  const coords = points.map((item, i) => ({
    x: pad + (points.length > 1 ? (i / (points.length - 1)) * (width - 2 * pad) : 0),
    y: height - pad - (item.requests / max) * (height - 2 * pad),
  }));
  const line = coords.map((p, index) => `${index ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <div className="npmi-analytics-chart" role="img" aria-label="Request volume over the selected period">
      {points.length ? (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
            <title>Request volume trend</title>
            <line x1="12" y1="168" x2="708" y2="168" stroke="currentColor" opacity="0.15"/>
            <path d={line} fill="none" stroke="#2789ca" strokeWidth="3" vectorEffect="non-scaling-stroke"/>
            {coords.map((p, index) => (
              <circle key={points[index].at} cx={p.x} cy={p.y} r="3" fill="#2789ca">
                <title>{new Date(points[index].at).toLocaleString()}: {points[index].requests.toLocaleString()} requests</title>
              </circle>
            ))}
          </svg>
          <div className="d-flex justify-content-between text-secondary small">
            <span>{new Date(points[0].at).toLocaleString()}</span>
            <span>Peak: {max.toLocaleString()} requests per bucket</span>
            <span>{new Date(points[points.length - 1].at).toLocaleString()}</span>
          </div>
        </>
      ) : <div className="py-5 text-center text-secondary">Analytics collection has no request records for this period.</div>}
    </div>
  );
}
function KPI({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="col-sm-6 col-xl-3">
    <div className="card npmi-analytics-kpi"><div className="card-body">
      <div className="text-secondary small">{label}</div>
      <div className="h2 mt-2 mb-1">{value}</div>
      {hint ? <div className="text-secondary small">{hint}</div> : null}
    </div></div>
  </div>;
}

export default function HostAnalytics() {
  const params = useParams();
  const id = Number(params.id);
  const valid = Number.isSafeInteger(id) && id > 0;
  const [hours, setHours] = useState(24);
  const [tab, setTab] = useState<Tab>("overview");
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<number | null>(null);
  const { data: host, error: hostError } = useQuery({
    queryKey: ["proxy-host", id, "analytics"],
    queryFn: () => getProxyHost(id),
    enabled: valid,
  });
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["proxy-host-analytics", id, hours],
    queryFn: () => getHostAnalytics(id, hours),
    enabled: valid,
    refetchInterval: 30000,
  });
  const requestHours = Math.min(hours, 168);
  const { data: requests, error: requestError, isPending: requestsPending } = useQuery({
    queryKey: ["proxy-host-analytics-requests", id, requestHours, offset, status],
    queryFn: () => getHostAnalyticsRequests(id, requestHours, offset, status),
    enabled: valid && tab === "requests",
    refetchInterval: tab === "requests" ? 30000 : false,
  });
  const responseTotal = data?.requests || 0;
  const errorTotal = (data?.status["5xx"] || 0);
  const errorRate = responseTotal ? ((errorTotal / responseTotal) * 100).toFixed(2) : "0.00";
  const security = useMemo(() => data ? [
    { label: "4xx client responses", requests: data.status["4xx"] || 0, bytesOut: 0 },
    { label: "5xx upstream/server responses", requests: data.status["5xx"] || 0, bytesOut: 0 },
  ] : [], [data]);

  return (
    <HasPermission section={PROXY_HOSTS} permission={VIEW} pageLoading loadingNoLogo>
      <div className="npmi-host-analytics mt-4">
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-3 mb-3">
          <div>
            <Link to="/nginx/proxy" className="text-secondary d-inline-flex align-items-center gap-1 mb-2">
              <IconArrowLeft size={16} /> Proxy Hosts
            </Link>
            <h1 className="h2 mb-1 d-flex align-items-center gap-2"><IconChartBar size={25}/> Host Analytics</h1>
            <div className="text-secondary text-break">{host?.domainNames.join(", ") || `Proxy Host #${id}`}</div>
          </div>
          <div className="d-flex flex-wrap gap-2 align-items-center">
            <label htmlFor="npmi-analytics-range" className="form-label mb-0">Period</label>
            <select id="npmi-analytics-range" className="form-select w-auto"
              value={hours} onChange={(event) => { setHours(Number(event.target.value)); setOffset(0); }}>
              {ranges.map((range) => <option key={range.hours} value={range.hours}>{range.label}</option>)}
            </select>
            <button type="button" className="btn btn-outline-secondary" onClick={() => void refetch()}>
              <IconRefresh size={16} /> Refresh
            </button>
          </div>
        </div>
        {!valid ? <div className="alert alert-danger">Invalid proxy host identifier.</div> : null}
        {hostError ? <div className="alert alert-danger">{(hostError as Error).message}</div> : null}
        {error ? <div className="alert alert-danger">{(error as Error).message}</div> : null}
        {isPending && valid ? <div className="text-secondary py-5">Loading analytics…</div> : null}
        {data ? (
          <>
            <div className="alert alert-info py-2 small" role="status">
              Node-local traffic analytics · {data.accuracy === "hourly-rollup" ? "Hourly historical rollups" : "Raw event measurements"}.
              Data starts when structured logging is enabled; earlier request history cannot be reconstructed.
            </div>
            <div className="row row-cards mb-3">
              <KPI label="Requests" value={data.requests.toLocaleString()} hint="Requests observed on this node"/>
              <KPI label="Bandwidth served" value={humanBytes(data.bytesOut)} hint="HTTP response bytes sent"/>
              <KPI label="Server error rate" value={`${errorRate}%`} hint={`${errorTotal.toLocaleString()} HTTP 5xx responses`}/>
              <KPI label="P95 response time" value={humanLatency(data.latencyMs.p95)} hint={`${data.latencyMs.samples.toLocaleString()} timed requests`}/>
            </div>
            <div className="card mb-3">
              <div className="card-header"><h3 className="card-title">Request volume</h3></div>
              <div className="card-body"><TrafficChart points={data.timeline}/></div>
            </div>
            <div className="d-flex flex-wrap gap-2 mb-3" role="tablist" aria-label="Host analytics sections">
              {tabs.map((item) => (
                <button key={item.value} type="button" role="tab" aria-selected={tab === item.value}
                  className={`btn btn-sm ${tab === item.value ? "btn-primary" : "btn-outline-secondary"}`}
                  onClick={() => setTab(item.value)}>{item.label}</button>
              ))}
            </div>
            {tab === "overview" ? (
              <>
                <div className="card mb-3"><div className="card-header"><h3 className="card-title">HTTP response classes</h3></div>
                  <div className="card-body">
                    <div className="npmi-analytics-status-bar" role="img" aria-label="HTTP response classes">
                      {(["2xx","3xx","4xx","5xx"] as const).map((key) => (
                        <div key={key} className={`npmi-analytics-band npmi-analytics-${key}`}
                          style={{ width: `${data.requests ? (100 * (data.status[key] || 0) / data.requests) : 0}%` }}/>
                      ))}
                    </div>
                    <div className="d-flex flex-wrap gap-4 mt-3">
                      {(["2xx","3xx","4xx","5xx"] as const).map((key) =>
                        <span key={key} className="small"><strong>{key}</strong> {(data.status[key] || 0).toLocaleString()}</span>)}
                    </div>
                  </div>
                </div>
                <div className="row row-cards">
                  <div className="col-lg-6"><Breakdown title="Hostnames" data={data.domains}/></div>
                  <div className="col-lg-6"><Breakdown title="HTTP methods" data={data.methods}/></div>
                </div>
              </>
            ) : null}
            {tab === "traffic" ? <div className="row row-cards">
              <div className="col-lg-6"><Breakdown title="Top requested paths" data={data.paths}/></div>
              <div className="col-lg-6"><Breakdown title="Hostnames" data={data.domains}/></div>
            </div> : null}
            {tab === "performance" ? (
              <>
                <div className="row row-cards mb-3">
                  <KPI label="Median (p50)" value={humanLatency(data.latencyMs.p50)}/>
                  <KPI label="P95" value={humanLatency(data.latencyMs.p95)}/>
                  <KPI label="P99" value={humanLatency(data.latencyMs.p99)}/>
                  <KPI label="Timed samples" value={data.latencyMs.samples.toLocaleString()}/>
                </div>
                <Breakdown title="Upstream response status" data={data.upstreams}/>
                {data.limitations.percentiles ? <div className="alert alert-info mt-3">{data.limitations.percentiles}</div> : null}
              </>
            ) : null}
            {tab === "visitors" ? <>
              <div className="alert alert-info">{data.limitations.uniqueVisitors} {data.limitations.countries}</div>
              <Breakdown title="Device classes (inferred from user agent)" data={data.devices}/>
            </> : null}
            {tab === "security" ? <>
              <div className="alert alert-info">HTTP status codes are not proof of malicious activity. Client identity is not stored by this collector.</div>
              <Breakdown title="Error response trends" data={security}/>
              <p className="text-secondary small mt-3">Use the Requests tab to inspect individual 403, 404 or 429 responses.</p>
            </> : null}
            {tab === "requests" ? (
              <section className="card">
                <div className="card-header d-flex gap-3 align-items-center">
                  <h3 className="card-title">Recent requests</h3>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => void download({ url: `/nginx/proxy-hosts/${id}/analytics/export`, params: { hours: requestHours } }, `npm-host-${id}-analytics.csv`)}>Export CSV</button>
                  <select className="form-select form-select-sm w-auto ms-auto"
                    aria-label="Filter HTTP response status"
                    value={status ?? ""} onChange={(event) => { setOffset(0); setStatus(event.target.value ? Number(event.target.value) : null); }}>
                    <option value="">All statuses</option>
                    {[200,301,302,400,401,403,404,429,500,502,503,504].map((item) =>
                      <option key={item} value={item}>{item}</option>)}
                  </select>
                </div>
                {hours > 168 ? <div className="alert alert-info m-3">Individual request records are only retained for {data.retainedRawDays} days.</div> : null}
                {requestError ? <div className="alert alert-danger m-3">{(requestError as Error).message}</div> : null}
                {requestsPending ? <div className="p-3 text-secondary">Loading requests…</div> : null}
                <div className="table-responsive">
                  <table className="table table-vcenter card-table">
                    <thead><tr><th>Timestamp</th><th>Request</th><th>Code</th><th className="text-end">Duration</th><th className="text-end">Bytes</th></tr></thead>
                    <tbody>
                      {requests?.entries.map((entry) => (
                        <tr key={entry.id}>
                          <td className="text-nowrap">{new Date(entry.at).toLocaleString()}</td>
                          <td className="text-break"><span className="text-secondary">{entry.method}</span> {entry.domain}{entry.path}</td>
                          <td>{entry.status}</td>
                          <td className="text-end">{humanLatency(entry.durationMs)}</td>
                          <td className="text-end">{humanBytes(entry.bytesOut)}</td>
                        </tr>
                      ))}
                      {requests && !requests.entries.length ? <tr><td colSpan={5} className="text-secondary">No matching requests.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
                <div className="card-footer d-flex align-items-center justify-content-between">
                  <span className="text-secondary small">{requests?.total.toLocaleString() || "0"} matching events</span>
                  <div className="btn-group">
                    <button type="button" className="btn btn-sm" disabled={!offset}
                      onClick={() => setOffset((value) => Math.max(0, value - 50))}>Previous</button>
                    <button type="button" className="btn btn-sm"
                      disabled={!requests || offset + requests.entries.length >= requests.total || offset >= 10000}
                      onClick={() => setOffset((value) => value + 50)}>Next</button>
                  </div>
                </div>
              </section>
            ) : null}
            <div className="text-secondary small mt-4">Raw events retained for {data.retainedRawDays} days; hourly aggregates retained for {data.retainedRollupDays} days. Metrics represent this node only.</div>
          </>
        ) : null}
      </div>
    </HasPermission>
  );
}

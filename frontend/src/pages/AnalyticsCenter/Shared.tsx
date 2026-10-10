import { Link } from "react-router-dom";
import type { HttpStatusClass, NodeHost, NodeReport, NodeBreakdown, NodeFilters, NodeHours } from "src/api/backend";
import { useOutletContext } from "react-router-dom";

export interface AnalyticsPageContext {
  data: NodeReport;
  filters: NodeFilters;
  hours: NodeHours;
}
export const useAnalyticsPage = () => useOutletContext<AnalyticsPageContext>();

export const statusClasses: HttpStatusClass[] = ["2xx", "3xx", "4xx", "5xx"];
export const formatNumber = (value: number) => Number(value || 0).toLocaleString();
export const formatBytes = (value: number) => {
  if (!value) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const position = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** position).toFixed(position ? 1 : 0)} ${units[position]}`;
};
export const formatMs = (value: number | null) => value === null ? "Unavailable" : `${value.toFixed(1)} ms`;
export const formatDate = (value: string | null) => value ? new Date(value).toLocaleString() : "No measurements yet";

export function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="col-sm-6 col-xl-3">
    <div className="card h-100 npmi-center-metric"><div className="card-body">
      <div className="text-secondary small">{label}</div>
      <div className="h2 mt-2 mb-1">{value}</div>
      <div className="text-secondary small">{sub}</div>
    </div></div>
  </div>;
}

export function MetricChart({ timeline, kind }: {
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

export function Breakdown({ title, items, empty = "No retained raw records.", limit = 15 }: {
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

export const routeName = (host: NodeHost) => host.kind === "default" ? "Default site"
  : host.kind === "fallback" ? "Fallback HTTP"
    : host.domains.join(", ") || `${host.kind === "proxy" ? "Proxy Host" : host.kind === "redirection" ? "Redirect" : "404 Host"} #${host.routeId}`;

export function RouteRef({ hostId }: {hostId: number}) {
  return hostId > 0 ? <Link to={`/nginx/proxy/${hostId}/analytics`}>#{hostId}</Link>
    : <span className="text-secondary">{hostId <= -3000000 ? "Default / fallback" : hostId < -2000000 ? "404 Host" : "Redirect"}</span>;
}

export function HostTable({ hosts }: { hosts: NodeHost[] }) {
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

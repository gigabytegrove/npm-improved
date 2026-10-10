import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getNodeDimension } from "src/api/backend";
import { formatBytes, formatNumber, useAnalyticsPage } from "./Shared";

export default function ClientsPage() {
  const { data, filters, hours } = useAnalyticsPage();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [offset, setOffset] = useState(0);
  const paged = useQuery({
    queryKey: ["analytics-ip-directory", filters, deferredSearch, offset],
    queryFn: () => getNodeDimension("ips", filters, deferredSearch, offset),
    refetchInterval: 30000,
  });
  return <section className="npmi-center-page" aria-label="All observed IP addresses">
    <div className="row row-cards mb-3">
      <div className="col-md-6"><div className="card card-body">
        <div className="text-secondary">Distinct source addresses</div>
        <div className="h2 mb-0 mt-1">{data.uniqueIps === null ? "Outside raw retention" : formatNumber(data.uniqueIps)}</div>
        <div className="small text-secondary">Network endpoints, not unique people</div>
      </div></div>
      <div className="col-md-6"><div className="card card-body">
        <div className="text-secondary">Requests denied by this node</div>
        <div className="h2 mb-0 mt-1">{data.blockedRequests === null ? "Outside raw retention" : formatNumber(data.blockedRequests)}</div>
        <div className="small text-secondary">From recorded HTTP blocking decisions</div>
      </div></div>
    </div>
    <div className="card">
      <div className="card-header d-flex flex-wrap justify-content-between gap-3 align-items-center">
        <h3 className="card-title">IP address directory</h3>
        <div className="w-100" style={{maxWidth:"340px"}}>
          <label htmlFor="analytics-ip-search" className="visually-hidden">Search IP addresses</label>
          <input id="analytics-ip-search" className="form-control" value={search}
            maxLength={256} placeholder="Search IPv4 or IPv6 addresses"
            onChange={(event) => { setSearch(event.target.value); setOffset(0); }}/>
        </div>
      </div>
      {paged.error ? <div className="alert alert-danger m-3">{paged.error.message}</div> : null}
      {paged.data?.rawUnavailable || hours > data.retainedRawDays * 24 ?
        <div className="alert alert-info m-3">IP-level history is available only while raw events are retained ({data.retainedRawDays} days). Select a shorter period.</div> :
      <div className="table-responsive"><table className="table card-table table-vcenter">
        <thead><tr><th>Source IP</th><th className="text-end">Requests</th><th className="text-end">4xx/5xx</th><th className="text-end">Denied</th><th>First / last seen</th><th>Actions</th></tr></thead>
        <tbody>
          {paged.data?.entries.map((row) => <tr key={row.value}>
            <td className="text-break fw-semibold"><Link to={`/analytics/ips/detail?value=${encodeURIComponent(row.value)}`}>{row.value}</Link><div className="small text-secondary">{row.routes} HTTP route(s) · {formatBytes(row.bytesOut)} sent</div></td>
            <td className="text-end">{formatNumber(row.requests)}</td>
            <td className="text-end">{formatNumber(row.errors)} / {formatNumber(row.serverErrors)}</td>
            <td className="text-end">{formatNumber(row.blocked)}</td>
            <td className="text-nowrap">{new Date(row.firstSeen).toLocaleString()}<div className="small text-secondary">{new Date(row.lastSeen).toLocaleString()}</div></td>
            <td><div className="d-flex gap-2 flex-wrap">
              <Link to={`/analytics/ips/detail?value=${encodeURIComponent(row.value)}`}>Profile</Link>
              <Link to={`/analytics/requests?ip=${encodeURIComponent(row.value)}`}>Requests</Link>
              <Link to={`/analytics/connections?ip=${encodeURIComponent(row.value)}`}>Connections</Link>
              <Link to={`/analytics/blocking?type=ip&target=${encodeURIComponent(row.value)}`}>Block</Link>
            </div></td>
          </tr>)}
          {paged.isPending ? <tr><td colSpan={6}>Loading IP directory…</td></tr> : null}
          {paged.data && !paged.data.entries.length ? <tr><td colSpan={6}>No matching addresses for this period.</td></tr> : null}
        </tbody></table></div>}
      <div className="card-footer d-flex justify-content-between align-items-center flex-wrap gap-2">
        <span className="small text-secondary">{formatNumber(paged.data?.total || 0)} matching IP addresses · 50 per page</span>
        <div className="btn-group btn-group-sm">
          <button type="button" className="btn btn-outline-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button>
          <button type="button" className="btn btn-outline-secondary"
            disabled={!paged.data || offset + paged.data.entries.length >= paged.data.total}
            onClick={() => setOffset(offset + 50)}>Next</button>
        </div>
      </div>
    </div>
    <p className="text-secondary small mt-2">Addresses are reported only for this node. Blocking is never inferred from volume alone.</p>
  </section>;
}

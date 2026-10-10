import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getNodeDimension } from "src/api/backend";
import { formatBytes, formatNumber, useAnalyticsPage } from "./Shared";

export default function UserAgentsPage() {
  const { data, filters, hours } = useAnalyticsPage();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [offset, setOffset] = useState(0);
  const paged = useQuery({
    queryKey: ["analytics-user-agent-directory", filters, deferredSearch, offset],
    queryFn: () => getNodeDimension("user-agents", filters, deferredSearch, offset),
    refetchInterval: 30000,
  });
  return <section className="npmi-center-page" aria-label="All observed user agents and bots">
    <div className="card mb-3">
      <div className="card-header"><h3 className="card-title">Bot & automation classification</h3></div>
      <div className="card-body">
        <p className="small text-secondary">A user agent is self-reported, not verified proof of a crawler's identity. A known name is not automatically malicious.</p>
        <div className="d-flex gap-2 flex-wrap">
          {data.bots.map((row) => <Link key={row.label} to={`/analytics/requests?bot=${encodeURIComponent(row.label)}`}
            className="btn btn-sm btn-outline-secondary">{row.label}: {formatNumber(row.requests)}</Link>)}
          {!data.bots.length ? <span className="text-secondary small">No bot classifications in the raw window.</span> : null}
        </div>
      </div>
    </div>
    <div className="card">
      <div className="card-header d-flex flex-wrap gap-3 justify-content-between align-items-center">
        <h3 className="card-title">Full user-agent directory</h3>
        <div className="w-100" style={{maxWidth:"390px"}}>
          <label htmlFor="analytics-agent-search" className="visually-hidden">Search user agents</label>
          <input id="analytics-agent-search" className="form-control" value={search} maxLength={256}
            placeholder="Search browser, crawler, client or signature"
            onChange={(event) => { setSearch(event.target.value); setOffset(0); }}/>
        </div>
      </div>
      {paged.error ? <div className="alert alert-danger m-3">{paged.error.message}</div> : null}
      {paged.data?.rawUnavailable || hours > data.retainedRawDays * 24 ?
        <div className="alert alert-info m-3">Full user agents require raw request retention ({data.retainedRawDays} days). Select a shorter period.</div> :
        <div className="table-responsive"><table className="table card-table table-vcenter">
          <thead><tr><th>Reported user agent</th><th className="text-end">Requests</th><th className="text-end">Errors</th><th>First / last seen</th><th>Actions</th></tr></thead>
          <tbody>
            {paged.data?.entries.map((row) => <tr key={row.value}>
              <td className="text-break" style={{maxWidth:"440px"}}>{row.value}<div className="small text-secondary">{formatBytes(row.bytesOut)} sent · {row.routes} routes · {formatNumber(row.blocked)} denied</div></td>
              <td className="text-end">{formatNumber(row.requests)}</td>
              <td className="text-end">{formatNumber(row.errors)}</td>
              <td className="text-nowrap">{new Date(row.firstSeen).toLocaleString()}<div className="small text-secondary">{new Date(row.lastSeen).toLocaleString()}</div></td>
              <td><div className="d-flex flex-wrap gap-2">
                <Link to={`/analytics/requests?userAgent=${encodeURIComponent(row.value)}`}>History</Link>
                <Link to={`/analytics/blocking?type=user_agent&target=${encodeURIComponent(row.value.slice(0, 160))}`}>Prepare block</Link>
              </div></td>
            </tr>)}
            {paged.isPending ? <tr><td colSpan={5}>Loading user agents…</td></tr> : null}
            {paged.data && !paged.data.entries.length ? <tr><td colSpan={5}>No matching user-agent strings.</td></tr> : null}
          </tbody>
        </table></div>}
      <div className="card-footer d-flex justify-content-between align-items-center flex-wrap gap-2">
        <span className="text-secondary small">{formatNumber(paged.data?.total || 0)} matching user agents · 50 per page</span>
        <div className="btn-group btn-group-sm">
          <button type="button" className="btn btn-outline-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button>
          <button type="button" className="btn btn-outline-secondary" disabled={!paged.data || offset + paged.data.entries.length >= paged.data.total}
            onClick={() => setOffset(offset + 50)}>Next</button>
        </div>
      </div>
    </div>
  </section>;
}

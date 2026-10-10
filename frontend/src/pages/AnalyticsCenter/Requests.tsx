import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { IconDownload } from "@tabler/icons-react";
import { exportNodeAnalytics, getNodeAnalyticsRequests, type NodeFilters } from "src/api/backend";
import { formatNumber, formatBytes, formatMs, useAnalyticsPage } from "./Shared";

export default function RequestsPage() {
  const { data, filters, hours } = useAnalyticsPage();
  const [searchParams] = useSearchParams();
  const [offset, setOffset] = useState(0);
  const [sourceIp, setSourceIp] = useState(searchParams.get("ip") || "");
  const [agentFilter, setAgentFilter] = useState(searchParams.get("userAgent") || "");
  const [botFilter, setBotFilter] = useState(searchParams.get("bot") || "");
  const [connectionFilter, setConnectionFilter] = useState(searchParams.get("connectionId") || "");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const requestFilters: NodeFilters = {
    ...filters, ip: sourceIp || null, userAgent: agentFilter || null,
    bot: botFilter || null, connectionId: connectionFilter || null,
  };
  const recent = useQuery({
    queryKey: ["node-analytics-requests-page", requestFilters, offset],
    queryFn: () => getNodeAnalyticsRequests(requestFilters, offset),
    enabled: hours <= 720,
    refetchInterval: 30000,
  });
  const changed = () => setOffset(0);
  const exportNow = async () => {
    setExportError("");
    setExporting(true);
    try { await exportNodeAnalytics(requestFilters); }
    catch (error) { setExportError(error instanceof Error ? error.message : String(error)); }
    finally { setExporting(false); }
  };
  return <section className="npmi-center-page" aria-label="Request and connection history">
    <p className="text-secondary">A timestamped, filterable history of recorded HTTP requests. Select an address,
      user agent or connection ID to investigate related activity on this node. <Link to="/analytics/connections">Connection explorer</Link></p>
    <div className="card">
          <div className="card-body">
            <div className="row g-2 align-items-end">
              <div className="col-lg-3"><label htmlFor="analytics-filter-ip" className="form-label">Client IP</label>
                <input id="analytics-filter-ip" className="form-control" value={sourceIp}
                  onChange={(e) => { setSourceIp(e.target.value); changed(); }} placeholder="IPv4 / IPv6 address"/></div>
              <div className="col-lg-4"><label htmlFor="analytics-filter-ua" className="form-label">Exact user agent</label>
                <input id="analytics-filter-ua" className="form-control" value={agentFilter}
                  onChange={(e) => { setAgentFilter(e.target.value); changed(); }} placeholder="Choose an agent from User agents"/></div>
              <div className="col-lg-3"><label htmlFor="analytics-filter-bot" className="form-label">Bot category</label>
                <select id="analytics-filter-bot" className="form-select" value={botFilter}
                  onChange={(e) => { setBotFilter(e.target.value); changed(); }}>
                  <option value="">All classifications</option>
                  {data.bots.map((entry) => <option key={entry.label} value={entry.label}>{entry.label}</option>)}
                </select></div>
              <div className="col-lg-2"><label htmlFor="analytics-filter-connection" className="form-label">Connection ID</label>
                <input id="analytics-filter-connection" className="form-control" value={connectionFilter}
                  onChange={(e) => { setConnectionFilter(e.target.value); changed(); }}/></div>
            </div>
            <div className="d-flex gap-2 mt-2">
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => {
                setSourceIp(""); setAgentFilter(""); setBotFilter(""); setConnectionFilter(""); changed();
              }}>Clear filters</button>
              <span className="small text-secondary">Timestamps, source addresses, and user agents are stored for retained raw requests on this node.</span>
            </div>
          </div>
          <div className="card-header d-flex align-items-center flex-wrap justify-content-between gap-2">
            <h3 className="card-title">Recent requests across this node</h3>
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled={hours > 720 || exporting}
              onClick={() => void exportNow()}><IconDownload size={16}/> Export CSV (up to 10,000)</button>
          </div>
          {exportError ? <div className="alert alert-danger m-3">{exportError}</div> : null}
          {hours > 720 ? <div className="p-3 text-secondary">Individual requests are available only within raw-event retention ({data.retainedRawDays} days). Choose a shorter range.</div>
            : <>
              {recent.error ? <div className="alert alert-danger m-3">{recent.error.message}</div> : null}
              {recent.isPending ? <div className="p-3 text-secondary">Loading requests…</div> : null}
              <div className="table-responsive"><table className="table card-table">
                <thead><tr><th>Timestamp</th><th>Source IP</th><th>Host</th><th>Request / connection</th><th>User agent / bot</th><th>Status</th><th className="text-end">Latency</th><th className="text-end">Sent</th></tr></thead>
                <tbody>
                  {recent.data?.entries.map((item)=><tr key={item.id}>
                    <td className="text-nowrap">{new Date(item.at).toLocaleString()}</td>
                    <td className="text-break"><button type="button" className="btn btn-link p-0" onClick={() => {
                      setSourceIp(item.clientIp || ""); setAgentFilter(""); setBotFilter(""); setConnectionFilter(""); changed();
                    }}>{item.clientIp || "Not recorded"}</button>
                    {item.peerIp ? <div className="small text-secondary">Peer: {item.peerIp}</div> : null}</td>
                    <td>{item.hostId > 0 ? <Link to={"/nginx/proxy/" + item.hostId + "/analytics"}>#{item.hostId}</Link> : <span>{item.hostId}</span>}</td>
                    <td className="text-break">{item.method} {item.domain}{item.path}
                      {item.connectionId ? <div className="small">Connection: <button type="button" className="btn btn-link p-0" onClick={() => {
                        setConnectionFilter(item.connectionId || ""); setSourceIp(""); setAgentFilter(""); setBotFilter(""); changed();
                      }}>{item.connectionId}</button> · Request #{item.connectionRequests || "?"}</div> : null}
                      <div className="small text-secondary">Request ID: {item.requestId || "Not recorded"}</div>
                    </td>
                    <td className="text-break">{item.userAgent || "Not recorded"}
                      <div className="small text-secondary">{item.botClass || "Unknown"}
                        {item.blockReason ? " · Blocked by " + item.blockReason : ""}</div></td>
                    <td>{item.status}</td>
                    <td className="text-end">{formatMs(item.durationMs)}</td>
                    <td className="text-end">{formatBytes(item.bytesOut)}</td>
                  </tr>)}
                  {recent.data && !recent.data.entries.length ? <tr><td colSpan={8} className="text-secondary">No matching requests.</td></tr> : null}
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
</div>
  </section>;
}

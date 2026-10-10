import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { getNodeAnalyticsRequests, type NodeFilters } from "src/api/backend";
import { formatBytes, formatNumber, useAnalyticsPage } from "./Shared";

export default function ConnectionsPage() {
  const { data, filters, hours } = useAnalyticsPage();
  const [params] = useSearchParams();
  const [ip, setIp] = useState(params.get("ip") || "");
  const [connectionId, setConnectionId] = useState(params.get("connectionId") || "");
  const [offset, setOffset] = useState(0);
  const query: NodeFilters = { ...filters, ip: ip || null, connectionId: connectionId || null };
  const history = useQuery({
    queryKey: ["analytics-connection-history", query, offset],
    queryFn: () => getNodeAnalyticsRequests(query, offset),
    enabled: hours <= data.retainedRawDays * 24,
    refetchInterval: 30000,
  });
  const connections = new Map<string, { ip: string; id: string; first: string; last: string; requests: number; bytes: number; errors: number; agent: string; hosts: Set<number> }>();
  for (const row of history.data?.entries || []) {
    if (!row.connectionId) continue;
    // Nginx connection numbers can be reused across restarts. Group only the
    // current page; this is not a global TCP handshake/session reconstruction.
    const key = `${row.clientIp ?? "unknown"}:${row.connectionId}`;
    let connection = connections.get(key);
    if (!connection) {
      connection = {
        ip: row.clientIp || "Unknown", id: row.connectionId,
        first: row.at, last: row.at, requests: 0, bytes: 0, errors: 0,
        agent: row.userAgent || "Not recorded", hosts: new Set(),
      };
      connections.set(key, connection);
    }
    connection.requests++;
    connection.bytes += row.bytesOut || 0;
    connection.errors += row.status >= 400 ? 1 : 0;
    if (row.at < connection.first) connection.first = row.at;
    if (row.at > connection.last) connection.last = row.at;
    connection.hosts.add(row.hostId);
  }
  return <section aria-label="HTTP connection history" className="npmi-center-page">
    <div className="card mb-3">
      <div className="card-header"><h3 className="card-title">Connection History</h3></div>
      <div className="card-body">
        <p className="text-secondary">Investigate Nginx HTTP connections by source address, connection identifier, timing, associated requests and user agent. Events are local to this node.</p>
        <div className="row g-2 align-items-end">
          <div className="col-md-5"><label className="form-label" htmlFor="analytics-connection-ip">Client IP</label>
            <input className="form-control" id="analytics-connection-ip" placeholder="IPv4 or IPv6" value={ip}
              onChange={(e) => { setIp(e.target.value); setOffset(0); }}/></div>
          <div className="col-md-5"><label className="form-label" htmlFor="analytics-connection-id">Nginx connection ID</label>
            <input className="form-control" id="analytics-connection-id" placeholder="Connection identifier" value={connectionId}
              onChange={(e) => { setConnectionId(e.target.value); setOffset(0); }}/></div>
          <div className="col-md-2"><button className="btn btn-outline-secondary w-100" type="button" onClick={() => {
            setIp(""); setConnectionId(""); setOffset(0);
          }}>Clear</button></div>
        </div>
      </div>
    </div>
    {hours > data.retainedRawDays * 24 ? <div className="alert alert-info">
      Connection records require retained raw events ({data.retainedRawDays} days). Select a shorter period.
    </div> : <>
      {history.error ? <div className="alert alert-danger">{history.error.message}</div> : null}
      {history.isPending ? <div className="text-secondary">Loading connection records…</div> : null}
      <div className="card">
        <div className="card-header"><h3 className="card-title">Recorded HTTP connection groups</h3></div>
        <div className="table-responsive"><table className="table card-table">
          <thead><tr><th>Client / connection</th><th>First / last recorded request</th><th className="text-end">Requests</th><th className="text-end">Traffic sent</th><th className="text-end">Errors</th><th>Investigation</th></tr></thead>
          <tbody>{[...connections.values()].map((row) => <tr key={row.ip + row.id}>
            <td className="text-break"><strong>{row.ip}</strong><div className="small text-secondary">#{row.id} · {row.agent}</div></td>
            <td>{new Date(row.first).toLocaleString()}<div className="small text-secondary">{new Date(row.last).toLocaleString()}</div></td>
            <td className="text-end">{formatNumber(row.requests)}</td>
            <td className="text-end">{formatBytes(row.bytes)}</td>
            <td className="text-end">{formatNumber(row.errors)}</td>
            <td><Link to={`/analytics/requests?connectionId=${encodeURIComponent(row.id)}&ip=${encodeURIComponent(row.ip)}`}>Request history</Link></td>
          </tr>)}
            {history.data && !connections.size ? <tr><td colSpan={6} className="text-secondary">No matching HTTP connection identifiers in these records.</td></tr> : null}
          </tbody>
        </table></div>
        <div className="card-footer d-flex justify-content-between align-items-center">
          <span className="text-secondary small">Grouped from {history.data?.entries.length || 0} of {formatNumber(history.data?.total || 0)} matching request events</span>
          <div className="btn-group btn-group-sm">
            <button className="btn btn-outline-secondary" disabled={offset === 0} type="button" onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button>
            <button className="btn btn-outline-secondary" disabled={!history.data || offset + history.data.entries.length >= history.data.total || offset >= 10000} type="button" onClick={() => setOffset(offset + 50)}>Next</button>
          </div>
        </div>
      </div>
    </>}
    <p className="small text-secondary mt-3">Connection history is derived from completed HTTP request logs, not raw TCP SYN/FIN events. The first and last times above are observed requests within the current page of results, not guaranteed connection open/close times. <Link to="/analytics/streams">TCP/UDP stream sessions</Link> are tracked separately.</p>
  </section>;
}

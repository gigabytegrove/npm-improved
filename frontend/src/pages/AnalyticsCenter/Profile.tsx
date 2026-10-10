import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { getNodeProfile, getNodeAnalyticsRequests, type NodeFilters, type NodeProfileDimension } from "src/api/backend";
import { formatBytes, formatNumber, formatDate, useAnalyticsPage } from "./Shared";

function BreakdownTable({title, rows}: {title:string; rows:NodeProfileDimension[]}) {
  return <div className="card h-100">
    <div className="card-header"><h3 className="card-title">{title}</h3></div>
    <div className="table-responsive">
      <table className="table card-table table-vcenter">
        <thead><tr><th>Value</th><th className="text-end">Requests</th><th className="text-end">Bandwidth</th></tr></thead>
        <tbody>{rows.map(row=><tr key={row.label}>
          <td className="text-break">{row.label}</td><td className="text-end">{formatNumber(row.requests)}</td>
          <td className="text-end">{formatBytes(row.bytesOut)}</td>
        </tr>)}
        {!rows.length?<tr><td colSpan={3} className="text-secondary">No recorded traffic for this selection.</td></tr>:null}
        </tbody>
      </table>
    </div>
  </div>;
}
function DetailLink({value, kind}: {value:string; kind:"ips"|"user-agents"}) {
  return <Link to={`/analytics/${kind}/detail?value=${encodeURIComponent(value)}`}>{value}</Link>;
}
export default function AnalyticsProfilePage() {
  const {kind} = useParams<{kind:string}>();
  const [params] = useSearchParams();
  const value = params.get("value") || "";
  const {filters, hours, data} = useAnalyticsPage();
  const [offset,setOffset] = useState(0);
  const valid = kind === "ips" || kind === "user-agents";
  const dimension = valid ? kind : "ips";
  const extraFilters:NodeFilters = {...filters, ...(dimension==="ips"?{ip:value}:{userAgent:value})};
  const profile = useQuery({
    queryKey:["analytics-profile",kind,value,filters],
    queryFn:()=>getNodeProfile(dimension,value,filters),
    enabled:valid && !!value,
    refetchInterval:30000,
  });
  const requests = useQuery({
    queryKey:["analytics-profile-requests",kind,value,extraFilters,offset],
    queryFn:()=>getNodeAnalyticsRequests(extraFilters,offset),
    enabled:valid && !!value && hours <= data.retainedRawDays*24,
    refetchInterval:30000,
  });
  if(!valid || !value) return <div className="alert alert-warning">Select an IP address or user agent from its directory.</div>;
  const p=profile.data;
  return <section className="npmi-center-page" aria-label="Analytics entity details">
    <div className="d-flex gap-2 flex-wrap align-items-center justify-content-between mb-3">
      <div><Link to={dimension==="ips"?"/analytics/ips":"/analytics/user-agents"}>← Back to {dimension==="ips"?"IP addresses":"User agents"}</Link>
        <h3 className="h2 mt-2 text-break">{value}</h3>
        <p className="text-secondary mb-0">Full recorded activity on this node for this exact {dimension==="ips"?"IP address":"user-agent string"}.</p>
      </div>
      <div className="d-flex flex-wrap gap-2">
        <Link className="btn btn-outline-secondary" to={`/analytics/requests?${dimension==="ips"?"ip":"userAgent"}=${encodeURIComponent(value)}`}>Request explorer</Link>
        {dimension==="ips"?<Link className="btn btn-outline-secondary" to={`/analytics/connections?ip=${encodeURIComponent(value)}`}>Connections</Link>:null}
        <Link className="btn btn-outline-danger" to={`/analytics/blocking?type=${dimension==="ips"?"ip":"user_agent"}&target=${encodeURIComponent(value)}`}>Prepare block</Link>
      </div>
    </div>
    {profile.error?<div className="alert alert-danger">{profile.error.message}</div>:null}
    {profile.isPending?<div className="card card-body text-secondary">Loading detailed analytics…</div>:null}
    {p?.rawUnavailable?<div className="alert alert-info">Detailed IP and user-agent records expire after {data.retainedRawDays} days. Choose a shorter reporting period.</div>:null}
    {p && !p.rawUnavailable?<>
      <div className="row row-cards mb-3">
        {[
          ["Requests",formatNumber(p.requests)],
          ["Bandwidth sent",formatBytes(p.bytesOut)],
          ["Client errors",formatNumber(p.errors)],
          ["Blocked",formatNumber(p.blocked)],
          ["Observed connections",formatNumber(p.connections)],
          ["Routing destinations",formatNumber(p.routeCount)],
          ["First seen",formatDate(p.firstSeen)],
          ["Last seen",formatDate(p.lastSeen)],
        ].map(([label,val])=><div key={label} className="col-sm-6 col-xl-3"><div className="card card-body h-100">
          <span className="text-secondary small">{label}</span><strong className="h3 mt-1 mb-0 text-break">{val}</strong>
        </div></div>)}
      </div>
      <div className="card mb-3">
        <div className="card-header"><h3 className="card-title">Hourly activity timeline</h3></div>
        <div className="table-responsive"><table className="table card-table">
          <thead><tr><th>Hour</th><th className="text-end">Requests</th><th className="text-end">Errors</th><th className="text-end">Blocked</th><th className="text-end">Bandwidth</th></tr></thead>
          <tbody>{p.timeline.map(row=><tr key={row.at}>
            <td>{new Date(row.at).toLocaleString()}</td><td className="text-end">{formatNumber(row.requests)}</td>
            <td className="text-end">{formatNumber(row.errors)}</td><td className="text-end">{formatNumber(row.blocked)}</td>
            <td className="text-end">{formatBytes(row.bytesOut)}</td>
          </tr>)}
          {!p.timeline.length?<tr><td colSpan={5} className="text-secondary">No activity recorded.</td></tr>:null}
          </tbody>
        </table></div>
      </div>
      <div className="row row-cards mb-3">
        <div className="col-xl-6"><BreakdownTable title="Most requested paths" rows={p.paths}/></div>
        <div className="col-xl-6"><BreakdownTable title="HTTP response codes" rows={p.statuses}/></div>
        <div className="col-xl-6"><BreakdownTable title="Hostnames" rows={p.domains}/></div>
        <div className="col-xl-6"><BreakdownTable title="HTTP methods" rows={p.methods}/></div>
        <div className="col-xl-6"><BreakdownTable title="Bot classifications" rows={p.bots}/></div>
        <div className="col-xl-6"><BreakdownTable title="Connections" rows={p.connectionsList}/></div>
      </div>
      <div className="card mb-3"><div className="card-header"><h3 className="card-title">
        {dimension==="ips"?"User agents observed from this address":"Source IPs using this agent"}
      </h3></div><div className="table-responsive"><table className="table card-table">
        <thead><tr><th>{dimension==="ips"?"User agent":"IP address"}</th><th className="text-end">Requests</th><th>Investigate</th></tr></thead>
        <tbody>{(dimension==="ips"?p.relatedAgents:p.relatedIps).map(row=><tr key={row.label}>
          <td className="text-break">{row.label}</td><td className="text-end">{formatNumber(row.requests)}</td>
          <td><DetailLink kind={dimension==="ips"?"user-agents":"ips"} value={row.label}/></td>
        </tr>)}
        {!(dimension==="ips"?p.relatedAgents:p.relatedIps).length?<tr><td colSpan={3}>No related records.</td></tr>:null}
        </tbody></table></div></div>
      <div className="card">
        <div className="card-header"><h3 className="card-title">Timestamped request history</h3></div>
        {requests.error?<div className="alert alert-danger m-3">{requests.error.message}</div>:null}
        <div className="table-responsive"><table className="table card-table">
          <thead><tr><th>Time</th><th>Host</th><th>Request</th><th>Status</th><th>Connection</th></tr></thead>
          <tbody>{requests.data?.entries.map(row=><tr key={row.id}>
            <td className="text-nowrap">{new Date(row.at).toLocaleString()}</td>
            <td>{row.domain}</td><td className="text-break">{row.method} {row.path}</td>
            <td>{row.status}</td><td>{row.connectionId || "—"}</td>
          </tr>)}
          {requests.isPending?<tr><td colSpan={5}>Loading individual requests…</td></tr>:null}
          {requests.data&&!requests.data.entries.length?<tr><td colSpan={5}>No matching request records.</td></tr>:null}
          </tbody>
        </table></div>
        <div className="card-footer d-flex justify-content-between align-items-center">
          <span className="text-secondary">{formatNumber(requests.data?.total||0)} requests</span>
          <div className="btn-group btn-group-sm">
            <button type="button" className="btn btn-outline-secondary" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-50))}>Previous</button>
            <button type="button" className="btn btn-outline-secondary" disabled={!requests.data||offset+requests.data.entries.length>=requests.data.total} onClick={()=>setOffset(offset+50)}>Next</button>
          </div>
        </div>
      </div>
    </>:null}
  </section>;
}

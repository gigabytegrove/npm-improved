import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { getNodeAnalytics, getNodeAnalyticsRequests, getNodeDimension, type NodeFilters } from "src/api/backend";
import { Breakdown, MetricChart, SummaryCard, formatBytes, formatNumber, formatMs, routeName, useAnalyticsPage } from "./Shared";

export default function HostDetailPage() {
  const {filters, data, hours}=useAnalyticsPage();
  const [params]=useSearchParams();
  const source=Number(params.get("source"));
  const valid=Number.isSafeInteger(source)&&source!==0;
  const route=data.hosts.find(h=>h.hostId===source);
  const [offset,setOffset]=useState(0);
  const specific:NodeFilters={...filters,hostId:source};
  const detail=useQuery({
    queryKey:["analytics-route-detail",specific],
    queryFn:()=>getNodeAnalytics(specific),
    enabled:valid,
    refetchInterval:30000,
  });
  const requests=useQuery({
    queryKey:["analytics-route-requests",specific,offset],
    queryFn:()=>getNodeAnalyticsRequests(specific,offset),
    enabled:valid&&hours<=data.retainedRawDays*24,
    refetchInterval:30000,
  });
  const ips=useQuery({
    queryKey:["analytics-route-ips",specific],
    queryFn:()=>getNodeDimension("ips",specific,"",0),
    enabled:valid&&hours<=data.retainedRawDays*24,
    refetchInterval:30000,
  });
  if(!valid)return <div className="alert alert-warning">Choose a route from the HTTP Routes directory.</div>;
  const d=detail.data;
  return <section className="npmi-center-page" aria-label="Individual routing source investigation">
    <div className="d-flex justify-content-between gap-2 flex-wrap mb-3 align-items-start">
      <div><Link to="/analytics/hosts">← All HTTP Routes</Link>
        <h3 className="h2 mb-1 mt-2 text-break">{route?routeName(route):`HTTP source #${source}`}</h3>
        <p className="text-secondary mb-0">{route?.kind||"Historical source"} · node-local events · source #{source}</p>
      </div>
      {route?.kind==="proxy"&&route.configured?<Link className="btn btn-primary"
        to={`/nginx/proxy/${route.routeId}/analytics`}>Open detailed Host Analytics</Link>:null}
    </div>
    {detail.error?<div className="alert alert-danger">{detail.error.message}</div>:null}
    {!d?<div className="card card-body text-secondary">Loading routing source analytics…</div>:<>
      <div className="row row-cards mb-3">
        <SummaryCard label="Requests" value={formatNumber(d.requests)} sub="Handled on this node"/>
        <SummaryCard label="Outbound traffic" value={formatBytes(d.bytesOut)} sub="HTTP responses"/>
        <SummaryCard label="5xx error rate" value={`${(d.serverErrorRate*100).toFixed(2)}%`} sub={`${formatNumber(d.status["5xx"]||0)} errors`}/>
        <SummaryCard label="P95 response" value={formatMs(d.latencyMs.p95)} sub="Raw event timing"/>
      </div>
      <div className="card mb-3"><div className="card-header"><h3 className="card-title">Route traffic over time</h3></div>
        <div className="card-body"><MetricChart timeline={d.timeline} kind="requests"/></div></div>
      <div className="row row-cards mb-3">
        <div className="col-lg-6"><Breakdown title="Requested URL paths" items={d.paths} limit={25}/></div>
        <div className="col-lg-6"><Breakdown title="HTTP response codes" items={d.statusCodes}/></div>
        <div className="col-lg-6"><Breakdown title="User-agent devices" items={d.devices}/></div>
        <div className="col-lg-6"><Breakdown title="HTTP methods" items={d.methods}/></div>
      </div>
      <div className="card mb-3">
        <div className="card-header d-flex justify-content-between flex-wrap gap-2">
          <h3 className="card-title">Client IP addresses reaching this route</h3>
          <Link to="/analytics/ips">Full IP directory</Link>
        </div>
        {ips.data?.rawUnavailable?<div className="p-3 text-secondary">Client-level data is outside raw retention.</div>:null}
        {ips.error?<div className="alert alert-danger m-3">{ips.error.message}</div>:null}
        <div className="table-responsive"><table className="table card-table">
          <thead><tr><th>Source IP</th><th className="text-end">Requests</th><th className="text-end">Denied</th><th>Investigate</th></tr></thead>
          <tbody>{ips.data?.entries.map(row=><tr key={row.value}>
            <td className="text-break">{row.value}</td><td className="text-end">{formatNumber(row.requests)}</td>
            <td className="text-end">{formatNumber(row.blocked)}</td>
            <td><Link to={`/analytics/ips/detail?value=${encodeURIComponent(row.value)}`}>IP activity profile</Link></td>
          </tr>)}
          {ips.data&&!ips.data.entries.length?<tr><td colSpan={4}>No source addresses recorded for this range.</td></tr>:null}
          </tbody></table></div></div>
      <div className="card">
        <div className="card-header"><h3 className="card-title">Individual request history</h3></div>
        {requests.error?<div className="alert alert-danger m-3">{requests.error.message}</div>:null}
        {hours>data.retainedRawDays*24?<div className="alert alert-info m-3">Choose a shorter reporting range for retained raw requests.</div>:null}
        <div className="table-responsive"><table className="table card-table">
          <thead><tr><th>Timestamp</th><th>Source IP</th><th>Request</th><th>Status</th><th>Latency</th></tr></thead>
          <tbody>{requests.data?.entries.map(row=><tr key={row.id}>
            <td>{new Date(row.at).toLocaleString()}</td>
            <td>{row.clientIp?<Link to={`/analytics/ips/detail?value=${encodeURIComponent(row.clientIp)}`}>{row.clientIp}</Link>:"—"}</td>
            <td className="text-break">{row.method} {row.path}</td><td>{row.status}</td><td>{formatMs(row.durationMs)}</td>
          </tr>)}
          {requests.data&&!requests.data.entries.length?<tr><td colSpan={5}>No matching requests.</td></tr>:null}
          </tbody></table></div>
        <div className="card-footer d-flex justify-content-between align-items-center gap-3">
          <span>{formatNumber(requests.data?.total||0)} request records</span>
          <div className="btn-group btn-group-sm">
            <button type="button" className="btn btn-outline-secondary" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}>Previous</button>
            <button type="button" className="btn btn-outline-secondary"
              disabled={!requests.data||offset+requests.data.entries.length>=requests.data.total}
              onClick={()=>setOffset(offset+50)}>Next</button>
          </div>
        </div>
      </div>
    </>}
  </section>;
}

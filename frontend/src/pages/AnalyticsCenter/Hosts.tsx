import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { type NodeHost } from "src/api/backend";
import { formatBytes, formatNumber, routeName, useAnalyticsPage } from "./Shared";

type SortOrder = "requests" | "bytes" | "errors" | "name";
const kinds = ["all", "proxy", "redirection", "dead", "default", "fallback"] as const;

export default function HostsPage() {
  const {data} = useAnalyticsPage();
  const [search,setSearch] = useState("");
  const [kind,setKind] = useState<(typeof kinds)[number]>("all");
  const [sort,setSort] = useState<SortOrder>("requests");
  const [show,setShow] = useState(50);
  const rows = useMemo(() => data.hosts.filter((row) => {
    if(kind!=="all" && row.kind!==kind) return false;
    const haystack=[routeName(row),row.kind,String(row.routeId??""),...row.domains].join(" ").toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  }).sort((a,b) => sort === "name" ? routeName(a).localeCompare(routeName(b))
    : sort === "errors" ? b.errors-a.errors
      : sort === "bytes" ? b.bytesOut-a.bytesOut : b.requests-a.requests),
  [data.hosts,search,kind,sort]);
  const requestCount=rows.reduce((n,r)=>n+r.requests,0);
  const bytes=rows.reduce((n,r)=>n+r.bytesOut,0);
  return <section className="npmi-center-page" aria-label="HTTP route analytics directory">
    <div className="row row-cards mb-3">
      <div className="col-md-4"><div className="card card-body h-100">
        <span className="text-secondary">Matching routes</span><strong className="h2 mt-2 mb-0">{formatNumber(rows.length)}</strong>
      </div></div>
      <div className="col-md-4"><div className="card card-body h-100">
        <span className="text-secondary">Requests handled</span><strong className="h2 mt-2 mb-0">{formatNumber(requestCount)}</strong>
      </div></div>
      <div className="col-md-4"><div className="card card-body h-100">
        <span className="text-secondary">Response traffic</span><strong className="h2 mt-2 mb-0">{formatBytes(bytes)}</strong>
      </div></div>
    </div>
    <div className="card">
      <div className="card-header"><h3 className="card-title">All HTTP routing sources on this node</h3></div>
      <div className="card-body">
        <div className="row g-2 align-items-end">
          <div className="col-lg-5"><label className="form-label" htmlFor="analytics-route-search">Search routes and domains</label>
            <input id="analytics-route-search" className="form-control" value={search} onChange={(e)=>{setSearch(e.target.value);setShow(50);}}
              placeholder="Hostname, route name or ID"/></div>
          <div className="col-lg-3"><label className="form-label" htmlFor="analytics-route-kind">Source category</label>
            <select id="analytics-route-kind" className="form-select" value={kind}
              onChange={(e)=>{setKind(e.target.value as typeof kind);setShow(50);}}>
              {kinds.map(k=><option value={k} key={k}>{k==="all"?"All route types":k}</option>)}
            </select></div>
          <div className="col-lg-3"><label className="form-label" htmlFor="analytics-route-sort">Sort results</label>
            <select id="analytics-route-sort" className="form-select" value={sort} onChange={(e)=>setSort(e.target.value as SortOrder)}>
              <option value="requests">Most requests</option><option value="bytes">Most bandwidth</option>
              <option value="errors">Most server errors</option><option value="name">Route name</option>
            </select></div>
          <div className="col-lg-1"><button className="btn btn-outline-secondary w-100" type="button"
            onClick={()=>{setSearch("");setKind("all");setSort("requests");setShow(50);}}>Reset</button></div>
        </div>
      </div>
      <div className="table-responsive"><table className="table table-vcenter card-table">
        <thead><tr><th>Routing source</th><th>Type / state</th><th className="text-end">Requests</th>
          <th className="text-end">Outbound traffic</th><th className="text-end">5xx</th><th>Investigation</th></tr></thead>
        <tbody>
          {rows.slice(0,show).map((row:NodeHost)=><tr key={row.hostId}>
            <td className="text-break"><Link className="fw-semibold"
              to={`/analytics/hosts/detail?source=${row.hostId}`}>{routeName(row)}</Link>
              <div className="small text-secondary">Analytics source #{row.hostId}</div>
            </td>
            <td>{row.kind}{row.enabled===false?" · Disabled":""}{!row.configured?" · Removed":""}</td>
            <td className="text-end">{formatNumber(row.requests)}</td><td className="text-end">{formatBytes(row.bytesOut)}</td>
            <td className="text-end">{formatNumber(row.errors)}</td>
            <td><div className="d-flex flex-wrap gap-2">
              <Link to={`/analytics/hosts/detail?source=${row.hostId}`}>Deep dive</Link>
              {row.kind==="proxy" && row.configured?<Link to={`/nginx/proxy/${row.routeId}/analytics`}>Host Analytics</Link>:null}
            </div></td>
          </tr>)}
          {!rows.length?<tr><td colSpan={6}>No HTTP routes match your filters.</td></tr>:null}
        </tbody>
      </table></div>
      <div className="card-footer d-flex justify-content-between align-items-center gap-2">
        <span className="small text-secondary">Showing {Math.min(show,rows.length)} of {formatNumber(rows.length)} routing sources</span>
        {show<rows.length?<button className="btn btn-outline-secondary btn-sm" type="button" onClick={()=>setShow(n=>n+50)}>Show 50 more</button>:null}
      </div>
    </div>
  </section>;
}

import { IconShieldCheck } from "@tabler/icons-react";
import { Breakdown, RouteRef, formatNumber, useAnalyticsPage } from "./Shared";

export default function SecurityPage() {
  const {data} = useAnalyticsPage();
  return (
    <section aria-label="Security analytics" className="npmi-center-page">
      <>
          <div className="alert alert-info d-flex gap-2"><IconShieldCheck size={20}/>
            HTTP errors and unusual user agents are indicators, not proof of abuse. Source IPs are recorded, but unique people cannot be inferred.
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
                  <td><RouteRef hostId={row.hostId}/></td>
                  <td className="text-break">{row.path}</td><td className="text-end">{formatNumber(row.requests)}</td>
                  <td className="text-end">{formatNumber(row.serverErrors)}</td>
                </tr>)}
                {!data.errorPaths.length ? <tr><td colSpan={4} className="text-secondary">No error path records retained.</td></tr> : null}
              </tbody></table></div></div>
        </>
    </section>
  );
}

import { Link } from "react-router-dom";
import { SummaryCard, Breakdown, HostTable, statusClasses, formatNumber, formatBytes, useAnalyticsPage } from "./Shared";

export default function OverviewPage() {
  const {data} = useAnalyticsPage();
  return (
    <section aria-label="Overview analytics" className="npmi-center-page">
      <>
        <div className="row row-cards mb-3">
          <SummaryCard label="HTTP requests" value={formatNumber(data.requests)} sub="Recorded on this node"/>
          <SummaryCard label="Response bandwidth" value={formatBytes(data.bytesOut)} sub="Outbound traffic"/>
          <SummaryCard label="HTTP error rate" value={`${(100 * data.serverErrorRate).toFixed(2)}%`} sub="All 5xx responses"/>
          <SummaryCard label="Reporting routes" value={formatNumber(data.activeHosts)} sub="Routes with observed traffic"/>
        </div>
          <div className="card mb-3"><div className="card-header"><h3 className="card-title">HTTP response distribution</h3></div>
            <div className="card-body">
              <div className="npmi-center-status" role="img" aria-label="HTTP response distribution">
                {statusClasses.map((status) => <div key={status} className={`npmi-center-status-${status}`}
                  style={{ width: `${data.requests ? 100 * (data.status[status] || 0) / data.requests : 0}%` }}/>)}
              </div>
              <div className="d-flex flex-wrap gap-4 small mt-3">
                {statusClasses.map((s) => <span key={s}><strong>{s}</strong> {formatNumber(data.status[s] || 0)}</span>)}
              </div>
            </div></div>
          <div className="row row-cards mb-3">
            <div className="col-lg-6"><Breakdown title="Top hostnames" items={data.domains}/></div>
            <div className="col-lg-6"><Breakdown title="HTTP methods" items={data.methods}/></div>
          </div>
          <div className="mb-3 d-flex justify-content-end"><Link to="/analytics/trends">Explore all traffic trends →</Link></div>
          <HostTable hosts={data.hosts.slice(0, 15)}/>
        </>
    </section>
  );
}

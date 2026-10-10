import { SummaryCard, RouteRef, formatMs, formatNumber, useAnalyticsPage } from "./Shared";

export default function PerformancePage() {
  const {data} = useAnalyticsPage();
  return (
    <section aria-label="Performance analytics" className="npmi-center-page">
      <>
          <div className="row row-cards mb-3">
            <SummaryCard label="P50 response time" value={formatMs(data.latencyMs.p50)} sub="Median"/>
            <SummaryCard label="P95 response time" value={formatMs(data.latencyMs.p95)} sub="95th percentile"/>
            <SummaryCard label="P99 response time" value={formatMs(data.latencyMs.p99)} sub="99th percentile"/>
            <SummaryCard label="Timed requests" value={formatNumber(data.latencyMs.samples)} sub="Measured raw events"/>
          </div>
          <div className="card"><div className="card-header"><h3 className="card-title">Slowest URL paths (by average)</h3></div>
            <div className="table-responsive"><table className="table card-table">
              <thead><tr><th>Proxy Host</th><th>Path</th><th className="text-end">Samples</th><th className="text-end">Average</th><th className="text-end">Maximum</th></tr></thead>
              <tbody>
                {data.slowPaths.map((row, index) => <tr key={`${row.hostId}-${row.path}-${index}`}>
                  <td><RouteRef hostId={row.hostId}/></td>
                  <td className="text-break">{row.path}</td><td className="text-end">{formatNumber(row.requests)}</td>
                  <td className="text-end">{formatMs(row.averageMs)}</td><td className="text-end">{formatMs(row.maxMs)}</td>
                </tr>)}
                {!data.slowPaths.length ? <tr><td colSpan={5} className="text-secondary">No retained timing records.</td></tr> : null}
              </tbody></table></div></div>
        </>
    </section>
  );
}

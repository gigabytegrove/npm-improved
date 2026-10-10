import { useState } from "react";
import { Link } from "react-router-dom";
import { MetricChart, SummaryCard, formatBytes, formatNumber, useAnalyticsPage } from "./Shared";

export default function TrendsPage() {
  const { data } = useAnalyticsPage();
  const [metric, setMetric] = useState<"requests" | "bytesOut" | "errors">("requests");
  const peak = Math.max(0, ...data.timeline.map((point) => point[metric]));
  return <section className="npmi-center-page" aria-label="Traffic trends">
    <div className="row row-cards mb-3">
      <SummaryCard label="Requests in period" value={formatNumber(data.requests)} sub="HTTP traffic on this node"/>
      <SummaryCard label="Response bandwidth" value={formatBytes(data.bytesOut)} sub="Sent to clients"/>
      <SummaryCard label="Server errors" value={formatNumber(data.status["5xx"] || 0)} sub="HTTP 5xx responses"/>
      <SummaryCard label="Highest interval" value={metric === "bytesOut" ? formatBytes(peak) : formatNumber(peak)} sub={data.granularity + " bucket"}/>
    </div>
    <div className="card mb-3">
      <div className="card-header d-flex justify-content-between flex-wrap gap-2">
        <h3 className="card-title">Traffic over time</h3>
        <div role="group" aria-label="Trend metric" className="btn-group btn-group-sm">
          {(["requests", "bytesOut", "errors"] as const).map((option) =>
            <button type="button" className={`btn ${option===metric ? "btn-primary" : "btn-outline-secondary"}`}
              aria-pressed={option === metric} key={option} onClick={() => setMetric(option)}>
              {option === "requests" ? "Requests" : option === "bytesOut" ? "Bandwidth" : "5xx errors"}
            </button>)}
        </div>
      </div>
      <div className="card-body"><MetricChart timeline={data.timeline} kind={metric}/></div>
    </div>
    <div className="card">
      <div className="card-header"><h3 className="card-title">Interval breakdown</h3></div>
      <div className="table-responsive"><table className="table card-table table-vcenter">
        <thead><tr><th>Interval begins</th><th className="text-end">Requests</th><th className="text-end">Traffic sent</th><th className="text-end">5xx errors</th></tr></thead>
        <tbody>{[...data.timeline].reverse().map((row) => <tr key={row.at}>
          <td>{new Date(row.at).toLocaleString()}</td><td className="text-end">{formatNumber(row.requests)}</td>
          <td className="text-end">{formatBytes(row.bytesOut)}</td><td className="text-end">{formatNumber(row.errors)}</td>
        </tr>)}
        {!data.timeline.length ? <tr><td colSpan={4}>No requests in the selected window.</td></tr> : null}
        </tbody>
      </table></div>
    </div>
    <p className="text-secondary small mt-3">Intervals are {data.granularity}-based, and historical totals may use retained rollups. <Link to="/analytics/requests">Investigate individual requests</Link> for raw connection details.</p>
  </section>;
}

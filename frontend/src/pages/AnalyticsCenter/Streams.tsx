import { Link } from "react-router-dom";
import { SummaryCard, formatNumber, formatBytes, useAnalyticsPage } from "./Shared";

export default function StreamsPage() {
  const {data} = useAnalyticsPage();
  return (
    <section aria-label="Streams analytics" className="npmi-center-page">
      <>
          <div className="alert alert-info">{data.streamTraffic.limitations}</div>
          <div className="row row-cards mb-3">
            <SummaryCard label="Stream sessions" value={formatNumber(data.streamTraffic.sessions)} sub="TCP and UDP sessions, not HTTP requests"/>
            <SummaryCard label="Sent by node" value={formatBytes(data.streamTraffic.bytesSent)} sub="Stream network bytes sent"/>
            <SummaryCard label="Received by node" value={formatBytes(data.streamTraffic.bytesReceived)} sub="Stream network bytes received"/>
            <SummaryCard label="TCP / UDP" value={`${formatNumber(data.streamTraffic.tcp)} / ${formatNumber(data.streamTraffic.udp)}`} sub="Completed stream sessions"/>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="card-title">Layer 4 traffic by configured stream</h3></div>
            <div className="table-responsive"><table className="table card-table">
              <thead><tr><th>Stream</th><th>Protocol</th><th className="text-end">Sessions</th><th className="text-end">Sent</th><th className="text-end">Received</th></tr></thead>
              <tbody>
                {data.streamTraffic.streams.map((stream) => <tr key={`${stream.streamId}-${stream.protocol}`}>
                  <td>{stream.streamId === 0 ? "Unclassified / fallback stream" : <Link to="/nginx/stream">
                    {stream.incomingPort ? `Port ${stream.incomingPort}` : `Stream #${stream.streamId}`}
                  </Link>}</td>
                  <td>{stream.protocol}</td>
                  <td className="text-end">{formatNumber(stream.sessions)}</td>
                  <td className="text-end">{formatBytes(stream.bytesSent)}</td>
                  <td className="text-end">{formatBytes(stream.bytesReceived)}</td>
                </tr>)}
                {!data.streamTraffic.streams.length ? <tr><td colSpan={5} className="text-secondary">No stream sessions recorded in this period.</td></tr> : null}
              </tbody>
            </table></div>
          </div>
        </>
    </section>
  );
}

import { IconActivity, IconRefresh, IconShieldExclamation } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  getHostTrafficIntelligence, type HostClientSignal, type HostLiveRequest, type LiveMinutes,
} from "src/api/backend";
import { formatBytes, formatDate, formatNumber, routeName, useAnalyticsPage } from "./Shared";

function ClientPanel({ title, kind, entries }: {
  title: string; kind: "ip" | "agent"; entries: HostClientSignal[];
}) {
  return <section className="card mb-3">
    <div className="card-header"><h3 className="card-title">{title} ({entries.length})</h3></div>
    <div className="card-body">
      {!entries.length ? <div className="text-secondary">No clients met the investigation thresholds in this window. This does not guarantee the traffic is safe.</div> : null}
      <div className="row row-cards">
        {entries.map((entry) => {
          const inspect = kind === "ip" ? "/analytics/ips/detail?value=" : "/analytics/user-agents/detail?value=";
          const block = kind === "ip"
            ? "/analytics/blocking?type=ip&target=" + encodeURIComponent(entry.value)
            : "/analytics/blocking?type=user_agent";
          return <div className="col-12 col-xl-6" key={entry.value}>
            <div className="card h-100"><div className="card-body">
              <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-2">
                <div className="text-break flex-grow-1"><strong>{entry.value}</strong>
                  <div className="small text-secondary">{kind === "ip" ? "Source address" : "Claimed user agent"}</div>
                </div>
                <span className={"badge " + (entry.priority === "high" ? "bg-red-lt text-danger" : "bg-yellow-lt text-warning")}>
                  {entry.priority === "high" ? "Elevated signals" : "Review"}
                </span>
              </div>
              <div className="d-flex flex-wrap gap-3 small mb-2">
                <span>{formatNumber(entry.requests)} requests</span>
                <span>{formatNumber(entry.clientErrors)} 4xx</span>
                <span>{formatNumber(entry.serverErrors)} 5xx</span>
                <span>{formatNumber(entry.blocked)} denied</span>
              </div>
              <div className="d-flex flex-wrap gap-2 mb-3">
                {entry.signals.map((signal) => <span className="badge bg-orange-lt" key={signal}>{signal}</span>)}
              </div>
              <div className="small text-secondary mb-2">Last observed: {new Date(entry.lastSeen * 1000).toLocaleString()}</div>
              <div className="d-flex flex-wrap gap-2">
                <Link to={inspect + encodeURIComponent(entry.value)} className="btn btn-sm btn-outline-secondary">Investigate requests</Link>
                <Link to={block} className="btn btn-sm btn-outline-danger">
                  Prepare node-wide {kind === "ip" ? "IP" : "user-agent"} block
                </Link>
              </div>
            </div></div>
          </div>;
        })}
      </div>
    </div>
  </section>;
}

function RequestCard({ request }: { request: HostLiveRequest }) {
  return <div className="border-bottom py-2">
    <div className="d-flex flex-wrap gap-2 justify-content-between">
      <strong className="text-break">{request.method} {request.path}</strong>
      <div className="d-flex gap-2 align-items-center small">
        <span className={request.status >= 400 ? "text-danger" : "text-secondary"}>HTTP {request.status}</span>
        <span>{formatBytes(request.bytesOut)}</span>
      </div>
    </div>
    <div className="small text-secondary d-flex flex-wrap gap-2">
      <span>{new Date(request.at).toLocaleTimeString()}</span>
      {request.clientIp
        ? <Link to={"/analytics/ips/detail?value=" + encodeURIComponent(request.clientIp)}>{request.clientIp}</Link>
        : <span>IP unavailable</span>}
      <span>{request.botClass || "Unclassified"}</span>
      {request.blockReason ? <span className="text-danger">Denied: {request.blockReason}</span> : null}
    </div>
    <div className="small text-secondary text-break">{request.userAgent || "User agent not recorded"}</div>
  </div>;
}

export default function LiveHostPage() {
  const { data } = useAnalyticsPage();
  const [params] = useSearchParams();
  const raw = params.get("source");
  const source = raw !== null && /^-?\d+$/.test(raw) ? Number(raw) : 0;
  const valid = Number.isSafeInteger(source) && source !== 0 &&
    (source > 0 ? source < 1000000 : source <= -1000001 && source >= -3000001);
  const route = data.hosts.find((host) => host.hostId === source);
  const [minutes, setMinutes] = useState<LiveMinutes>(15);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const live = useQuery({
    queryKey: ["analytics-host-intelligence", source, minutes],
    queryFn: () => getHostTrafficIntelligence(source, minutes),
    enabled: valid,
    refetchInterval: autoRefresh ? 10000 : false,
    refetchIntervalInBackground: false,
  });
  if (!valid) return <section className="alert alert-warning">
    Choose a source from <Link to="/analytics/hosts">HTTP Routes</Link> to inspect its near-real-time requests.
  </section>;
  const report = live.data;
  return <section className="npmi-center-page" aria-label="Near-real-time host traffic investigation">
    <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-3">
      <div><Link to={"/analytics/hosts/detail?source=" + source}>← Route analytics</Link>
        <h3 className="h2 mt-2 mb-1 text-break">{route ? routeName(route) : "Source #" + source}</h3>
        <p className="text-secondary mb-0">Completed HTTP requests on this NPMi node, refreshed from the log collector.</p>
      </div>
      <div className="d-flex align-items-end flex-wrap gap-2">
        <div><label htmlFor="live-window" className="form-label">Live window</label>
          <select id="live-window" className="form-select" value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value) as LiveMinutes)}>
            <option value={5}>5 minutes</option><option value={15}>15 minutes</option>
            <option value={60}>60 minutes</option>
          </select>
        </div>
        <button type="button" className="btn btn-outline-secondary" aria-pressed={autoRefresh}
          onClick={() => setAutoRefresh(!autoRefresh)}>{autoRefresh ? "Pause live refresh" : "Resume live refresh"}</button>
        <button type="button" className="btn btn-outline-secondary" disabled={live.isFetching}
          onClick={() => void live.refetch()}><IconRefresh size={17}/> Refresh</button>
      </div>
    </div>
    {live.error ? <div className="alert alert-danger">{live.error.message}</div> : null}
    {live.isPending ? <div className="card card-body">Loading recorded requests…</div> : null}
    {report ? <>
      <div role="status" className="alert alert-info small">
        <IconActivity size={17} className="me-2"/>
        {autoRefresh ? "Automatic 10-second refresh enabled" : "Automatic refresh paused"}.
        Collection runs approximately every {report.collectorIntervalSeconds}s; this is not a live packet capture.
        Latest recorded request: {formatDate(report.latestRequestAt)}.
        Last log ingestion: {formatDate(report.lastIngestedAt)}.
      </div>
      <div className="row row-cards mb-3">
        <div className="col-sm-6 col-xl-3"><div className="card card-body h-100">
          <div className="small text-secondary">Requests</div><strong className="h2 mt-2">{formatNumber(report.requests)}</strong>
          <div className="small text-secondary">{minutes}-minute observation window</div>
        </div></div>
        <div className="col-sm-6 col-xl-3"><div className="card card-body h-100">
          <div className="small text-secondary">Traffic sent</div><strong className="h2 mt-2">{formatBytes(report.bytesOut)}</strong>
        </div></div>
        <div className="col-sm-6 col-xl-3"><div className="card card-body h-100">
          <div className="small text-secondary">Source IPs</div><strong className="h2 mt-2">{formatNumber(report.uniqueIps)}</strong>
          <div className="small text-secondary">Not unique people</div>
        </div></div>
        <div className="col-sm-6 col-xl-3"><div className="card card-body h-100">
          <div className="small text-secondary">Denied responses</div><strong className="h2 mt-2">{formatNumber(report.blocked)}</strong>
          <div className="small text-secondary">{formatNumber(report.clientErrors)} 4xx · {formatNumber(report.serverErrors)} 5xx</div>
        </div></div>
      </div>
      <div className="card mb-3">
        <div className="card-header"><h3 className="card-title">Requests by minute</h3></div>
        <div className="card-body">
          <div className="d-flex flex-wrap gap-1 align-items-end" style={{minHeight: 100}} role="img"
            aria-label="Minute-by-minute request counts">
            {report.timeline.map((bucket) => <div key={bucket.at}
              title={new Date(bucket.at).toLocaleTimeString() + ": " + bucket.requests + " requests"}
              style={{flex: "1 1 4px", minWidth: 3, height: Math.max(3, bucket.requests / Math.max(1,...report.timeline.map(x=>x.requests)) * 85), background: "var(--npi-primary)", borderRadius: 2}} />)}
          </div>
          <p className="text-secondary small mb-0">Each bar represents a minute, oldest to newest. Select another window above to change the resolution.</p>
        </div>
      </div>
      <div className="alert alert-warning small"><IconShieldExclamation size={17} className="me-2"/>
        {report.limitations.detection} {report.limitations.attribution}
        Existing deny rules are <strong>node-wide</strong> and can affect other hosted applications.
      </div>
      <ClientPanel title="IP addresses requiring review" kind="ip" entries={report.suspiciousIps}/>
      <ClientPanel title="User agents requiring review" kind="agent" entries={report.suspiciousAgents}/>
      <div className="row row-cards mb-3">
        <div className="col-lg-6"><div className="card h-100">
          <div className="card-header"><h3 className="card-title">Requested paths</h3></div>
          <div className="card-body">
            {report.paths.map((path) => <div key={path.label} className="border-bottom py-2 d-flex justify-content-between gap-2">
              <span className="text-break">{path.label}</span><span className="text-end text-nowrap small">
                {formatNumber(path.requests)} requests{path.probes ? " · probe pattern" : ""}
              </span>
            </div>)}
            {!report.paths.length ? <span className="text-secondary">No recorded paths yet.</span> : null}
          </div>
        </div></div>
        <div className="col-lg-6"><div className="card h-100">
          <div className="card-header"><h3 className="card-title">Browser / client families</h3></div>
          <div className="card-body">
            {report.browsers.map((browser) => <div key={browser.label} className="border-bottom py-2 d-flex justify-content-between gap-2">
              <span className="text-break">{browser.label}</span><strong>{formatNumber(browser.requests)}</strong>
            </div>)}
            {!report.browsers.length ? <span className="text-secondary">No recorded user-agent information.</span> : null}
            <div className="small text-secondary mt-3">Browser labels are inferred from unverified user-agent strings.</div>
          </div>
        </div></div>
      </div>
      <div className="card mb-3"><div className="card-header"><h3 className="card-title">Approximate geography</h3></div>
        <div className="card-body text-secondary">{report.geography.available
          ? "GeoIP information is available." : report.geography.reason}</div></div>
      <div className="card">
        <div className="card-header d-flex justify-content-between gap-2 flex-wrap">
          <h3 className="card-title">Most recent completed requests</h3>
          <Link to={"/analytics/hosts/detail?source=" + source}>Historical request explorer</Link>
        </div>
        <div className="card-body">
          {report.recent.map((request) => <RequestCard key={request.id} request={request} />)}
          {!report.recent.length ? <span className="text-secondary">No recent completed requests in the selected window.</span> : null}
        </div>
      </div>
    </> : null}
  </section>;
}

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  IconActivity, IconChartBar, IconRefresh, IconServer, IconTransfer,
} from "@tabler/icons-react";
import { getNodeAnalytics, type HttpStatusClass, type NodeFilters, type NodeHours } from "src/api/backend";
import { HasPermission } from "src/components";
import { ADMIN, VIEW } from "src/modules/Permissions";
import { formatDate, routeName } from "./Shared";
import "./analytics-center.css";

export const analyticsPages = [
  { path: "", label: "Overview", description: "Node health, status mix and traffic highlights", group: "Reporting" },
  { path: "trends", label: "Trends", description: "Bandwidth, errors and requests over time", group: "Reporting" },
  { path: "traffic", label: "Traffic Breakdown", description: "URLs, methods, HTTP versions and upstreams", group: "Reporting" },
  { path: "hosts", label: "HTTP Routes", description: "Traffic per proxy host, redirect and default route", group: "Reporting" },
  { path: "streams", label: "TCP / UDP Streams", description: "Layer 4 completed sessions and bytes", group: "Reporting" },
  { path: "requests", label: "Request History", description: "Search individual requests, timestamps and user agents", group: "Investigation" },
  { path: "connections", label: "Connection History", description: "Investigate recorded Nginx connection identifiers", group: "Investigation" },
  { path: "ips", label: "IP Addresses", description: "Source IPs, first and last seen and related requests", group: "Investigation" },
  { path: "user-agents", label: "User Agents & Bots", description: "Full user agents, bot signals and classifications", group: "Investigation" },
  { path: "security", label: "Errors & Security", description: "Failure hotspots and error paths", group: "Security" },
  { path: "blocking", label: "Blocking & Enforcement", description: "Node-local IP and user-agent rules and audit", group: "Security" },
  { path: "performance", label: "Performance", description: "Latency percentiles and slow endpoints", group: "Security" },
] as const;

const periods: Array<{ hours: NodeHours; label: string }> = [
  { hours: 1, label: "Last hour" },
  { hours: 24, label: "Last 24 hours" },
  { hours: 168, label: "Last 7 days" },
  { hours: 720, label: "Last 30 days" },
  { hours: 2160, label: "Last 90 days" },
];
const statusClasses: HttpStatusClass[] = ["2xx", "3xx", "4xx", "5xx"];

export default function AnalyticsCenter() {
  const [hours, setHours] = useState<NodeHours>(24);
  const [hostId, setHostId] = useState<number | null>(null);
  const [statusClass, setStatusClass] = useState<HttpStatusClass | null>(null);
  const location = useLocation();
  const filters: NodeFilters = { hours, hostId, statusClass };
  const report = useQuery({
    queryKey: ["analytics-center-report", hours, hostId, statusClass],
    queryFn: () => getNodeAnalytics(filters),
    refetchInterval: 30000,
  });
  const hostsQuery = useQuery({
    queryKey: ["analytics-center-host-selector"],
    queryFn: () => getNodeAnalytics({ hours: 168 }),
    staleTime: 120000,
    refetchInterval: 120000,
  });
  const candidateHosts = useMemo(() => hostsQuery.data?.hosts || report.data?.hosts || [],
    [hostsQuery.data?.hosts, report.data?.hosts]);
  const active = analyticsPages.find((page) =>
    (location.pathname === (page.path ? "/analytics/" + page.path : "/analytics") ||
    (!!page.path && location.pathname.startsWith("/analytics/" + page.path + "/")))) || analyticsPages[0];
  const pageGroups = ["Reporting", "Investigation", "Security"];

  return <HasPermission section={ADMIN} permission={VIEW} pageLoading loadingNoLogo>
    <div className="npmi-center mt-4">
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
        <div>
          <h1 className="h2 d-flex align-items-center gap-2 mb-1"><IconChartBar size={26}/> Analytics Center</h1>
          <p className="text-secondary mb-0">Investigate and manage traffic handled by this NPM Improved node.</p>
        </div>
        <button type="button" className="btn btn-outline-secondary" onClick={() => void report.refetch()}>
          <IconRefresh size={17}/> Refresh
        </button>
      </div>
      {report.data ? <div className="card mb-3 npmi-center-node">
        <div className="card-body d-flex align-items-center flex-wrap gap-3">
          <IconServer size={25}/>
          <div className="flex-grow-1"><strong>{report.data.node.name}</strong>
            <div className="small text-secondary">This node only · {report.data.node.role} · {report.data.node.version || "unknown version"}</div>
          </div>
          <span className="badge bg-success-lt text-success">Node-local reporting</span>
        </div>
      </div> : null}
      <div className="card mb-3"><div className="card-body">
        <div className="d-flex flex-wrap gap-3 align-items-end">
          <div><label htmlFor="analytics-period" className="form-label">Reporting period</label>
            <select id="analytics-period" className="form-select" value={hours} onChange={(e) =>
              setHours(Number(e.target.value) as NodeHours)}>
              {periods.map((period) => <option key={period.hours} value={period.hours}>{period.label}</option>)}
            </select>
          </div>
          <div className="flex-grow-1 npmi-center-select"><label htmlFor="analytics-route" className="form-label">HTTP route</label>
            <select id="analytics-route" className="form-select" value={hostId ?? ""} onChange={(e) =>
              setHostId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">All HTTP routes on this node</option>
              {candidateHosts.map((host) => <option key={host.hostId} value={host.hostId}>{routeName(host)}</option>)}
            </select>
          </div>
          <div><label htmlFor="analytics-status" className="form-label">Response status</label>
            <select id="analytics-status" className="form-select" value={statusClass ?? ""} onChange={(e) =>
              setStatusClass(e.target.value ? e.target.value as HttpStatusClass : null)}>
              <option value="">All HTTP statuses</option>
              {statusClasses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
        </div>
      </div></div>
      <div className="npmi-analytics-layout">
        <aside className="npmi-analytics-nav" aria-label="Analytics section navigation">
          {pageGroups.map((group) => <div className="npmi-analytics-nav-group" key={group}>
            <div className="npmi-analytics-nav-label">{group}</div>
            {analyticsPages.filter((page) => page.group === group).map((page) =>
              <NavLink key={page.path} to={page.path ? "/analytics/" + page.path : "/analytics"} end
                className={({ isActive }) => "npmi-analytics-nav-link" + (isActive ? " active" : "")}>
                {page.label}
              </NavLink>)}
          </div>)}
        </aside>
        <main className="npmi-analytics-content">
          <div className="npmi-analytics-heading">
            <div className="d-flex align-items-center gap-2"><IconActivity size={19}/>
              <h2 className="h3 m-0">{active.label}</h2></div>
            <p className="text-secondary mb-0 mt-1">{active.description}</p>
          </div>
          {report.error ? <div className="alert alert-danger">{report.error.message}</div> : null}
          {report.isPending ? <div className="card card-body text-secondary">Loading this node's analytics…</div> : null}
          {report.data ? <>
            <Outlet context={{data: report.data, filters, hours}}/>
            {report.data.accuracy === "hourly-rollup" ? <div className="alert alert-info mt-3">
              Historical aggregates are available for this period; exact connection, IP and user-agent records require retained raw events.
            </div> : null}
            <div className="card mt-3"><div className="card-body">
              <div className="d-flex align-items-center gap-2 mb-1"><IconActivity size={17}/><strong>Collection & scope</strong></div>
              <div className="small text-secondary">Last ingestion: {formatDate(report.data.lastIngestedAt)} · Most recent request: {formatDate(report.data.lastSeen)}</div>
              <div className="small text-secondary">{report.data.limitations.coverage}</div>
              <div className="small text-secondary">Raw event retention: {report.data.retainedRawDays} days · Historical rollups: {report.data.retainedRollupDays} days</div>
              <div className="small text-secondary d-flex gap-2 align-items-center mt-2"><IconTransfer size={16}/> Configuration sync does not replicate analytics between NPMX nodes.</div>
            </div></div>
          </> : null}
        </main>
      </div>
    </div>
  </HasPermission>;
}

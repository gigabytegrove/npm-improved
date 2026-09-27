import { useMemo, useState } from "react";
import Alert from "react-bootstrap/Alert";
import type { SecurityLogEvent } from "src/api/backend";
import { Loading } from "src/components";
import { useSecurityLogSummary } from "src/hooks";

const WINDOWS = [1, 6, 24, 72, 168];
const SEVERITIES = ["all", "critical", "high", "medium", "low"] as const;

const severityClass = (severity: SecurityLogEvent["severity"]) => {
	switch (severity) {
		case "critical":
			return "bg-red text-white";
		case "high":
			return "bg-red-lt text-red";
		case "medium":
			return "bg-yellow-lt text-yellow";
		default:
			return "bg-blue-lt text-blue";
	}
};

const formatCategory = (category: string) =>
	category
		.split("-")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");

const formatTimestamp = (timestamp: string | null) => {
	if (!timestamp) return "Unknown";
	const parsed = new Date(timestamp);
	return Number.isNaN(parsed.getTime()) ? timestamp : parsed.toLocaleString();
};

export default function SecurityOverview() {
	const [hours, setHours] = useState(24);
	const [live, setLive] = useState(true);
	const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("all");
	const [search, setSearch] = useState("");

	const query = useSecurityLogSummary({ hours, limit: 250, live });
	const data = query.data;

	const events = useMemo(() => {
		const needle = search.trim().toLowerCase();
		return (data?.events || []).filter((event) => {
			if (severity !== "all" && event.severity !== severity) return false;
			if (!needle) return true;
			return [
				event.label,
				event.category,
				event.clientIp,
				event.host,
				event.uri,
				event.userAgent,
				String(event.status),
			].some((value) => value?.toLowerCase().includes(needle));
		});
	}, [data?.events, search, severity]);

	return (
		<div className="card mt-4">
			<div className="card-status-top bg-red" />
			<div className="card-header">
				<div className="row w-full g-2 align-items-center">
					<div className="col">
						<h2 className="mt-1 mb-0">Security Events</h2>
						<div className="text-secondary small">
							Heuristic detections from HTTP access logs. Events describe request patterns, not proven intent.
						</div>
					</div>
					<div className="col-auto">
						<select
							className="form-select form-select-sm"
							aria-label="Security event lookback window"
							value={hours}
							onChange={(e) => setHours(Number(e.target.value))}
						>
							{WINDOWS.map((windowHours) => (
								<option key={windowHours} value={windowHours}>
									{windowHours === 1 ? "Last hour" : "Last " + windowHours + " hours"}
								</option>
							))}
						</select>
					</div>
					<div className="col-auto">
						<button
							type="button"
							className={"btn btn-sm " + (live ? "btn-success" : "btn-outline-secondary")}
							onClick={() => setLive((value) => !value)}
						>
							{live ? "Live" : "Paused"}
						</button>
					</div>
					<div className="col-auto">
						<button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => query.refetch()}>
							Refresh
						</button>
					</div>
				</div>
			</div>

			{query.isError ? (
				<div className="card-body">
					<Alert variant="danger">{query.error?.message || "Unable to load security events"}</Alert>
				</div>
			) : null}

			{query.isLoading && !data ? (
				<div className="card-body">
					<Loading noLogo />
				</div>
			) : (
				<>
					<div className="card-body">
						<div className="row g-3">
							<div className="col-6 col-lg-3">
								<div className="card card-sm h-100">
									<div className="card-body">
										<div className="text-secondary">Requests analyzed</div>
										<div className="h1 mb-0">{data?.requestsAnalyzed.toLocaleString() || 0}</div>
									</div>
								</div>
							</div>
							<div className="col-6 col-lg-3">
								<div className="card card-sm h-100">
									<div className="card-body">
										<div className="text-secondary">Security events</div>
										<div className="h1 mb-0">{data?.eventsDetected.toLocaleString() || 0}</div>
									</div>
								</div>
							</div>
							<div className="col-6 col-lg-3">
								<div className="card card-sm h-100">
									<div className="card-body">
										<div className="text-secondary">Denied / throttled</div>
										<div className="h1 mb-0">{data?.blockedResponses.toLocaleString() || 0}</div>
										<div className="text-secondary small">HTTP 401, 403, 429 or 444</div>
									</div>
								</div>
							</div>
							<div className="col-6 col-lg-3">
								<div className="card card-sm h-100">
									<div className="card-body">
										<div className="text-secondary">Unique source IPs</div>
										<div className="h1 mb-0">{data?.uniqueIps.toLocaleString() || 0}</div>
									</div>
								</div>
							</div>
						</div>

						{data?.hostLimitReached || data?.filesTruncated ? (
							<Alert variant="warning" className="mt-3 mb-0">
								This summary reached a safety scan limit. The displayed events are accurate for the logs scanned,
								but the totals may not represent every request in the selected window.
							</Alert>
						) : null}

						<div className="row g-3 mt-0">
							<div className="col-12 col-lg-6">
								<div className="card h-100">
									<div className="card-header">
										<h3 className="card-title">Top security-event sources</h3>
									</div>
									<div className="table-responsive">
										<table className="table table-vcenter card-table">
											<tbody>
												{data?.topSources.length ? (
													data.topSources.map((item) => (
														<tr key={item.key}>
															<td className="font-monospace">{item.key}</td>
															<td className="text-end fw-bold">{item.count.toLocaleString()}</td>
														</tr>
													))
												) : (
													<tr>
														<td className="text-secondary">No classified security events in this window.</td>
													</tr>
												)}
											</tbody>
										</table>
									</div>
								</div>
							</div>
							<div className="col-12 col-lg-6">
								<div className="card h-100">
									<div className="card-header">
										<h3 className="card-title">Detected patterns</h3>
									</div>
									<div className="table-responsive">
										<table className="table table-vcenter card-table">
											<tbody>
												{data?.categories.length ? (
													data.categories.map((item) => (
														<tr key={item.key}>
															<td>{formatCategory(item.key)}</td>
															<td className="text-end fw-bold">{item.count.toLocaleString()}</td>
														</tr>
													))
												) : (
													<tr>
														<td className="text-secondary">No classified patterns in this window.</td>
													</tr>
												)}
											</tbody>
										</table>
									</div>
								</div>
							</div>
						</div>
					</div>

					<div className="card-header border-top">
						<div className="row w-full g-2 align-items-center">
							<div className="col">
								<h3 className="card-title mb-0">Recent events</h3>
							</div>
							<div className="col-auto">
								<select
									className="form-select form-select-sm"
									aria-label="Security event severity"
									value={severity}
									onChange={(e) => setSeverity(e.target.value as (typeof SEVERITIES)[number])}
								>
									{SEVERITIES.map((value) => (
										<option key={value} value={value}>
											{value === "all" ? "All severities" : formatCategory(value)}
										</option>
									))}
								</select>
							</div>
							<div className="col-auto">
								<input
									type="search"
									className="form-control form-control-sm"
									aria-label="Search security events"
									placeholder="IP, host, path, category..."
									value={search}
									onChange={(e) => setSearch(e.target.value)}
								/>
							</div>
						</div>
					</div>

					<div className="table-responsive">
						<table className="table table-vcenter card-table">
							<thead>
								<tr>
									<th>Time</th>
									<th>Severity</th>
									<th>Event</th>
									<th>Source</th>
									<th>Host</th>
									<th>Request</th>
									<th>Status</th>
								</tr>
							</thead>
							<tbody>
								{events.length ? (
									events.map((event, index) => (
										<tr key={[event.timestamp, event.clientIp, event.uri, index].join("-")}>
											<td className="text-nowrap">{formatTimestamp(event.timestamp)}</td>
											<td>
												<span className={"badge " + severityClass(event.severity)}>{event.severity}</span>
												<div className="text-secondary small">{event.confidence}</div>
											</td>
											<td>{event.label}</td>
											<td className="font-monospace text-nowrap">{event.clientIp}</td>
											<td>{event.host}</td>
											<td style={{ minWidth: 320 }}>
												<div className="font-monospace text-truncate" style={{ maxWidth: 520 }} title={event.uri}>
													{event.method} {event.uri}
												</div>
											</td>
											<td>
												<span
													className={
														"badge " +
														([401, 403, 429, 444].includes(event.status)
															? "bg-red-lt text-red"
															: "bg-secondary-lt")
													}
												>
													{event.status}
												</span>
											</td>
										</tr>
									))
								) : (
									<tr>
										<td colSpan={7} className="text-center text-secondary py-4">
											No security events match the current filters.
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>

					<div className="card-footer text-secondary small">
						Scanned {data?.sourcesScanned || 0} HTTP host log sources. {data?.filesMissing || 0} had no access log
						yet. Updated {data?.generatedAt ? formatTimestamp(data.generatedAt) : "—"}.
					</div>
				</>
			)}
		</div>
	);
}

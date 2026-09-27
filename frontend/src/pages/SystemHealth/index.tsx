import type { ElementType, ReactNode } from "react";
import {
	IconCertificate,
	IconDatabase,
	IconFileText,
	IconHeartbeat,
	IconHistory,
	IconServer,
} from "@tabler/icons-react";
import type { ComponentHealth } from "src/api/backend";
import { HasPermission, Loading } from "src/components";
import { useSystemHealth } from "src/hooks";
import { T } from "src/locale";
import { ADMIN, VIEW } from "src/modules/Permissions";

const statusBadge = (status?: string) => (
	<span className={`badge ${status === "ok" ? "bg-green-lt" : "bg-red-lt"}`}>
		{status === "ok" ? "Healthy" : "Degraded"}
	</span>
);

const formatUptime = (seconds: number) => {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
};

const HealthCard = ({
	title,
	icon: Icon,
	check,
	children,
}: {
	title: string;
	icon: ElementType;
	check: ComponentHealth;
	children?: ReactNode;
}) => (
	<div className="col-md-6 col-xl-4">
		<div className="card h-100">
			<div className="card-body">
				<div className="d-flex align-items-start">
					<span className="avatar bg-blue-lt me-3">
						<Icon size={22} />
					</span>
					<div className="flex-fill">
						<div className="d-flex align-items-center justify-content-between gap-2">
							<h3 className="mb-0">{title}</h3>
							{statusBadge(check?.status)}
						</div>
						<div className="text-secondary mt-2">{children}</div>
					</div>
				</div>
			</div>
		</div>
	</div>
);

const SystemHealth = () => {
	const { data, isLoading, error, isFetching } = useSystemHealth();

	return (
		<HasPermission section={ADMIN} permission={VIEW} pageLoading loadingNoLogo>
			<div className="mt-4">
				<div className="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-3">
					<div>
						<h2 className="mb-1">
							<T id="system-health" />
						</h2>
						<div className="text-secondary">
							Live health of the NPM Improved control, traffic, storage, and recovery components.
						</div>
					</div>
					{data ? (
						<div className="text-secondary text-end">
							<div>{statusBadge(data.status)}</div>
							<div className="small mt-1">
								{isFetching ? "Refreshing… " : ""}
								Updated {new Date(data.generatedAt).toLocaleTimeString()}
							</div>
						</div>
					) : null}
				</div>

				{isLoading ? <Loading noLogo /> : null}
				{error ? <div className="alert alert-danger">{error.message}</div> : null}

				{data ? (
					<>
						<div className="alert alert-info">
							Backend uptime: <strong>{formatUptime(data.backendUptimeSeconds)}</strong>. Health refreshes
							automatically every 15 seconds.
						</div>
						<div className="row row-cards">
							<HealthCard title="Control Plane" icon={IconHeartbeat} check={data.checks.controlPlane}>
								<div>Independent management listener on port 81.</div>
								{typeof data.checks.controlPlane.latencyMs === "number" ? (
									<div>Health latency: {data.checks.controlPlane.latencyMs} ms</div>
								) : null}
							</HealthCard>

							<HealthCard title="Nginx" icon={IconServer} check={data.checks.nginx}>
								<div>PID: {data.checks.nginx.pid || "not detected"}</div>
								<div>Process: {data.checks.nginx.processRunning ? "running" : "not running"}</div>
								<div>Configuration: {data.checks.nginx.configValid ? "valid" : "invalid"}</div>
								<div>
									Last reload:{" "}
									{data.checks.nginx.lastReload
										? new Date(data.checks.nginx.lastReload).toLocaleString()
										: "not recorded yet"}
								</div>
							</HealthCard>

							<HealthCard title="Database" icon={IconDatabase} check={data.checks.database}>
								<div>
									Query latency:{" "}
									{typeof data.checks.database.latencyMs === "number"
										? `${data.checks.database.latencyMs} ms`
										: "unavailable"}
								</div>
							</HealthCard>

							<HealthCard title="Certificate Engine" icon={IconCertificate} check={data.checks.certificateEngine}>
								<div>Renewal timer: {data.checks.certificateEngine.renewalTimer ? "running" : "not running"}</div>
								<div>
									Lifecycle timer: {data.checks.certificateEngine.lifecycleTimer ? "running" : "not running"}
								</div>
								{data.checks.certificateEngine.renewalProcessing ? <div>Certificate renewal is running.</div> : null}
								{data.checks.certificateEngine.lifecycleProcessing ? <div>Lifecycle cleanup is running.</div> : null}
							</HealthCard>

							<HealthCard title="Log Engine" icon={IconFileText} check={data.checks.logEngine}>
								<div>Storage: {data.checks.logEngine.path || "/data/logs"}</div>
								<div>Read/write access is checked on every health refresh.</div>
							</HealthCard>

							<HealthCard title="Revision Engine" icon={IconHistory} check={data.checks.revisionEngine}>
								<div>Active: {data.checks.revisionEngine.activeRevisions ?? 0}</div>
								<div>Pending: {data.checks.revisionEngine.pendingRevisions ?? 0}</div>
								<div>Failed retained: {data.checks.revisionEngine.failedRevisions ?? 0}</div>
								<div>
									Latest active revision:{" "}
									{data.checks.revisionEngine.latestActiveRevisionId
										? `#${data.checks.revisionEngine.latestActiveRevisionId}`
										: "none yet"}
								</div>
							</HealthCard>
						</div>
					</>
				) : null}
			</div>
		</HasPermission>
	);
};

export default SystemHealth;

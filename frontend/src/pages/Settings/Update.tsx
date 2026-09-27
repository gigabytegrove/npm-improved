import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Alert } from "react-bootstrap";
import {
	getUpdateManager,
	restartManagedInstance,
	rollbackManagedUpdate,
	startManagedUpdate,
} from "src/api/backend";
import { Button, Loading } from "src/components";

const ACTIVE_STATES = new Set([
	"preflight",
	"pulling",
	"staging",
	"restarting",
	"verifying",
	"rolling_back",
]);

const statusLabel = (state?: string) => {
	switch (state) {
		case "completed":
			return "Completed";
		case "rolled_back":
			return "Rolled back";
		case "failed":
			return "Failed";
		case "preflight":
			return "Preflight";
		case "pulling":
			return "Pulling image";
		case "staging":
			return "Staging";
		case "restarting":
			return "Restarting";
		case "verifying":
			return "Verifying";
		case "rolling_back":
			return "Rolling back";
		default:
			return "Idle";
	}
};

const badgeClass = (state?: string) => {
	if (state === "completed") return "bg-success-lt text-success";
	if (state === "rolled_back") return "bg-warning-lt text-warning";
	if (state === "failed") return "bg-danger-lt text-danger";
	if (ACTIVE_STATES.has(state || "")) return "bg-azure-lt text-azure";
	return "bg-secondary-lt text-secondary";
};

export default function Update() {
	const {
		data,
		isLoading,
		error,
		refetch,
	} = useQuery({
		queryKey: ["update-manager"],
		queryFn: () => getUpdateManager(false),
		refetchInterval: 3000,
		retry: true,
	});

	const [password, setPassword] = useState("");
	const [actionError, setActionError] = useState("");
	const [checking, setChecking] = useState(false);
	const [runningAction, setRunningAction] = useState<"update" | "rollback" | "restart" | null>(null);

	const active = ACTIVE_STATES.has(data?.status?.state || "");
	const canUpdate = Boolean(
		data?.capabilities?.enabled &&
			data?.release?.updateAvailable &&
			!active &&
			password.length > 0,
	);
	const canRollback = Boolean(
		data?.capabilities?.enabled &&
			data?.status?.previousImage &&
			!active &&
			password.length > 0,
	);
	const canRestart = Boolean(data?.capabilities?.enabled && !active && password.length > 0);

	const published = useMemo(() => {
		if (!data?.release?.publishedAt) return null;
		const parsed = new Date(data.release.publishedAt);
		return Number.isNaN(parsed.getTime()) ? data.release.publishedAt : parsed.toLocaleString();
	}, [data?.release?.publishedAt]);

	if (isLoading && !data) {
		return (
			<div className="card-body">
				<Loading noLogo />
			</div>
		);
	}

	const checkNow = async () => {
		setChecking(true);
		setActionError("");
		try {
			await getUpdateManager(true);
			await refetch();
		} catch (err) {
			setActionError(err instanceof Error ? err.message : String(err));
		} finally {
			setChecking(false);
		}
	};

	const run = async (
		action: "update" | "rollback" | "restart",
		fn: (password: string) => Promise<unknown>,
	) => {
		if (!password) return;
		setRunningAction(action);
		setActionError("");
		try {
			await fn(password);
			setPassword("");
			await refetch();
		} catch (err) {
			setActionError(err instanceof Error ? err.message : String(err));
		} finally {
			setRunningAction(null);
		}
	};

	return (
		<div className="card-body">
			<div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-4">
				<div>
					<h3 className="mb-1">Update</h3>
					<p className="text-secondary mb-0">
						Check, install, restart, and roll back NPM Improved without leaving the Control Center.
					</p>
				</div>
				<Button onClick={checkNow} isLoading={checking} disabled={checking || active}>
					Check for updates
				</Button>
			</div>

			{error ? <Alert variant="danger">{error.message}</Alert> : null}
			{actionError ? <Alert variant="danger">{actionError}</Alert> : null}

			{!data?.capabilities?.enabled ? (
				<Alert variant="warning">
					<strong>Automatic updates are not ready on this deployment.</strong>
					<div className="mt-1">
						{data?.capabilities?.reason ||
							"Run the current NPM Improved Docker installer once to enable the built-in update handoff."}
					</div>
				</Alert>
			) : (
				<Alert variant="success">
					Built-in updates are enabled. No permanent update-worker container is used; a temporary
					self-cleaning handoff exists only while an update, rollback, or restart is running.
				</Alert>
			)}

			<div className="row row-cards mb-4">
				<div className="col-md-6">
					<div className="card h-100">
						<div className="card-body">
							<div className="text-secondary text-uppercase small fw-bold mb-2">Installed</div>
							<div className="h2 mb-1">{data?.release?.current || "Unknown"}</div>
							<div className="text-secondary">
								Deployment mode: {data?.capabilities?.deploymentMode || "unknown"}
							</div>
						</div>
					</div>
				</div>
				<div className="col-md-6">
					<div className="card h-100">
						<div className="card-body">
							<div className="text-secondary text-uppercase small fw-bold mb-2">Latest stable</div>
							<div className="h2 mb-1">{data?.release?.latest || "Unavailable"}</div>
							<div className={data?.release?.updateAvailable ? "text-warning" : "text-success"}>
								{data?.release?.updateAvailable ? "Update available" : "Up to date"}
							</div>
						</div>
					</div>
				</div>
			</div>

			<div className="card mb-4">
				<div className="card-header d-flex align-items-center justify-content-between">
					<h3 className="card-title">Update status</h3>
					<span className={`badge ${badgeClass(data?.status?.state)}`}>
						{statusLabel(data?.status?.state)}
					</span>
				</div>
				<div className="card-body">
					<p className="mb-3">{data?.status?.message || "No update operation has been run yet."}</p>
					<div className="table-responsive">
						<table className="table table-sm table-vcenter mb-0">
							<tbody>
								<tr>
									<th>Action</th>
									<td>{data?.status?.action || "None"}</td>
								</tr>
								<tr>
									<th>From</th>
									<td>{data?.status?.sourceVersion || data?.release?.current || "Unknown"}</td>
								</tr>
								<tr>
									<th>Target</th>
									<td>{data?.status?.targetVersion || "—"}</td>
								</tr>
								<tr>
									<th>Started</th>
									<td>
										{data?.status?.startedAt
											? new Date(data.status.startedAt).toLocaleString()
											: "—"}
									</td>
								</tr>
								<tr>
									<th>Completed</th>
									<td>
										{data?.status?.completedAt
											? new Date(data.status.completedAt).toLocaleString()
											: "—"}
									</td>
								</tr>
								{data?.status?.targetDigest ? (
									<tr>
										<th>Image digest</th>
										<td>
											<code className="text-break">{data.status.targetDigest}</code>
										</td>
									</tr>
								) : null}
							</tbody>
						</table>
					</div>
					{active ? (
						<Alert variant="info" className="mt-3 mb-0">
							The Control Center may disconnect briefly while the application container is replaced.
							This page will keep trying to reconnect automatically.
						</Alert>
					) : null}
					{data?.status?.error ? (
						<Alert variant="danger" className="mt-3 mb-0">
							{data.status.error}
						</Alert>
					) : null}
				</div>
			</div>

			<div className="card mb-4">
				<div className="card-header">
					<h3 className="card-title">Stable release</h3>
				</div>
				<div className="card-body">
					<h4 className="mb-1">
						{data?.release?.releaseName || data?.release?.latest || "No release metadata available"}
					</h4>
					{published ? <div className="text-secondary mb-3">Published {published}</div> : null}
					{data?.release?.releaseNotes ? (
						<div
							className="border rounded p-3 bg-body-tertiary"
							style={{ whiteSpace: "pre-wrap", maxHeight: "22rem", overflow: "auto" }}
						>
							{data.release.releaseNotes}
						</div>
					) : (
						<div className="text-secondary">No release notes are available.</div>
					)}
					{data?.release?.releaseUrl ? (
						<div className="mt-3">
							<a href={data.release.releaseUrl} target="_blank" rel="noreferrer">
								View release on GitHub
							</a>
						</div>
					) : null}
				</div>
			</div>

			<div className="card">
				<div className="card-header">
					<h3 className="card-title">Update controls</h3>
				</div>
				<div className="card-body">
					<Alert variant="secondary">
						Update, restart, and rollback require your current administrator password. The password is
						verified for this action and is not stored in update state.
					</Alert>

					<label className="form-label" htmlFor="update-admin-password">
						Current administrator password
					</label>
					<input
						id="update-admin-password"
						type="password"
						className="form-control"
						autoComplete="current-password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						disabled={active}
					/>

					<div className="btn-list mt-3">
						<Button
							actionType="primary"
							className="bg-teal"
							onClick={() => run("update", startManagedUpdate)}
							isLoading={runningAction === "update"}
							disabled={!canUpdate || runningAction !== null}
						>
							Update to {data?.release?.latest || "latest"}
						</Button>
						<Button
							onClick={() => run("restart", restartManagedInstance)}
							isLoading={runningAction === "restart"}
							disabled={!canRestart || runningAction !== null}
						>
							Restart NPM Improved
						</Button>
						<Button
							actionType="danger"
							onClick={() => run("rollback", rollbackManagedUpdate)}
							isLoading={runningAction === "rollback"}
							disabled={!canRollback || runningAction !== null}
						>
							Roll back to {data?.status?.previousVersion || "previous version"}
						</Button>
					</div>

					{!data?.release?.updateAvailable ? (
						<div className="text-secondary mt-3">
							The Update button stays disabled when this instance already matches the latest stable
							release.
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}

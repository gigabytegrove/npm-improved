import {
	IconAlertTriangle,
	IconCheck,
	IconDownload,
	IconHistory,
	IconRefresh,
	IconRotateClockwise2,
	IconShieldLock,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Alert, Modal, ProgressBar } from "react-bootstrap";
import ReactMarkdown from "react-markdown";
import {
	getUpdateManager,
	restartManagedInstance,
	rollbackManagedUpdate,
	startManagedUpdate,
} from "src/api/backend";
import { Button, Loading } from "src/components";
import styles from "./Update.module.css";

const ACTIVE_STATES = new Set([
	"preflight",
	"pulling",
	"staging",
	"restarting",
	"verifying",
	"rolling_back",
]);

const UPDATE_PROGRESS: Record<string, number> = {
	idle: 0,
	preflight: 12,
	pulling: 35,
	staging: 55,
	restarting: 72,
	verifying: 90,
	completed: 100,
	rolling_back: 78,
	rolled_back: 100,
	failed: 100,
};

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
			return "Downloading image";
		case "staging":
			return "Preparing replacement";
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

type AuthAction = "update" | "rollback" | "restart";

export default function Update() {
	const initialStatusLoad = useRef(true);
	const {
		data,
		isLoading,
		error,
		refetch,
	} = useQuery({
		queryKey: ["update-manager"],
		queryFn: async () => {
			const clearFailed = initialStatusLoad.current;
			const result = await getUpdateManager(false, clearFailed);
			initialStatusLoad.current = false;
			return result;
		},
		refetchInterval: 3000,
		retry: true,
	});

	const [password, setPassword] = useState("");
	const [actionError, setActionError] = useState("");
	const [checking, setChecking] = useState(false);
	const [runningAction, setRunningAction] = useState<AuthAction | null>(null);
	const [authAction, setAuthAction] = useState<AuthAction | null>(null);

	const active = ACTIVE_STATES.has(data?.status?.state || "");
	const updateAvailable = Boolean(data?.release?.updateAvailable);
	const updaterReady = Boolean(data?.capabilities?.enabled);
	const rolling = Boolean(data?.coordination?.instanceSyncEnabled);
	const canRollback = Boolean(data?.status?.previousImage);
	const progress = UPDATE_PROGRESS[data?.status?.state || "idle"] ?? 0;

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

	const openAuth = (action: AuthAction) => {
		setPassword("");
		setActionError("");
		setAuthAction(action);
	};

	const closeAuth = () => {
		if (runningAction) return;
		setPassword("");
		setAuthAction(null);
	};

	const actionTitle =
		authAction === "update"
			? `Update to ${data?.release?.latest || "latest"}`
			: authAction === "rollback"
				? `Roll back to ${data?.status?.previousVersion || "previous version"}`
				: "Restart NPM Improved";

	const actionDescription =
		authAction === "update"
			? "NPM Improved will update this node, verify health, and automatically roll back on failure. Upgrade the other NPMX node separately once this node is healthy."
			: authAction === "rollback"
				? "NPM Improved will restore the previously recorded application image and verify that it becomes healthy."
				: "NPM Improved will restart the application container and verify that it returns healthy.";

	const runAuthenticatedAction = async () => {
		if (!authAction || !password) return;

		const action = authAction;
		const fn =
			action === "update"
				? startManagedUpdate
				: action === "rollback"
					? rollbackManagedUpdate
					: restartManagedInstance;

		setRunningAction(action);
		setActionError("");
		try {
			await fn(password);
			setPassword("");
			setAuthAction(null);
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
						Install stable NPM Improved releases without leaving the Control Center.
					</p>
				</div>
				<Button onClick={checkNow} isLoading={checking} disabled={checking || active}>
					<IconRefresh size={16} />
					Check again
				</Button>
			</div>

			{error ? <Alert variant="danger">{error.message}</Alert> : null}
			{actionError ? <Alert variant="danger">{actionError}</Alert> : null}

			<div className="card mb-4">
				<div className="card-body">
					<div className="d-flex flex-column flex-lg-row gap-4 align-items-lg-center justify-content-between">
						<div className="flex-fill">
							<div className="d-flex flex-wrap gap-2 align-items-center mb-2">
								<span className="fw-bold">Software update</span>
								{active ? (
									<span className="badge bg-azure-lt text-azure">{statusLabel(data?.status?.state)}</span>
								) : updateAvailable ? (
									<span className="badge bg-warning-lt text-warning">Update available</span>
								) : (
									<span className="badge bg-success-lt text-success">
										<IconCheck size={14} className="me-1" />
										Up to date
									</span>
								)}
							</div>

							<div className="d-flex flex-wrap align-items-center gap-2 mb-2">
								<code>{data?.release?.current || "Unknown"}</code>
								<span className="text-secondary">→</span>
								<code>{data?.release?.latest || "Unavailable"}</code>
							</div>

							<div className="text-secondary">
								{updateAvailable
									? `${data?.release?.releaseName || data?.release?.latest} is ready to install.`
									: "This installation matches the latest stable NPM Improved release."}
							</div>

							{published ? (
								<div className="text-secondary small mt-1">Latest release published {published}</div>
							) : null}
						</div>

						<div className="d-grid gap-2" style={{ minWidth: "13rem" }}>
							<Button
								actionType="primary"
								onClick={() => openAuth("update")}
								disabled={!updaterReady || !updateAvailable || active || runningAction !== null}
							>
								<IconDownload size={18} />
								Update to {data?.release?.latest || "latest"}
							</Button>
							<div className="text-secondary small text-center">
								Admin password required.
							</div>
						</div>
					</div>
				</div>
			</div>

			{rolling ? (
				<Alert variant="info">
					<strong>Rolling NPMX update — {data?.coordination?.role} node</strong>
					<div className="mt-1">
						Upgrade one proxy node at a time, verifying health before upgrading the other.
						NPMX snapshot synchronization temporarily pauses while node versions differ,
						then resumes once both nodes match. The other proxy can continue serving traffic.
					</div>
				</Alert>
			) : null}
			{!updaterReady ? (
				<Alert variant="warning">
					<strong>Automatic updates are not ready on this deployment.</strong>
					<div className="mt-1">
						{data?.capabilities?.reason ||
							"Run the current NPM Improved Docker installer once to enable native host-based updates."}
					</div>
				</Alert>
			) : null}

			{updaterReady ? (
				<div className="alert alert-info">
					<strong>Native host updater: {data?.capabilities?.hostUpdaterVersion || "unknown"}</strong>
					<div className="mt-1">
						{data?.capabilities?.hostUpdaterAutomaticMaintenance
							? "Automatic host updater maintenance is enabled. Future releases upgrade both the application and its native updater without a secondary container."
							: "Legacy host updater detected. Install the managed native host updater package once to enable automatic maintenance."}
					</div>
					{data?.capabilities?.hostUpdaterMaintenanceError ? (
						<div className="mt-1 text-warning">
							Last host-updater maintenance attempt: {data.capabilities.hostUpdaterMaintenanceError}.
							The native host timer will retry.
						</div>
					) : null}
				</div>
			) : null}
			{data?.status?.error ? (
				<Alert variant="danger">
					<div className="d-flex gap-2 align-items-start">
						<IconAlertTriangle size={20} className="mt-1 flex-shrink-0" />
						<div>
							<strong>Last update attempt failed.</strong>
							<div className="mt-1" style={{ whiteSpace: "pre-wrap" }}>
								{data.status.error}
							</div>
						</div>
					</div>
				</Alert>
			) : null}

			<div className="card mb-4">
				<div className="card-header d-flex align-items-center justify-content-between" aria-live="polite">
					<div>
						<h3 className="card-title mb-0">Update status</h3>
						<div className="text-secondary small">
							{data?.status?.message || "No update operation has been run yet."}
						</div>
					</div>
					<span className={`badge ${badgeClass(data?.status?.state)}`}>
						{statusLabel(data?.status?.state)}
					</span>
				</div>
				<div className="card-body">
					<ProgressBar
						now={progress}
						variant={data?.status?.state === "failed" ? "danger" : "primary"}
						animated={active}
						style={{ height: "0.65rem" }}
					/>

					<div className="row g-3 mt-2">
						<div className="col-sm-6 col-lg-3">
							<div className="text-secondary small">From</div>
							<div className="fw-bold">
								{data?.status?.sourceVersion || data?.release?.current || "Unknown"}
							</div>
						</div>
						<div className="col-sm-6 col-lg-3">
							<div className="text-secondary small">Target</div>
							<div className="fw-bold">{data?.status?.targetVersion || "—"}</div>
						</div>
						<div className="col-sm-6 col-lg-3">
							<div className="text-secondary small">Started</div>
							<div>
								{data?.status?.startedAt
									? new Date(data.status.startedAt).toLocaleString()
									: "—"}
							</div>
						</div>
						<div className="col-sm-6 col-lg-3">
							<div className="text-secondary small">Completed</div>
							<div>
								{data?.status?.completedAt
									? new Date(data.status.completedAt).toLocaleString()
									: "—"}
							</div>
						</div>
					</div>

					{data?.status?.targetDigest ? (
						<div className="mt-3">
							<div className="text-secondary small">Image digest</div>
							<code className="text-break">{data.status.targetDigest}</code>
						</div>
					) : null}

					{active ? (
						<Alert variant="info" className="mt-3 mb-0">
							The Control Center may disconnect briefly while the application container is replaced.
							This page will reconnect automatically when NPM Improved returns.
						</Alert>
					) : null}
				</div>
			</div>

			<div className="card mb-4">
				<div className="card-header">
					<h3 className="card-title">Release notes</h3>
				</div>
				<div className="card-body">
					<h4 className="mb-1">
						{data?.release?.releaseName || data?.release?.latest || "No release metadata available"}
					</h4>
					{published ? <div className="text-secondary mb-3">Published {published}</div> : null}
					{data?.release?.releaseNotes ? (
						<div className={styles.releaseNotes}>
							<ReactMarkdown>{data.release.releaseNotes}</ReactMarkdown>
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
					<div>
						<h3 className="card-title mb-0">Maintenance & recovery</h3>
						<div className="text-secondary small">
							These are secondary lifecycle controls, separate from the normal update path.
						</div>
					</div>
				</div>
				<div className="card-body">
					<div className="d-flex flex-wrap gap-2">
						<Button
							onClick={() => openAuth("restart")}
							disabled={!updaterReady || active || runningAction !== null}
						>
							<IconRotateClockwise2 size={16} />
							Restart NPM Improved
						</Button>
						<Button
							actionType="danger"
							onClick={() => openAuth("rollback")}
							disabled={!updaterReady || !canRollback || active || runningAction !== null}
						>
							<IconHistory size={16} />
							Roll back to {data?.status?.previousVersion || "previous version"}
						</Button>
					</div>
					<div className="text-secondary small mt-3">
						No permanent update-worker container is used. Lifecycle actions create only a temporary,
						self-cleaning handoff while the application container is being replaced or restarted.
					</div>
				</div>
			</div>

			<Modal show={authAction !== null} onHide={closeAuth} centered>
				<Modal.Header closeButton={!runningAction}>
					<Modal.Title>{actionTitle}</Modal.Title>
				</Modal.Header>
				<Modal.Body>
					<div className="d-flex gap-2 mb-3">
						<IconShieldLock size={22} className="text-primary flex-shrink-0 mt-1" />
						<div>
							<div className="fw-bold">Confirm with your administrator password</div>
							<div className="text-secondary small">{actionDescription}</div>
						</div>
					</div>

					{actionError ? <Alert variant="danger">{actionError}</Alert> : null}

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
						onKeyDown={(event) => {
							if (event.key === "Enter" && password && !runningAction) {
								void runAuthenticatedAction();
							}
						}}
						disabled={Boolean(runningAction)}
					/>
					<div className="text-secondary small mt-2">
						The password is verified for this action and is not stored in update state.
					</div>
				</Modal.Body>
				<Modal.Footer>
					<Button onClick={closeAuth} disabled={Boolean(runningAction)}>
						Cancel
					</Button>
					<Button
						actionType={authAction === "rollback" ? "danger" : "primary"}
						onClick={() => void runAuthenticatedAction()}
						isLoading={runningAction === authAction}
						disabled={!password || Boolean(runningAction)}
					>
						{authAction === "update" ? <IconDownload size={16} /> : null}
						{authAction === "restart" ? <IconRotateClockwise2 size={16} /> : null}
						{authAction === "rollback" ? <IconHistory size={16} /> : null}
						{actionTitle}
					</Button>
				</Modal.Footer>
			</Modal>
		</div>
	);
}

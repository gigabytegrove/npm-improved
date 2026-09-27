import { IconDatabase, IconRefresh, IconServer2, IconSwitchHorizontal } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { Alert } from "react-bootstrap";
import {
	type DatabaseEngine,
	type DatabaseTarget,
	type DatabaseTestResult,
} from "src/api/backend";
import { Button, Loading } from "src/components";
import {
	useDatabaseStatus,
	useMigrateDatabase,
	useSetSharedDatabaseRole,
	useTestDatabase,
} from "src/hooks";

const waitForRestart = async () => {
	await new Promise((resolve) => setTimeout(resolve, 2200));
	for (let attempt = 0; attempt < 45; attempt += 1) {
		try {
			const response = await fetch("/api/", { cache: "no-store" });
			if (response.ok) {
				window.location.reload();
				return;
			}
		} catch {
			// The backend is expected to be unavailable briefly while s6 restarts it.
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
};

const formatDate = (value?: string | null) => {
	if (!value) return "Never";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export default function Database() {
	const { data: status, isLoading, error, refetch } = useDatabaseStatus();
	const testMutation = useTestDatabase();
	const migrateMutation = useMigrateDatabase();
	const roleMutation = useSetSharedDatabaseRole();

	const [engine, setEngine] = useState<DatabaseEngine>("mysql");
	const [sqliteFilename, setSqliteFilename] = useState("/data/database.sqlite");
	const [host, setHost] = useState("");
	const [port, setPort] = useState(3306);
	const [name, setName] = useState("npm");
	const [user, setUser] = useState("npm");
	const [password, setPassword] = useState("");
	const [sslEnabled, setSslEnabled] = useState(false);
	const [sslVerify, setSslVerify] = useState(true);
	const [shared, setShared] = useState(false);
	const [nodeRole, setNodeRole] = useState<"primary" | "secondary">("primary");
	const [nodeName, setNodeName] = useState("");
	const [publicUrl, setPublicUrl] = useState("");
	const [operation, setOperation] = useState<"migrate" | "connect">("migrate");
	const [confirmation, setConfirmation] = useState("");
	const [testResult, setTestResult] = useState<DatabaseTestResult | null>(null);
	const [message, setMessage] = useState("");
	const [actionError, setActionError] = useState("");
	const [initializedFromStatus, setInitializedFromStatus] = useState(false);
	const [promoteConfirmation, setPromoteConfirmation] = useState("");

	useEffect(() => {
		if (!status || initializedFromStatus) return;
		const current = status.current;
		if (current.engine === "mysql") {
			setEngine("mysql");
			setHost(current.host || "");
			setPort(current.port || 3306);
			setName(current.name || "npm");
			setUser(current.user || "npm");
			setSslEnabled(Boolean(current.ssl));
			setSslVerify(current.sslRejectUnauthorized !== false);
			setShared(Boolean(current.shared));
		} else {
			setSqliteFilename(current.filename || status.sqliteDefaultPath || "/data/database.sqlite");
		}
		if (status.sharedCluster?.nodeName) setNodeName(status.sharedCluster.nodeName);
		if (status.sharedCluster?.publicUrl) setPublicUrl(status.sharedCluster.publicUrl);
		if (status.sharedCluster?.role) setNodeRole(status.sharedCluster.role);
		setInitializedFromStatus(true);
	}, [initializedFromStatus, status]);

	const target = useMemo<DatabaseTarget>(() => {
		if (engine === "sqlite") {
			return {
				engine: "sqlite",
				filename: sqliteFilename.trim() || "/data/database.sqlite",
			};
		}
		return {
			engine: "mysql",
			host: host.trim(),
			port,
			name: name.trim(),
			user: user.trim(),
			password,
			shared,
			ssl: {
				enabled: sslEnabled,
				rejectUnauthorized: sslVerify,
				verifyIdentity: sslVerify,
			},
		};
	}, [
		engine,
		host,
		name,
		password,
		port,
		shared,
		sqliteFilename,
		sslEnabled,
		sslVerify,
		user,
	]);

	if (isLoading) {
		return (
			<div className="card-body">
				<Loading noLogo />
			</div>
		);
	}

	if (error || !status) {
		return (
			<div className="card-body">
				<Alert variant="danger">{error?.message || "Could not load database status."}</Alert>
			</div>
		);
	}

	const resetValidation = () => {
		setTestResult(null);
		setConfirmation("");
		setMessage("");
		setActionError("");
	};

	const testConnection = async () => {
		resetValidation();
		try {
			setTestResult(await testMutation.mutateAsync(target));
		} catch (err) {
			setActionError(err instanceof Error ? err.message : String(err));
		}
	};

	const runMigration = async () => {
		setMessage("");
		setActionError("");
		try {
			const result = await migrateMutation.mutateAsync({
				target,
				operation,
				confirmation,
				nodeRole: shared ? nodeRole : undefined,
				nodeName: shared ? nodeName : undefined,
				publicUrl: shared ? publicUrl : undefined,
			});
			setMessage(result.message + " Reconnecting to the restarted backend…");
			void waitForRestart();
		} catch (err) {
			setActionError(err instanceof Error ? err.message : String(err));
		}
	};

	const expectedConfirmation = operation === "connect" ? "CONNECT" : "MIGRATE";
	const canRun =
		Boolean(testResult?.ok) &&
		confirmation === expectedConfirmation &&
		!migrateMutation.isPending &&
		(engine === "sqlite" || Boolean(host.trim() && name.trim() && user.trim()));

	const currentLabel =
		status.current.engine === "sqlite"
			? "SQLite"
			: status.current.engine === "mysql"
				? "MySQL / MariaDB"
				: status.current.engine;

	return (
		<div className="card-body">
			<div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-4">
				<div>
					<div className="d-flex align-items-center gap-2 mb-1">
						<IconDatabase size={24} />
						<h3 className="mb-0">Database &amp; Cluster</h3>
					</div>
					<p className="text-secondary mb-0">
						Move NPM Improved between SQLite and MySQL, or let several NPMi servers safely share one MySQL database.
					</p>
				</div>
				<Button onClick={() => refetch()}>
					<IconRefresh size={16} />
					Refresh
				</Button>
			</div>

			{message ? <Alert variant="success">{message}</Alert> : null}
			{actionError ? <Alert variant="danger">{actionError}</Alert> : null}
			{status.migrationInProgress ? (
				<Alert variant="warning">
					A database migration is in progress. Configuration writes are temporarily paused.
				</Alert>
			) : null}

			<div className="row g-3 mb-4">
				<div className="col-md-4">
					<div className="card h-100">
						<div className="card-body">
							<div className="text-secondary small mb-2">Current database</div>
							<div className="fs-3 fw-bold">{currentLabel}</div>
							<div className="text-secondary small mt-2">
								{status.current.engine === "sqlite"
									? status.current.filename
									: `${status.current.host}:${status.current.port}/${status.current.name}`}
							</div>
						</div>
					</div>
				</div>
				<div className="col-md-4">
					<div className="card h-100">
						<div className="card-body">
							<div className="text-secondary small mb-2">Configuration source</div>
							<div className="fw-bold">
								{status.source === "runtime" ? "Managed in NPM Improved" : status.source}
							</div>
							<div className="text-secondary small mt-2">
								UI-managed database selections are stored locally with restricted file permissions.
							</div>
						</div>
					</div>
				</div>
				<div className="col-md-4">
					<div className="card h-100">
						<div className="card-body">
							<div className="text-secondary small mb-2">Multi-server mode</div>
							<div className="fw-bold">
								{status.shared
									? `Shared MySQL · ${status.sharedCluster.role === "primary" ? "Primary" : "Secondary"}`
									: "Single server"}
							</div>
							<div className="text-secondary small mt-2">
								{status.shared
									? `Database revision ${status.sharedCluster.revision}`
									: "Enable Shared MySQL when you want multiple NPMi proxy nodes to use one database."}
							</div>
						</div>
					</div>
				</div>
			</div>

			{status.shared ? (
				<div className="card mb-4">
					<div className="card-header">
						<div>
							<h3 className="card-title mb-1">Shared MySQL cluster</h3>
							<div className="text-secondary small">
								All nodes read the same database. One Primary accepts configuration changes; Secondary nodes stay ready to serve traffic and mirror certificate/custom files automatically.
							</div>
						</div>
					</div>
					<div className="card-body">
						{status.sharedCluster.lastError ? (
							<Alert variant="danger">{status.sharedCluster.lastError}</Alert>
						) : null}
						<div className="row g-3 mb-3">
							<div className="col-md-4">
								<div className="text-secondary small">This node</div>
								<div className="fw-bold">{status.sharedCluster.nodeName}</div>
								<div className="small text-secondary">{status.sharedCluster.nodeId}</div>
							</div>
							<div className="col-md-4">
								<div className="text-secondary small">Primary lease</div>
								<div className="fw-bold">
									{status.sharedCluster.primaryHealthy ? "Healthy" : "Not currently healthy"}
								</div>
								<div className="small text-secondary">
									{status.sharedCluster.primaryNodeId || "No active primary"}
								</div>
							</div>
							<div className="col-md-4">
								<div className="text-secondary small">Last primary heartbeat</div>
								<div className="fw-bold">{formatDate(status.sharedCluster.primarySeenOn)}</div>
							</div>
						</div>

						<div className="table-responsive">
							<table className="table table-vcenter">
								<thead>
									<tr>
										<th>Node</th>
										<th>Role</th>
										<th>Version</th>
										<th>Applied revision</th>
										<th>Last seen</th>
										<th>Status</th>
									</tr>
								</thead>
								<tbody>
									{status.sharedCluster.nodes.map((node) => (
										<tr key={node.nodeId}>
											<td>
												<div className="fw-bold">
													{node.nodeName}
													{node.nodeId === status.sharedCluster.nodeId ? " (this node)" : ""}
												</div>
												<div className="small text-secondary">{node.publicUrl || node.nodeId}</div>
											</td>
											<td>{node.role === "primary" ? "Primary" : "Secondary"}</td>
											<td>{node.version || "Unknown"}</td>
											<td>{node.lastAppliedRevision}</td>
											<td>{formatDate(node.lastSeen)}</td>
											<td>
												{node.lastError ? (
													<span className="text-danger">{node.lastError}</span>
												) : (
													<span className="text-success">Healthy</span>
												)}
											</td>
										</tr>
									))}
									{status.sharedCluster.nodes.length === 0 ? (
										<tr>
											<td colSpan={6} className="text-center text-secondary py-4">
												No cluster node heartbeats have been recorded yet.
											</td>
										</tr>
									) : null}
								</tbody>
							</table>
						</div>

						{status.sharedCluster.role === "secondary" ? (
							<div className="mt-4">
								<Alert variant="warning">
									Promote this node only when the old Primary is offline or intentionally removed. NPMi uses a Primary lease to prevent two servers from accepting conflicting changes.
								</Alert>
								<label className="form-label" htmlFor="shared-promote-confirm">
									Type <strong>PROMOTE</strong> to force failover if the previous Primary still owns the lease
								</label>
								<div className="d-flex gap-2 flex-wrap">
									<input
										id="shared-promote-confirm"
										className="form-control"
										style={{ maxWidth: 260 }}
										value={promoteConfirmation}
										onChange={(event) => setPromoteConfirmation(event.target.value)}
									/>
									<Button
										actionType="danger"
										isLoading={roleMutation.isPending}
										onClick={async () => {
											setActionError("");
											try {
												await roleMutation.mutateAsync({
													role: "primary",
													force: promoteConfirmation === "PROMOTE",
													confirmation: promoteConfirmation,
												});
												setPromoteConfirmation("");
												await refetch();
											} catch (err) {
												setActionError(err instanceof Error ? err.message : String(err));
											}
										}}
									>
										Promote this node
									</Button>
								</div>
							</div>
						) : null}
					</div>
				</div>
			) : null}

			<div className="card">
				<div className="card-header">
					<div>
						<h3 className="card-title mb-1">Database setup wizard</h3>
						<div className="text-secondary small">
							Test the destination first. NPMi does not switch databases until the copy is complete and verified.
						</div>
					</div>
				</div>
				<div className="card-body">
					<div className="mb-4">
						<label className="form-label" htmlFor="database-engine">
							Where should NPM Improved store its data?
						</label>
						<select
							id="database-engine"
							className="form-select"
							value={engine}
							onChange={(event) => {
								const next = event.target.value as DatabaseEngine;
								setEngine(next);
								if (next === "sqlite") {
									setShared(false);
									setOperation("migrate");
								}
								resetValidation();
							}}
						>
							<option value="sqlite">SQLite — simple, local, single-server database</option>
							<option value="mysql">MySQL / MariaDB — external database and multi-server support</option>
						</select>
					</div>

					{engine === "sqlite" ? (
						<div className="mb-4">
							<label className="form-label" htmlFor="sqlite-filename">
								SQLite database file
							</label>
							<input
								id="sqlite-filename"
								className="form-control"
								value={sqliteFilename}
								onChange={(event) => {
									setSqliteFilename(event.target.value);
									resetValidation();
								}}
							/>
							<div className="text-secondary small mt-1">
								Use SQLite for a straightforward single-server installation. Migrating back to SQLite creates the new file first, verifies it, then switches NPMi to it.
							</div>
						</div>
					) : (
						<>
							<div className="row g-3">
								<div className="col-md-6">
									<label className="form-label" htmlFor="mysql-host">MySQL / MariaDB server</label>
									<input
										id="mysql-host"
										className="form-control"
										value={host}
										onChange={(event) => {
											setHost(event.target.value);
											resetValidation();
										}}
										placeholder="mysql.example.net or 10.0.0.20"
									/>
								</div>
								<div className="col-md-2">
									<label className="form-label" htmlFor="mysql-port">Port</label>
									<input
										id="mysql-port"
										type="number"
										min={1}
										max={65535}
										className="form-control"
										value={port}
										onChange={(event) => {
											setPort(Number(event.target.value) || 3306);
											resetValidation();
										}}
									/>
								</div>
								<div className="col-md-4">
									<label className="form-label" htmlFor="mysql-name">Database name</label>
									<input
										id="mysql-name"
										className="form-control"
										value={name}
										onChange={(event) => {
											setName(event.target.value);
											resetValidation();
										}}
									/>
								</div>
								<div className="col-md-6">
									<label className="form-label" htmlFor="mysql-user">Database user</label>
									<input
										id="mysql-user"
										className="form-control"
										value={user}
										onChange={(event) => {
											setUser(event.target.value);
											resetValidation();
										}}
									/>
								</div>
								<div className="col-md-6">
									<label className="form-label" htmlFor="mysql-password">Database password</label>
									<input
										id="mysql-password"
										type="password"
										autoComplete="new-password"
										className="form-control"
										value={password}
										onChange={(event) => {
											setPassword(event.target.value);
											resetValidation();
										}}
										placeholder={
											status.current.engine === "mysql"
												? "Leave blank to keep the current password when using the same database"
												: ""
										}
									/>
								</div>
							</div>

							<div className="mt-3">
								<label className="row" htmlFor="mysql-tls">
									<span className="col">
										<strong>Use TLS for the database connection</strong>
										<div className="text-secondary small">
											Recommended whenever MySQL is not on the same private host/network.
										</div>
									</span>
									<span className="col-auto">
										<input
											id="mysql-tls"
											type="checkbox"
											className="form-check-input"
											checked={sslEnabled}
											onChange={(event) => {
												setSslEnabled(event.target.checked);
												resetValidation();
											}}
										/>
									</span>
								</label>
							</div>
							{sslEnabled ? (
								<div className="mt-2">
									<label className="row" htmlFor="mysql-tls-verify">
										<span className="col">
											<strong>Verify the database certificate</strong>
											<div className="text-secondary small">
												Keep this enabled unless you deliberately use a private/self-signed database certificate.
											</div>
										</span>
										<span className="col-auto">
											<input
												id="mysql-tls-verify"
												type="checkbox"
												className="form-check-input"
												checked={sslVerify}
												onChange={(event) => {
													setSslVerify(event.target.checked);
													resetValidation();
												}}
											/>
										</span>
									</label>
								</div>
							) : null}

							<hr className="my-4" />

							<label className="row" htmlFor="mysql-shared">
								<span className="col">
									<strong>Use this MySQL database with multiple NPM Improved servers</strong>
									<div className="text-secondary small">
										Shared MySQL mode gives several NPMi nodes one source of truth. One Primary accepts changes; Secondary nodes are read-only and automatically rebuild their local Nginx/certificate state from the shared database.
									</div>
								</span>
								<span className="col-auto">
									<input
										id="mysql-shared"
										type="checkbox"
										className="form-check-input"
										checked={shared}
										onChange={(event) => {
											setShared(event.target.checked);
											if (!event.target.checked) {
												setOperation("migrate");
												setNodeRole("primary");
											}
											resetValidation();
										}}
									/>
								</span>
							</label>

							{shared ? (
								<div className="mt-3 p-3 border rounded">
									<div className="row g-3">
										<div className="col-md-4">
											<label className="form-label" htmlFor="shared-node-name">This server's name</label>
											<input
												id="shared-node-name"
												className="form-control"
												value={nodeName}
												onChange={(event) => setNodeName(event.target.value)}
												placeholder="npmi-1"
											/>
										</div>
										<div className="col-md-4">
											<label className="form-label" htmlFor="shared-node-role">This server's role</label>
											<select
												id="shared-node-role"
												className="form-select"
												value={nodeRole}
												onChange={(event) => setNodeRole(event.target.value as "primary" | "secondary")}
											>
												<option value="primary">Primary — accepts configuration changes</option>
												<option value="secondary">Secondary — read-only failover node</option>
											</select>
										</div>
										<div className="col-md-4">
											<label className="form-label" htmlFor="shared-public-url">Management URL (optional)</label>
											<input
												id="shared-public-url"
												type="url"
												className="form-control"
												value={publicUrl}
												onChange={(event) => setPublicUrl(event.target.value)}
												placeholder="https://npmi-1.example.com"
											/>
										</div>
									</div>
								</div>
							) : null}
						</>
					)}

					<div className="mt-4">
						<label className="form-label" htmlFor="database-operation">
							What should NPM Improved do?
						</label>
						<select
							id="database-operation"
							className="form-select"
							value={operation}
							onChange={(event) => {
								setOperation(event.target.value as "migrate" | "connect");
								resetValidation();
							}}
						>
							<option value="migrate">Move this server's current NPMi data to the selected database</option>
							{engine === "mysql" && shared ? (
								<option value="connect">Join an existing NPM Improved shared database without replacing its data</option>
							) : null}
						</select>
						<div className="text-secondary small mt-1">
							{operation === "migrate"
								? "The source database stays untouched. NPMi copies the data, verifies row counts, saves the new connection, and restarts only the backend."
								: "Use this on additional NPMi servers after the Primary already created the shared database."}
						</div>
					</div>

					<div className="d-flex flex-wrap gap-2 mt-4">
						<Button
							onClick={testConnection}
							isLoading={testMutation.isPending}
							disabled={testMutation.isPending}
						>
							Test database connection
						</Button>
					</div>

					{testResult ? (
						<Alert
							variant={
								operation === "connect" && (!testResult.hasNPMiData || !testResult.schemaCurrent)
									? "warning"
									: "success"
							}
							className="mt-3"
						>
							<div className="fw-bold">Connection successful.</div>
							<div className="small mt-1">
								{testResult.hasNPMiSchema
									? `NPM Improved schema detected${testResult.hasNPMiData ? ` with ${testResult.userCount} user record(s)` : ""}.`
									: "The database is reachable and does not yet contain an NPM Improved schema."}
							</div>
							{testResult.hasNPMiSchema ? (
								<div className="small">
									Schema: {testResult.schemaCurrent ? "current for this build" : `not current (found ${testResult.latestMigration || "unknown"})`}
								</div>
							) : null}
						</Alert>
					) : null}

					{testResult ? (
						<div className="mt-4">
							<Alert variant={operation === "connect" ? "info" : "warning"}>
								{operation === "connect"
									? "Joining does not copy this server's existing SQLite/MySQL records into the shared database. After restart, this node will use the shared records and synchronize its local certificate/custom files."
									: "Migration replaces the NPM Improved application records in the destination database inside a database transaction. The currently active source database is not deleted."}
							</Alert>
							<label className="form-label" htmlFor="database-confirmation">
								Type <strong>{expectedConfirmation}</strong> to continue
							</label>
							<input
								id="database-confirmation"
								className="form-control"
								value={confirmation}
								onChange={(event) => setConfirmation(event.target.value)}
								autoComplete="off"
							/>
							<div className="btn-list justify-content-end mt-3">
								<Button
									actionType={operation === "connect" ? "primary" : "danger"}
									onClick={runMigration}
									isLoading={migrateMutation.isPending}
									disabled={!canRun}
								>
									<IconSwitchHorizontal size={16} />
									{operation === "connect" ? "Join shared database" : "Migrate and switch database"}
								</Button>
							</div>
						</div>
					) : null}
				</div>
			</div>

			<div className="card mt-4">
				<div className="card-body">
					<div className="d-flex gap-3 align-items-start">
						<IconServer2 size={26} className="text-primary flex-shrink-0" />
						<div>
							<h4 className="mb-1">How Shared MySQL works</h4>
							<p className="text-secondary mb-2">
								The MySQL/MariaDB database becomes the common source of truth for hosts, users, certificates, settings, history, and access rules. Each NPMi server still runs its own Nginx process.
							</p>
							<p className="text-secondary mb-0">
								The Primary publishes certificate files, Let's Encrypt state, and custom Nginx/default-site files into the shared database. Secondary nodes automatically apply those files and regenerate their local Nginx configuration when the shared revision changes. The MySQL service itself is a shared dependency, so use a redundant MySQL/MariaDB service if database-level high availability is required.
							</p>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

import {
	IconArrowsExchange,
	IconCheck,
	IconDatabase,
	IconRefresh,
	IconServer,
	IconShieldLock,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Alert, Badge } from "react-bootstrap";
import {
	type DatabaseTarget,
	type DatabaseTestResult,
} from "src/api/backend";
import { Button, Loading } from "src/components";
import {
	useDatabaseStatus,
	useJoinDatabase,
	useMigrateDatabase,
	useResetDatabaseSelection,
	useTestDatabase,
} from "src/hooks";

type WizardMode = "move-mysql" | "join-mysql" | "move-sqlite";

const waitForBackend = async () => {
	const started = Date.now();
	while (Date.now() - started < 45_000) {
		try {
			const response = await fetch("/api/", { cache: "no-store" });
			if (response.ok) {
				window.location.reload();
				return;
			}
		} catch {
			// Backend is expected to disappear briefly while it restarts.
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	window.location.reload();
};

export default function Database() {
	const { data: status, isLoading, error } = useDatabaseStatus();
	const testMutation = useTestDatabase();
	const migrateMutation = useMigrateDatabase();
	const joinMutation = useJoinDatabase();
	const resetMutation = useResetDatabaseSelection();

	const [mode, setMode] = useState<WizardMode>("move-mysql");
	const [host, setHost] = useState("");
	const [port, setPort] = useState("3306");
	const [name, setName] = useState("npm");
	const [user, setUser] = useState("npm");
	const [password, setPassword] = useState("");
	const [ssl, setSsl] = useState(false);
	const [shared, setShared] = useState(true);
	const [sqliteFilename, setSqliteFilename] = useState("/data/database.sqlite");
	const [replaceTarget, setReplaceTarget] = useState(false);
	const [confirmation, setConfirmation] = useState("");
	const [testResult, setTestResult] = useState<DatabaseTestResult | null>(null);
	const [message, setMessage] = useState("");
	const [actionError, setActionError] = useState("");

	const target = useMemo<DatabaseTarget>(() => {
		if (mode === "move-sqlite") {
			return {
				engine: "sqlite",
				sqlite: { filename: sqliteFilename },
				replaceTarget,
			};
		}
		return {
			engine: "mysql",
			shared,
			mysql: {
				host,
				port: Number.parseInt(port || "3306", 10),
				user,
				password,
				name,
				ssl,
				sslRejectUnauthorized: true,
				sslVerifyIdentity: true,
			},
			replaceTarget,
		};
	}, [mode, sqliteFilename, replaceTarget, shared, host, port, user, password, name, ssl]);

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

	const resetFeedback = () => {
		setMessage("");
		setActionError("");
		setTestResult(null);
		setConfirmation("");
	};

	const test = async () => {
		resetFeedback();
		try {
			setTestResult(await testMutation.mutateAsync(target));
		} catch (err) {
			setActionError(err instanceof Error ? err.message : String(err));
		}
	};

	const runSwitch = async () => {
		setMessage("");
		setActionError("");
		try {
			if (mode === "join-mysql") {
				const result = await joinMutation.mutateAsync({
					...target,
					confirmation: "CONNECT",
				});
				setMessage(result.message);
			} else {
				const result = await migrateMutation.mutateAsync({
					...target,
					confirmation,
				});
				setMessage(result.message);
			}
			await waitForBackend();
		} catch (err) {
			setActionError(err instanceof Error ? err.message : String(err));
		}
	};

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
						<h3 className="mb-0">Database &amp; Storage</h3>
					</div>
					<p className="text-secondary mb-0">
						Move between SQLite and MySQL, or connect several NPM Improved servers to one shared MySQL database.
					</p>
				</div>
				<div className="d-flex gap-2">
					<Badge bg="primary">{currentLabel}</Badge>
					{status.mysqlSharedMode ? <Badge bg="success">Shared database mode</Badge> : null}
				</div>
			</div>

			{message ? <Alert variant="success">{message}</Alert> : null}
			{actionError ? <Alert variant="danger">{actionError}</Alert> : null}

			<div className="row g-3 mb-4">
				<div className="col-md-4">
					<div className="card h-100">
						<div className="card-body">
							<div className="text-secondary small mb-2">Active database</div>
							<div className="fw-bold">{currentLabel}</div>
							<div className="small text-secondary mt-1">
								{status.current.engine === "sqlite"
									? status.current.filename || "/data/database.sqlite"
									: status.current.host
										? `${status.current.user}@${status.current.host}:${status.current.port}/${status.current.name}`
										: "Configured by deployment"}
							</div>
						</div>
					</div>
				</div>
				<div className="col-md-4">
					<div className="card h-100">
						<div className="card-body">
							<div className="text-secondary small mb-2">Configuration source</div>
							<div className="fw-bold text-capitalize">{status.current.source.replace("-", " ")}</div>
							<div className="small text-secondary mt-1">
								{status.runtimeConfigPresent
									? "Managed by the NPM Improved database wizard."
									: "Managed by your deployment environment."}
							</div>
						</div>
					</div>
				</div>
				<div className="col-md-4">
					<div className="card h-100">
						<div className="card-body">
							<div className="text-secondary small mb-2">Multi-server use</div>
							<div className="fw-bold">{status.mysqlSharedMode ? "Enabled" : "Not enabled"}</div>
							<div className="small text-secondary mt-1">
								Shared mode is available when NPMi runs on MySQL/MariaDB.
							</div>
						</div>
					</div>
				</div>
			</div>

			{status.mysqlSharedMode ? (
				<>
					<Alert variant="info">
						<div className="fw-bold mb-1">This node is using Shared MySQL mode.</div>
						Database changes are common to every NPMi node using this database. Each node watches for changes and regenerates its own Nginx configuration. JWT signing identity is also coordinated through the shared database so users can move between nodes without being logged out.
					</Alert>
					<div className="card mb-4">
						<div className="card-header">
							<div>
								<h3 className="card-title mb-1">Shared database nodes</h3>
								<div className="text-secondary small">
									Nodes appear here after they check in to this MySQL database.
								</div>
							</div>
						</div>
						<div className="table-responsive">
							<table className="table table-vcenter card-table">
								<thead>
									<tr>
										<th>Node</th>
										<th>Version</th>
										<th>Last seen</th>
									</tr>
								</thead>
								<tbody>
									{status.sharedNodes.length ? (
										status.sharedNodes.map((node) => (
											<tr key={node.id}>
												<td>
													<div className="fw-bold">{node.name}</div>
													<div className="small text-secondary">{node.id}</div>
												</td>
												<td>{node.version}</td>
												<td>{node.lastSeen ? new Date(node.lastSeen).toLocaleString() : "Unknown"}</td>
											</tr>
										))
									) : (
										<tr>
											<td colSpan={3} className="text-center text-secondary py-4">
												No shared-database node heartbeat has been recorded yet.
											</td>
										</tr>
									)}
								</tbody>
							</table>
						</div>
					</div>
				</>
			) : null}

			<div className="card mb-4">
				<div className="card-header">
					<div>
						<h3 className="card-title mb-1">Database setup wizard</h3>
						<div className="text-secondary small">
							Choose what you want to do. NPM Improved will test the destination before making any change.
						</div>
					</div>
				</div>
				<div className="card-body">
					<div className="row g-3 mb-4">
						<div className="col-md-4">
							<button
								type="button"
								className={`card h-100 w-100 text-start p-3 ${mode === "move-mysql" ? "border-primary" : ""}`}
								onClick={() => {
									setMode("move-mysql");
									resetFeedback();
								}}
							>
								<IconArrowsExchange size={22} className="mb-2 text-primary" />
								<strong>Move this installation to MySQL</strong>
								<span className="small text-secondary mt-1">
									Copies your current NPMi data to MySQL/MariaDB, verifies it, then switches the backend.
								</span>
							</button>
						</div>
						<div className="col-md-4">
							<button
								type="button"
								className={`card h-100 w-100 text-start p-3 ${mode === "join-mysql" ? "border-primary" : ""}`}
								onClick={() => {
									setMode("join-mysql");
									setShared(true);
									resetFeedback();
								}}
							>
								<IconServer size={22} className="mb-2 text-primary" />
								<strong>Join an existing shared MySQL database</strong>
								<span className="small text-secondary mt-1">
									Use this when another NPMi server already owns the database and this node should join it.
								</span>
							</button>
						</div>
						<div className="col-md-4">
							<button
								type="button"
								className={`card h-100 w-100 text-start p-3 ${mode === "move-sqlite" ? "border-primary" : ""}`}
								onClick={() => {
									setMode("move-sqlite");
									resetFeedback();
								}}
							>
								<IconDatabase size={22} className="mb-2 text-primary" />
								<strong>Move back to SQLite</strong>
								<span className="small text-secondary mt-1">
									Copies the active database into a local SQLite file and switches this node back.
								</span>
							</button>
						</div>
					</div>

					{mode === "move-sqlite" ? (
						<>
							<label className="form-label" htmlFor="database-sqlite-file">
								SQLite file
							</label>
							<input
								id="database-sqlite-file"
								className="form-control"
								value={sqliteFilename}
								onChange={(event) => {
									setSqliteFilename(event.target.value);
									setTestResult(null);
								}}
							/>
							<div className="text-secondary small mt-1">
								The wizard only manages SQLite files under <code>/data</code> so they stay on persistent storage.
							</div>
						</>
					) : (
						<>
							<div className="row g-3">
								<div className="col-md-8">
									<label className="form-label" htmlFor="database-host">MySQL / MariaDB host</label>
									<input
										id="database-host"
										className="form-control"
										value={host}
										onChange={(event) => {
											setHost(event.target.value);
											setTestResult(null);
										}}
										placeholder="mysql.example.lan"
									/>
								</div>
								<div className="col-md-4">
									<label className="form-label" htmlFor="database-port">Port</label>
									<input
										id="database-port"
										className="form-control"
										type="number"
										min={1}
										max={65535}
										value={port}
										onChange={(event) => {
											setPort(event.target.value);
											setTestResult(null);
										}}
									/>
								</div>
								<div className="col-md-6">
									<label className="form-label" htmlFor="database-name">Database name</label>
									<input
										id="database-name"
										className="form-control"
										value={name}
										onChange={(event) => {
											setName(event.target.value);
											setTestResult(null);
										}}
									/>
								</div>
								<div className="col-md-6">
									<label className="form-label" htmlFor="database-user">Database user</label>
									<input
										id="database-user"
										className="form-control"
										value={user}
										onChange={(event) => {
											setUser(event.target.value);
											setTestResult(null);
										}}
									/>
								</div>
								<div className="col-12">
									<label className="form-label" htmlFor="database-password">Database password</label>
									<input
										id="database-password"
										type="password"
										autoComplete="new-password"
										className="form-control"
										value={password}
										onChange={(event) => {
											setPassword(event.target.value);
											setTestResult(null);
										}}
									/>
								</div>
							</div>

							<div className="mt-3 d-flex flex-column gap-3">
								<label className="form-check form-switch">
									<input
										type="checkbox"
										className="form-check-input"
										checked={ssl}
										onChange={(event) => {
											setSsl(event.target.checked);
											setTestResult(null);
										}}
									/>
									<span className="form-check-label">
										Use TLS/SSL for the database connection
									</span>
								</label>
								<label className="form-check form-switch">
									<input
										type="checkbox"
										className="form-check-input"
										checked={shared}
										disabled={mode === "join-mysql"}
										onChange={(event) => setShared(event.target.checked)}
									/>
									<span className="form-check-label">
										<strong>Shared MySQL mode</strong>
										<span className="d-block small text-secondary">
											Enable this when two or more NPM Improved servers will use this same database.
										</span>
									</span>
								</label>
							</div>
						</>
					)}

					{shared && mode !== "move-sqlite" ? (
						<Alert variant="warning" className="mt-4">
							<div className="fw-bold mb-2">Shared MySQL also needs shared certificate files.</div>
							<p className="mb-2">
								The database contains the configuration, but Let's Encrypt and custom certificate files still live on disk. Every NPMi node must be able to see the same certificate material.
							</p>
							<ul className="mb-0">
								<li>Share or replicate <code>/etc/letsencrypt</code> between nodes.</li>
								<li>Share or replicate <code>/data/custom_ssl</code> between nodes.</li>
								<li>Run the same NPM Improved version on every node.</li>
							</ul>
						</Alert>
					) : null}

					<div className="d-flex flex-wrap gap-2 mt-4">
						<Button
							type="button"
							onClick={test}
							isLoading={testMutation.isPending}
							disabled={
								testMutation.isPending ||
								(mode !== "move-sqlite" && (!host.trim() || !user.trim() || !name.trim()))
							}
						>
							Test connection
						</Button>
					</div>

					{testResult ? (
						<Alert variant="success" className="mt-3 mb-0">
							<div className="d-flex align-items-center gap-2 fw-bold">
								<IconCheck size={18} />
								Connection successful
							</div>
							<div className="small mt-2">
								{testResult.npmSchema
									? `NPM Improved schema detected · ${testResult.rowCount} existing data rows · migration ${testResult.migration}${testResult.sharedVersion ? ` · shared cluster ${testResult.sharedVersion}` : ""}`
									: "Database is reachable and does not currently contain an NPM Improved schema."}
							</div>
						</Alert>
					) : null}
				</div>
			</div>

			{testResult ? (
				<div className="card mb-4">
					<div className="card-header">
						<h3 className="card-title">Review &amp; switch</h3>
					</div>
					<div className="card-body">
						{mode === "join-mysql" ? (
							<>
								<Alert variant={testResult.npmSchema && testResult.rowCount > 0 ? "info" : "warning"}>
									Join mode never overwrites the target database. It simply verifies an existing NPM Improved database, saves the connection locally, and restarts this node against it.
								</Alert>
								<Button
									actionType="primary"
									onClick={runSwitch}
									isLoading={joinMutation.isPending}
									disabled={!testResult.npmSchema || testResult.rowCount < 1}
								>
									<IconServer size={17} />
									Join this database
								</Button>
							</>
						) : (
							<>
								{testResult.rowCount > 0 ? (
									<label className="form-check mb-3">
										<input
											type="checkbox"
											className="form-check-input"
											checked={replaceTarget}
											onChange={(event) => setReplaceTarget(event.target.checked)}
										/>
										<span className="form-check-label">
											Replace existing NPM Improved data in the destination
										</span>
									</label>
								) : null}

								<Alert variant="warning">
									The current database is not deleted. NPM Improved copies and verifies the destination first, then changes the local database selection. This gives you a straightforward path back if you need it.
								</Alert>

								<label className="form-label" htmlFor="database-confirmation">
									Type <strong>MIGRATE</strong> to continue
								</label>
								<input
									id="database-confirmation"
									className="form-control"
									value={confirmation}
									onChange={(event) => setConfirmation(event.target.value)}
									autoComplete="off"
								/>
								<div className="mt-3">
									<Button
										actionType="primary"
										onClick={runSwitch}
										isLoading={migrateMutation.isPending}
										disabled={
											confirmation !== "MIGRATE" ||
											(testResult.rowCount > 0 && !replaceTarget) ||
											migrateMutation.isPending
										}
									>
										<IconArrowsExchange size={17} />
										Copy, verify &amp; switch database
									</Button>
								</div>
							</>
						)}
					</div>
				</div>
			) : null}

			{status.runtimeConfigPresent ? (
				<div className="card border-warning">
					<div className="card-header">
						<div>
							<h3 className="card-title mb-1">Return database control to the deployment</h3>
							<div className="text-secondary small">
								Removes the database selection saved by this wizard. On restart, NPM Improved will use the DB_* environment variables or deployment defaults again.
							</div>
						</div>
					</div>
					<div className="card-body">
						<Alert variant="warning">
							This does not move any data. Use the migration wizard first if the deployment-configured database does not already contain the data you want to use.
						</Alert>
						<Button
							actionType="danger"
							onClick={async () => {
								if (!window.confirm("Return database selection to the deployment configuration?")) return;
								setActionError("");
								try {
									const result = await resetMutation.mutateAsync();
									setMessage(result.message);
									await waitForBackend();
								} catch (err) {
									setActionError(err instanceof Error ? err.message : String(err));
								}
							}}
							isLoading={resetMutation.isPending}
						>
							<IconRefresh size={17} />
							Use deployment database settings
						</Button>
					</div>
				</div>
			) : null}

			<div className="mt-4 small text-secondary d-flex gap-2">
				<IconShieldLock size={17} className="flex-shrink-0" />
				<span>
					Database passwords saved by the wizard are stored only in <code>/data/database-config.json</code> with owner-only permissions and are never returned by the API after the switch.
				</span>
			</div>
		</div>
	);
}

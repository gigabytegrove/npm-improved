import {
	IconArrowsExchange,
	IconCheck,
	IconCrown,
	IconRefresh,
	IconServer,
	IconShieldLock,
	IconTopologyStar3,
} from "@tabler/icons-react";
import { Form, Formik } from "formik";
import { useState } from "react";
import { Alert, Badge } from "react-bootstrap";
import { Button, Loading } from "src/components";
import {
	useInstanceSync,
	usePromoteInstanceSync,
	useRunInstanceSync,
	useSetInstanceSync,
} from "src/hooks";
import { T } from "src/locale";

const formatDate = (value?: string | null) => {
	if (!value) return "Never";
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

export default function InstanceSync() {
	const { data, isLoading, error } = useInstanceSync();
	const setSync = useSetInstanceSync();
	const runSync = useRunInstanceSync();
	const promote = usePromoteInstanceSync();
	const [message, setMessage] = useState("");
	const [actionError, setActionError] = useState("");

	if (isLoading) {
		return (
			<div className="card-body">
				<Loading noLogo />
			</div>
		);
	}

	if (error || !data) {
		return (
			<div className="card-body">
				<Alert variant="danger">{error?.message || "Could not load instance synchronization status."}</Alert>
			</div>
		);
	}

	if (data.blockedBySharedDatabase) {
		return (
			<div className="card-body">
				<div className="d-flex align-items-center gap-2 mb-2">
					<IconTopologyStar3 size={24} />
					<h3 className="mb-0">
						<T id="sync.title" />
					</h3>
				</div>
				<Alert variant="info" className="mb-0">
					<strong>Shared MySQL mode is active.</strong> These nodes already use one common database, so Primary/Secondary Instance Synchronization is intentionally disabled. Manage this deployment from <strong>Database &amp; Storage</strong> instead.
				</Alert>
			</div>
		);
	}

	const peers = data.role === "primary"
		? data.peers || []
		: data.primaryStatus
			? [data.primaryStatus]
			: [];

	return (
		<Formik
			enableReinitialize
			initialValues={{
				enabled: data.enabled,
				nodeName: data.nodeName || "",
				role: data.role,
				publicUrl: data.publicUrl || "",
				primaryUrl: data.primaryUrl || "",
				intervalSeconds: data.intervalSeconds || 60,
				sharedSecret: "",
			}}
			onSubmit={async (values, { setSubmitting }) => {
				setMessage("");
				setActionError("");
				try {
					await setSync.mutateAsync({
						enabled: values.enabled,
						nodeName: values.nodeName.trim(),
						role: values.role,
						publicUrl: values.publicUrl.trim(),
						primaryUrl: values.role === "secondary" ? values.primaryUrl.trim() : "",
						intervalSeconds: Number(values.intervalSeconds),
						...(values.sharedSecret.trim()
							? { sharedSecret: values.sharedSecret.trim() }
							: {}),
					});
					setMessage("Instance synchronization settings saved.");
				} catch (err) {
					setActionError(err instanceof Error ? err.message : String(err));
				} finally {
					setSubmitting(false);
				}
			}}
		>
			{({ values, handleChange, isSubmitting, setFieldValue }) => (
				<Form>
					<div className="card-body">
						<div className="d-flex flex-wrap gap-3 align-items-start justify-content-between mb-4">
							<div>
								<div className="d-flex align-items-center gap-2 mb-1">
									<IconTopologyStar3 size={24} />
									<h3 className="mb-0">
										<T id="sync.title" />
									</h3>
								</div>
								<p className="text-secondary mb-0">
									<T id="sync.description" />
								</p>
							</div>
							<div className="d-flex gap-2 align-items-center">
								<Badge bg={data.enabled ? "success" : "secondary"}>
									{data.enabled ? <T id="sync.in-sync" /> : <T id="sync.disabled" />}
								</Badge>
								<Badge bg={data.role === "primary" ? "primary" : "info"}>
									{data.role === "primary" ? <T id="sync.node-role-primary" /> : <T id="sync.node-role-secondary" />}
								</Badge>
							</div>
						</div>

						{message ? <Alert variant="success">{message}</Alert> : null}
						{actionError ? <Alert variant="danger">{actionError}</Alert> : null}
						{data.lastError ? (
							<Alert variant="danger">
								<strong>
									<T id="sync.last-error" />:
								</strong>{" "}
								{data.lastError}
							</Alert>
						) : null}

						<div className="row g-3 mb-4">
							<div className="col-md-4">
								<div className="card h-100">
									<div className="card-body">
										<div className="d-flex align-items-center gap-2 text-secondary mb-2">
											<IconServer size={18} />
											<span>
												<T id="sync.node-name" />
											</span>
										</div>
										<div className="fw-bold">{data.nodeName}</div>
										<div className="small text-secondary text-break">{data.nodeId}</div>
									</div>
								</div>
							</div>
							<div className="col-md-4">
								<div className="card h-100">
									<div className="card-body">
										<div className="d-flex align-items-center gap-2 text-secondary mb-2">
											<IconRefresh size={18} />
											<span>
												<T id="sync.last-sync" />
											</span>
										</div>
										<div className="fw-bold">{formatDate(data.lastSync)}</div>
										<div className="small text-secondary">
											Last attempt: {formatDate(data.lastAttempt)}
										</div>
									</div>
								</div>
							</div>
							<div className="col-md-4">
								<div className="card h-100">
									<div className="card-body">
										<div className="d-flex align-items-center gap-2 text-secondary mb-2">
											<IconShieldLock size={18} />
											<span>Cluster authentication</span>
										</div>
										<div className="fw-bold">
											{data.secretConfigured ? (
												<span className="text-success">
													<IconCheck size={16} className="me-1" />
													Configured
												</span>
											) : (
												<span className="text-warning">Not configured</span>
											)}
										</div>
										<div className="small text-secondary">NPMi {data.version}</div>
									</div>
								</div>
							</div>
						</div>

						<div className="card mb-4">
							<div className="card-header">
								<h3 className="card-title">Cluster configuration</h3>
							</div>
							<div className="card-body">
								<div className="mb-3">
									<label className="row" htmlFor="sync-enabled">
										<span className="col">
											<strong>
												<T id="sync.enabled" />
											</strong>
											<div className="text-secondary small">
												Synchronizes hosts, certificates, access lists, streams, users, authentication, and Nginx configuration between NPMi nodes.
											</div>
										</span>
										<span className="col-auto">
											<input
												id="sync-enabled"
												name="enabled"
												type="checkbox"
												className="form-check-input"
												checked={values.enabled}
												onChange={(event) => setFieldValue("enabled", event.target.checked)}
											/>
										</span>
									</label>
								</div>

								<div className="row g-3">
									<div className="col-md-6">
										<label className="form-label" htmlFor="sync-node-name">
											<T id="sync.node-name" />
										</label>
										<input
											id="sync-node-name"
											name="nodeName"
											className="form-control"
											value={values.nodeName}
											onChange={handleChange}
											required
										/>
									</div>
									<div className="col-md-6">
										<label className="form-label" htmlFor="sync-role">
											Node role
										</label>
										<select
											id="sync-role"
											name="role"
											className="form-select"
											value={values.role}
											onChange={handleChange}
										>
											<option value="primary">
												<T id="sync.node-role-primary" />
											</option>
											<option value="secondary">
												<T id="sync.node-role-secondary" />
											</option>
										</select>
									</div>
									<div className="col-md-6">
										<label className="form-label" htmlFor="sync-public-url">
											<T id="sync.public-url" />
										</label>
										<input
											id="sync-public-url"
											name="publicUrl"
											type="url"
											className="form-control"
											value={values.publicUrl}
											onChange={handleChange}
											placeholder="https://npmi-1.example.com"
										/>
										<div className="text-secondary small mt-1">
											Address other administrators or cluster nodes can use to reach this NPMi instance.
										</div>
									</div>
									{values.role === "secondary" ? (
										<div className="col-md-6">
											<label className="form-label" htmlFor="sync-primary-url">
												<T id="sync.primary-url" />
											</label>
											<input
												id="sync-primary-url"
												name="primaryUrl"
												type="url"
												className="form-control"
												value={values.primaryUrl}
												onChange={handleChange}
												placeholder="https://npmi-primary.example.com"
												required={values.enabled}
											/>
										</div>
									) : (
										<div className="col-md-6">
											<label className="form-label" htmlFor="sync-interval">
												<T id="sync.interval" />
											</label>
											<div className="input-group">
												<input
													id="sync-interval"
													name="intervalSeconds"
													type="number"
													min={15}
													max={3600}
													className="form-control"
													value={values.intervalSeconds}
													onChange={handleChange}
												/>
												<span className="input-group-text">seconds</span>
											</div>
										</div>
									)}
									{values.role === "secondary" ? (
										<div className="col-md-6">
											<label className="form-label" htmlFor="sync-interval-secondary">
												<T id="sync.interval" />
											</label>
											<div className="input-group">
												<input
													id="sync-interval-secondary"
													name="intervalSeconds"
													type="number"
													min={15}
													max={3600}
													className="form-control"
													value={values.intervalSeconds}
													onChange={handleChange}
												/>
												<span className="input-group-text">seconds</span>
											</div>
										</div>
									) : null}
									<div className="col-12">
										<label className="form-label" htmlFor="sync-secret">
											<T id="sync.shared-secret" />
										</label>
										<input
											id="sync-secret"
											name="sharedSecret"
											type="password"
											autoComplete="new-password"
											className="form-control"
											value={values.sharedSecret}
											onChange={handleChange}
											placeholder={data.secretConfigured ? "Leave blank to keep the current secret" : "At least 24 characters"}
										/>
										<div className="text-secondary small mt-1">
											<T id="sync.secret-help" />
										</div>
									</div>
								</div>

								<Alert variant={values.role === "primary" ? "info" : "warning"} className="mt-3 mb-0">
									{values.role === "primary" ? <T id="sync.primary-help" /> : <T id="sync.secondary-help" />}
								</Alert>
							</div>
						</div>

						<div className="card mb-4">
							<div className="card-header d-flex align-items-center">
								<div>
									<h3 className="card-title mb-0">Cluster nodes</h3>
									<div className="text-secondary small">
										{data.role === "primary"
											? "Secondary nodes appear after their first successful synchronization."
											: "The configured primary appears after it is contacted successfully."}
									</div>
								</div>
								{data.role === "secondary" && data.enabled ? (
									<Button
										type="button"
										className="ms-auto"
										onClick={async () => {
											setActionError("");
											setMessage("");
											try {
												await runSync.mutateAsync();
												setMessage("Synchronization completed successfully.");
											} catch (err) {
												setActionError(err instanceof Error ? err.message : String(err));
											}
										}}
										isLoading={runSync.isPending}
									>
										<IconArrowsExchange size={16} />
										<T id="sync.sync-now" />
									</Button>
								) : null}
							</div>
							<div className="table-responsive">
								<table className="table table-vcenter card-table">
									<thead>
										<tr>
											<th>Node</th>
											<th>Role</th>
											<th>Address</th>
											<th>Version</th>
											<th>Last seen</th>
										</tr>
									</thead>
									<tbody>
										<tr>
											<td>
												<div className="fw-bold">{data.nodeName} (this node)</div>
												<div className="small text-secondary">{data.nodeId}</div>
											</td>
											<td>{data.role === "primary" ? <T id="sync.node-role-primary" /> : <T id="sync.node-role-secondary" />}</td>
											<td>{data.publicUrl || "Local instance"}</td>
											<td>{data.version}</td>
											<td>Now</td>
										</tr>
										{peers.map((peer, index) => {
											const nodeName = peer.nodeName || peer.node_name || `Node ${index + 1}`;
											const nodeId = peer.nodeId || peer.node_id || "";
											const publicUrl = peer.publicUrl || peer.public_url || "";
											const lastSeen = peer.lastSeen || peer.last_seen || peer.lastSync || peer.last_sync;
											return (
												<tr key={nodeId || `${nodeName}-${index}`}>
													<td>
														<div className="fw-bold">{nodeName}</div>
														<div className="small text-secondary">{nodeId}</div>
													</td>
													<td>{peer.role === "primary" ? <T id="sync.node-role-primary" /> : <T id="sync.node-role-secondary" />}</td>
													<td>{publicUrl || "Not advertised"}</td>
													<td>{peer.version || "Unknown"}</td>
													<td>{formatDate(lastSeen)}</td>
												</tr>
											);
										})}
										{peers.length === 0 ? (
											<tr>
												<td colSpan={5} className="text-center text-secondary py-4">
													No other cluster nodes have checked in yet.
												</td>
											</tr>
										) : null}
									</tbody>
								</table>
							</div>
						</div>

						{data.role === "secondary" ? (
							<div className="card border-warning">
								<div className="card-header">
									<div className="d-flex align-items-center gap-2">
										<IconCrown size={18} />
										<h3 className="card-title mb-0">Failover promotion</h3>
									</div>
								</div>
								<div className="card-body">
									<Alert variant="warning">
										<T id="sync.promote-warning" />
									</Alert>
									<Button
										type="button"
										actionType="danger"
										onClick={async () => {
											if (!window.confirm("Promote this NPMi node to primary? Confirm the previous primary is unavailable or has been demoted first.")) {
												return;
											}
											setActionError("");
											setMessage("");
											try {
												await promote.mutateAsync();
												setMessage("This NPMi node is now the primary.");
											} catch (err) {
												setActionError(err instanceof Error ? err.message : String(err));
											}
										}}
										isLoading={promote.isPending}
									>
										<IconCrown size={16} />
										<T id="sync.promote" />
									</Button>
								</div>
							</div>
						) : null}
					</div>

					<div className="card-footer bg-transparent mt-auto">
						<div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
							<div className="text-secondary small">
								Secondary nodes are intentionally read-only for synchronized configuration to prevent split-brain changes.
							</div>
							<Button
								type="submit"
								actionType="primary"
								isLoading={isSubmitting || setSync.isPending}
								disabled={isSubmitting || setSync.isPending}
							>
								Save synchronization settings
							</Button>
						</div>
					</div>
				</Form>
			)}
		</Formik>
	);
}

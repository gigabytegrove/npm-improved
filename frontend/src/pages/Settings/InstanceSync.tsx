import {
	IconArrowsExchange,
	IconCheck,
	IconClipboard,
	IconCrown,
	IconKey,
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
	useCreateNpmxPairingCode,
	useInstanceSync,
	useJoinNpmxPairing,
	usePromoteInstanceSync,
	useRunInstanceSync,
	useSetInstanceSync,
	usePreviewNpmxCode,
	useEditNpmxPeer,
	useActivateNpmxPair,
} from "src/hooks";
import { T } from "src/locale";
import { downloadNpmxRecoveryBackup, type NpmxCodePreview } from "src/api/backend";

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
	const createPairing = useCreateNpmxPairingCode();
	const joinPairing = useJoinNpmxPairing();
	const previewPairing = usePreviewNpmxCode();
	const editPeer = useEditNpmxPeer();
	const activatePair = useActivateNpmxPair();
	const [message, setMessage] = useState("");
	const [actionError, setActionError] = useState("");
	const [pairingCode, setPairingCode] = useState("");
	const [joinCode, setJoinCode] = useState("");
	const [pairingExpires, setPairingExpires] = useState("");
	const [pairingMode, setPairingMode] = useState<"repair" | "enroll">("enroll");
	const [pairingTarget, setPairingTarget] = useState<string | null>(null);
	const [joinPreview, setJoinPreview] = useState<NpmxCodePreview | null>(null);
	const [editingPeerId, setEditingPeerId] = useState<string | null>(null);
	const [editPeerName, setEditPeerName] = useState("");
	const [editPeerUrl, setEditPeerUrl] = useState("");

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
					<strong>Shared MySQL mode is active.</strong> These nodes already use one common database, so
					Primary/Secondary NPMX synchronization is intentionally disabled. Manage this deployment from{" "}
					<strong>Database &amp; Storage</strong> instead.
				</Alert>
			</div>
		);
	}

	const peers =
		data.role === "primary" ? data.peers || [] : data.primaryStatus ? [data.primaryStatus] : [];
	const protocolVersion = data.npmx?.protocolVersion || data.npmx?.protocol_version || 1;

	return (
		<Formik
			enableReinitialize
			initialValues={{
				enabled: data.enabled,
				nodeName: data.nodeName || "",
				role: data.role,
				publicUrl: data.publicUrl || "",
				primaryUrl: data.primaryUrl || "",
				intervalSeconds: data.intervalSeconds || 30,
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
									NPMX (NPM Improved Exchange) securely pairs NPM Improved nodes and synchronizes
									configuration, certificates, default-site templates, and cluster filesystem assets.
								</p>
							</div>
							<div className="d-flex gap-2 align-items-center">
								<Badge bg={!data.enabled ? "secondary" : data.lastError ? "danger" : !data.lastSync ? "warning" : "success"}>
									{!data.enabled
										? <T id="sync.disabled" />
										: data.lastError
											? "Synchronization error"
											: data.lastSync
												? "Last sync completed"
												: "Awaiting first sync"}
								</Badge>
								<Badge bg={data.role === "primary" ? "primary" : "info"}>
									{data.role === "primary" ? (
										<T id="sync.node-role-primary" />
									) : (
										<T id="sync.node-role-secondary" />
									)}
								</Badge>
								<Badge bg="dark">NPMX/{protocolVersion}</Badge>
							</div>
						</div>

						{message ? <Alert variant="success">{message}</Alert> : null}
						{actionError ? <Alert variant="danger">{actionError}</Alert> : null}
						{data.enabled && data.role === "secondary" && data.lastHeartbeatError ? (
							<Alert variant="warning">
								<strong>Configuration applied, but the primary did not confirm the sync heartbeat.</strong>{" "}
								{data.lastHeartbeatError} The secondary will retry on its next scheduled synchronization.
							</Alert>
						) : null}
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
												{data.role === "primary" ? "Latest secondary sync" : "Last successful sync"}
											</span>
										</div>
										<div className="fw-bold">
											{data.lastSync ? formatDate(data.lastSync) : data.enabled ? "Awaiting first successful sync" : "Not enabled"}
										</div>
										<div className="small text-secondary">
											{data.role === "primary"
												? `Latest secondary check-in: ${formatDate(data.lastPeerCheckin)}`
												: `Last pull attempt: ${formatDate(data.lastAttempt)}`}
										</div>
										{data.enabled && data.role === "primary" && !data.lastSync ? (
											<div className="small text-secondary mt-1">
												A paired node or check-in alone does not mean a snapshot was applied.
											</div>
										) : null}
										{data.enabled && data.role === "secondary" && !data.lastSync && !data.lastError ? (
											<div className="small text-secondary mt-1">
												Waiting for the secondary's first successful configuration pull.
											</div>
										) : null}
									</div>
								</div>
							</div>
							<div className="col-md-4">
								<div className="card h-100">
									<div className="card-body">
										<div className="d-flex align-items-center gap-2 text-secondary mb-2">
											<IconShieldLock size={18} />
											<span>NPMX security</span>
										</div>
										<div className="fw-bold">
											{data.secretConfigured ? (
												<span className="text-success">
													<IconCheck size={16} className="me-1" />
													Secure credentials ready
												</span>
											) : (
												<span className="text-warning">Not paired</span>
											)}
										</div>
										<div className="small text-secondary">
											Secrets are generated automatically and never shown in the UI.
										</div>
									</div>
								</div>
							</div>
						</div>

						<div className="card mb-4">
							<div className="card-header">
								<div>
									<h3 className="card-title mb-0">NPMX secure pairing</h3>
									<div className="text-secondary small">
										No manually-created shared secret is required. Pairing codes are one-time,
										short-lived credentials used to establish the persistent encrypted cluster identity.
									</div>
								</div>
							</div>
							<div className="card-body">
								{values.role === "primary" ? (
									<>
										<div className="d-flex flex-wrap gap-2 align-items-center mb-3">
											<Button
												type="button"
												actionType="primary"
												onClick={async () => {
													setActionError("");
													setMessage("");
													try {
														const primaryUrl =
															values.publicUrl.trim() || window.location.origin;
														await setSync.mutateAsync({
															enabled: true,
															nodeName: values.nodeName.trim(),
															role: "primary",
															publicUrl: primaryUrl,
															intervalSeconds: Number(values.intervalSeconds),
														});
														const result = await createPairing.mutateAsync({ primaryUrl });
												setPairingMode(result.mode);
												setPairingTarget(result.targetNodeId);
														setPairingCode(result.pairingCode);
														setPairingExpires(result.expiresAt);
														setFieldValue("enabled", true);
														setFieldValue("publicUrl", primaryUrl);
														setMessage("One-time NPMX pairing code created.");
													} catch (err) {
														setActionError(err instanceof Error ? err.message : String(err));
													}
												}}
												isLoading={createPairing.isPending}
											>
												<IconKey size={16} />
												Create pairing code
											</Button>
											{data.role === "primary" && peers.length === 0 ? (
												<Button type="button" onClick={() => setFieldValue("role", "secondary")}>
													Repair this node as an existing secondary
												</Button>
											) : null}
											<span className="text-secondary small">
												The code expires after 10 minutes and can be used only once.
											</span>
										</div>
										{pairingCode ? (
											<>
												<label className="form-label" htmlFor="npmx-pairing-code">
													{pairingMode === "repair" ? "Repair existing secondary" : "One-time pairing code"}
												</label>
												<textarea
													id="npmx-pairing-code"
													className="form-control font-monospace"
													rows={4}
													readOnly
													value={pairingCode}
												/>
												<div className="d-flex flex-wrap align-items-center gap-2 mt-2">
													<Button
														type="button"
														onClick={async () => {
															await navigator.clipboard.writeText(pairingCode);
															setMessage("NPMX pairing code copied.");
														}}
													>
														<IconClipboard size={16} />
														Copy pairing code
													</Button>
													<span className="text-secondary small">
														Expires {formatDate(pairingExpires)}{pairingTarget ? ` · Original node: ${pairingTarget}` : ""}
													</span>
												</div>
											</>
										) : null}
									</>
								) : (
									<>
										<label className="form-label" htmlFor="npmx-join-code">
											Pairing code from the primary
										</label>
										<textarea
											id="npmx-join-code"
											className="form-control font-monospace"
											rows={4}
											value={joinCode}
											onChange={(event) => { setJoinCode(event.target.value); setJoinPreview(null); }}
											placeholder="npmx1.…"
										/>
										<div className="d-flex flex-wrap align-items-center gap-2 mt-2">
											<Button type="button" disabled={!joinCode.trim() || previewPairing.isPending}
												isLoading={previewPairing.isPending}
												onClick={async () => {
													setActionError("");
													try { setJoinPreview(await previewPairing.mutateAsync(joinCode.trim())); }
													catch (err) { setJoinPreview(null); setActionError(err instanceof Error ? err.message : String(err)); }
												}}>
												Review pairing code
											</Button>
										</div>
										{joinPreview ? (
											<Alert variant="warning" className="mt-3">
												<strong>{joinPreview.mode === "repair" ? "Repair existing secondary" : "New node enrollment"}</strong>
												<div>Primary: {joinPreview.primaryUrl}</div>
												<div>Current node ID: <code>{joinPreview.currentNodeId}</code></div>
												{joinPreview.targetNodeId ? <div>Original secondary ID: <code>{joinPreview.targetNodeId}</code></div> : null}
												<p className="mt-2 mb-0">Pairing will not replace local proxy configuration. A separate, confirmed activation with encrypted backup is required before synchronization.</p>
											</Alert>
										) : null}
										<div className="d-flex flex-wrap gap-2 align-items-center mt-2">
											<Button
												type="button"
												actionType="primary"
												disabled={!joinPreview || joinPairing.isPending}
												isLoading={joinPairing.isPending}
												onClick={async () => {
													setActionError("");
													setMessage("");
													try {
														if (!joinPreview) throw new Error("Review the code and its existing node identity before pairing.");
														const restoreIdentity = joinPreview.identityRestoreRequired || data.role === "primary";
														if (!window.confirm(restoreIdentity
															? `Restore the existing secondary ID ${joinPreview.targetNodeId}? Local proxy configuration will not be replaced, and synchronization will remain off.`
															: "Pair this node without replacing its configuration? Synchronization stays off until activation.")) return;
														const result = await joinPairing.mutateAsync({ pairingCode: joinCode.trim(), restoreIdentity });
														setFieldValue("role", "secondary");
														setFieldValue("enabled", false);
														setFieldValue("primaryUrl", result.status.primaryUrl);
														setJoinCode("");
														setJoinPreview(null);
														setMessage("NPMX pairing repaired in place. Current secondary configuration is untouched; synchronize only after the recovery backup is created.");
														} catch (err) {
														setActionError(err instanceof Error ? err.message : String(err));
													}
												}}
											>
												<IconShieldLock size={16} />
												{joinPreview?.mode === "repair" ? "Repair existing pairing" : "Pair new secondary"}
											</Button>
											<span className="text-secondary small">
												The cluster secret is exchanged through an authenticated ephemeral key
												exchange; it is not displayed or copied manually.
											</span>
										</div>
									</>
								)}
							</div>
						</div>

						{data.recoveryPending ? (
							<Alert variant="warning" className="mb-4">
								<strong>Secondary pairing restored — synchronization paused.</strong>
								<p className="mt-2">No proxy configuration has been overwritten. Activation saves an encrypted copy of this node's current synchronized state before it can pull data from the primary.</p>
								<Button type="button" actionType="primary" disabled={activatePair.isPending} isLoading={activatePair.isPending}
									onClick={async () => {
										if (!window.confirm("Create an encrypted recovery backup, then enable primary-authoritative NPMX synchronization? Future pulls may replace this node's local proxy, certificate and user configuration.")) return;
										setActionError("");
										try {
											const result = await activatePair.mutateAsync();
											setFieldValue("enabled", true);
											setMessage(`Synchronization activated. Local encrypted recovery snapshot saved as ${result.backup}.`);
										} catch (err) { setActionError(err instanceof Error ? err.message : String(err)); }
									}}>
									Create backup and activate synchronization
								</Button>
							</Alert>
						) : null}
						{data.recoveryBackup ? (
							<div className="mb-4">
								<div className="small text-secondary mb-2">Pre-activation recovery snapshot: {data.recoveryBackup}</div>
								<Button type="button" onClick={async () => {
									setActionError("");
									try { await downloadNpmxRecoveryBackup(); }
									catch (err) { setActionError(err instanceof Error ? err.message : String(err)); }
								}}>Download encrypted recovery snapshot</Button>
							</div>
						) : null}

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
												Synchronizes hosts, certificates, access lists, streams, users, Nginx
												configuration, custom files, and default-site templates.
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
											Reachable URL this node advertises to the cluster. Pairing defaults to the
											current browser origin when this is empty.
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
												placeholder="Dedicated primary URL (not the load-balanced browser hostname)"
												
											/>
										</div>
									) : null}
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
								</div>

								<Alert variant={values.role === "primary" ? "info" : "warning"} className="mt-3 mb-0">
									{values.role === "primary" ? (
										<>
											The primary is the configuration authority. Create a one-time NPMX pairing code
											for each secondary you add.
										</>
									) : (
										<>
											You can edit synchronized configuration while signed into either node. Secondary edits are
											validated and committed by the primary, which assigns IDs and prevents stale changes
											from overwriting newer records. Use a direct primary URL for pairing and forwarding.
										</>
									)}
								</Alert>
							</div>
						</div>

						<div className="card mb-4">
							<div className="card-header d-flex align-items-center">
								<div>
									<h3 className="card-title mb-0">Cluster nodes</h3>
									<div className="text-secondary small">
										NPMX negotiates protocol/capabilities before a secondary accepts a snapshot.
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
												const result = await runSync.mutateAsync();
												setMessage(result.heartbeatWarning
													? "Configuration was applied, but the primary could not confirm the heartbeat. See warning above."
													: "NPMX synchronization completed successfully.");
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
											<th>Last successful sync</th>
										</tr>
									</thead>
									<tbody>
										<tr>
											<td>
												<div className="fw-bold">{data.nodeName} (this node)</div>
												<div className="small text-secondary">{data.nodeId}</div>
											</td>
											<td>
												{data.role === "primary" ? (
													<T id="sync.node-role-primary" />
												) : (
													<T id="sync.node-role-secondary" />
												)}
											</td>
											<td>{data.publicUrl || "Local instance"}</td>
											<td>{data.version}</td>
											<td>Now</td>
											<td>{data.role === "secondary" ? formatDate(data.lastSync) : "Receives from secondaries"}</td>
										</tr>
										{peers.map((peer, index) => {
											const nodeName = peer.configuredName || peer.nodeName || peer.node_name || `Node ${index + 1}`;
											const nodeId = peer.nodeId || peer.node_id || "";
											const publicUrl = peer.configuredUrl || peer.publicUrl || peer.public_url || "";
											const lastSeen = peer.lastSeen || peer.last_seen;
											return (
												<tr key={nodeId || `${nodeName}-${index}`}>
													<td>
														<div className="fw-bold">{nodeName}</div>
														<div className="small text-secondary">{nodeId}</div>
													</td>
													<td>
														{peer.role === "primary" ? (
															<T id="sync.node-role-primary" />
														) : (
															<T id="sync.node-role-secondary" />
														)}
													</td>
													<td>{publicUrl || "Not advertised"}</td>
													<td>{peer.version || "Unknown"}</td>
													<td>{formatDate(lastSeen)}</td>
													<td>{formatDate(peer.lastSync || peer.last_sync)}</td>
												</tr>
											);
										})}
										{peers.length === 0 ? (
											<tr>
												<td colSpan={6} className="text-center text-secondary py-4">
													No other NPMX nodes have checked in yet.
												</td>
											</tr>
										) : null}
									</tbody>
								</table>
							</div>
						</div>

						{data.role === "primary" && peers.some((peer) => peer.role === "secondary") ? (
							<div className="card mb-4">
								<div className="card-header"><h3 className="card-title mb-0">Manage enrolled secondaries</h3></div>
								<div className="card-body">
									<p className="text-secondary">Edit an existing peer without changing its ID, or issue a repair code tied to its original identity. This does not add a secondary record or replace its proxy configuration.</p>
									<label className="form-label" htmlFor="npmx-managed-peer">Existing secondary</label>
									<select id="npmx-managed-peer" className="form-select mb-3" value={editingPeerId || ""}
										onChange={(event) => {
											const next = peers.find((peer) => (peer.nodeId || peer.node_id) === event.target.value);
											setEditingPeerId(next?.nodeId || next?.node_id || null);
											setEditPeerName(next?.configuredName || next?.nodeName || next?.node_name || "");
											setEditPeerUrl(next?.configuredUrl || next?.publicUrl || next?.public_url || "");
										}}>
										<option value="">Select an existing secondary</option>
										{peers.filter((peer) => peer.role === "secondary").map((peer) => (
											<option key={peer.nodeId || peer.node_id} value={peer.nodeId || peer.node_id}>
												{peer.configuredName || peer.nodeName || peer.node_name || "Secondary"} — {peer.nodeId || peer.node_id}
											</option>
										))}
									</select>
									{editingPeerId ? (
										<>
											<div className="row g-3 mb-3">
												<div className="col-md-6">
													<label className="form-label" htmlFor="npmx-managed-name">Display name</label>
													<input id="npmx-managed-name" className="form-control" value={editPeerName}
														onChange={(event) => setEditPeerName(event.target.value)} maxLength={100} />
												</div>
												<div className="col-md-6">
													<label className="form-label" htmlFor="npmx-managed-url">Secondary management URL</label>
													<input id="npmx-managed-url" className="form-control" type="url" value={editPeerUrl}
														onChange={(event) => setEditPeerUrl(event.target.value)} />
												</div>
											</div>
											<div className="d-flex flex-wrap gap-2">
												<Button type="button" disabled={editPeer.isPending} isLoading={editPeer.isPending}
													onClick={async () => {
													setActionError("");
													try {
														await editPeer.mutateAsync({ nodeId: editingPeerId, nodeName: editPeerName.trim(), publicUrl: editPeerUrl.trim() });
														setMessage("Existing secondary's management details updated; original node ID and pairing preserved.");
													} catch (err) { setActionError(err instanceof Error ? err.message : String(err)); }
												}}>Save existing peer</Button>
												<Button type="button" actionType="primary" disabled={createPairing.isPending} isLoading={createPairing.isPending}
													onClick={async () => {
													setActionError("");
													try {
														const result = await createPairing.mutateAsync({ primaryUrl: values.publicUrl.trim() || data.publicUrl || window.location.origin, peerNodeId: editingPeerId });
														setPairingCode(result.pairingCode);
														setPairingExpires(result.expiresAt);
														setPairingMode(result.mode);
														setPairingTarget(result.targetNodeId);
														setMessage("In-place repair code generated for existing secondary " + editingPeerId + ". Copy it from NPMX secure pairing above.");
													} catch (err) { setActionError(err instanceof Error ? err.message : String(err)); }
												}}><IconKey size={16} /> Generate repair code for this peer</Button>
											</div>
										</>
									) : null}
								</div>
							</div>
						) : null}

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
											if (
												!window.confirm(
													"Promote this NPM Improved node to primary? Confirm the previous primary is unavailable or has been demoted first.",
												)
											) {
												return;
											}
											setActionError("");
											setMessage("");
											try {
												await promote.mutateAsync();
												setMessage("This NPM Improved node is now the primary.");
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
								NPMX credentials are generated automatically. Secondary nodes remain read-only to avoid
								split-brain configuration changes.
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

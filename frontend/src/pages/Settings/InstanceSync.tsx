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
	useUpdateNpmxPeer,
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
	const createPairing = useCreateNpmxPairingCode();
	const joinPairing = useJoinNpmxPairing();
	const updatePeer = useUpdateNpmxPeer();
	const [message, setMessage] = useState("");
	const [actionError, setActionError] = useState("");
	const [pairingCode, setPairingCode] = useState("");
	const [joinCode, setJoinCode] = useState("");
	const [pairingExpires, setPairingExpires] = useState("");
	const [pairingTarget, setPairingTarget] = useState("");
	const [editingPeerId, setEditingPeerId] = useState("");
	const [peerDraft, setPeerDraft] = useState({ nodeName: "", publicUrl: "" });

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
					if (data.recoveryPending && values.enabled && !window.confirm("Enable the first NPMX snapshot? The primary will replace the secondary\u0027s synchronized configuration. Pairing has not changed local hosts or certificates.")) return;
					await setSync.mutateAsync({
						approveRecoverySync: Boolean(data.recoveryPending && values.enabled),
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
						{data.recoveryPending ? <Alert variant="warning" role="alert"><strong>Secondary connection repaired — synchronization is paused.</strong> Local hosts, certificates and files remain unchanged. Review the primary before explicitly enabling a snapshot below.</Alert> : null}
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
										Renew codes for previously enrolled secondary nodes below to preserve their original identity. Codes are one-time,
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
														const result = await createPairing.mutateAsync({ primaryUrl });
																setPairingTarget("");
														setPairingCode(result.pairingCode);
														setPairingExpires(result.expiresAt);
														setMessage("One-time NPMX pairing code created.");
													} catch (err) {
														setActionError(err instanceof Error ? err.message : String(err));
													}
												}}
												isLoading={createPairing.isPending}
											>
												<IconKey size={16} />
												Create code for new secondary
											</Button>
											<span className="text-secondary small">
												The code expires after 10 minutes and can be used only once.
											</span>
										</div>
										{pairingCode ? (
											<>
												<label className="form-label" htmlFor="npmx-pairing-code">
													{pairingTarget ? "Renewed code for existing secondary" : "One-time pairing code"}
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
														Expires {formatDate(pairingExpires)}{pairingTarget ? ` · Peer ID ${pairingTarget}` : ""}
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
											onChange={(event) => setJoinCode(event.target.value)}
											placeholder="npmx1.…"
										/>
										<div className="d-flex flex-wrap gap-2 align-items-center mt-2">
											<Button
												type="button"
												actionType="primary"
												disabled={!joinCode.trim() || joinPairing.isPending}
												isLoading={joinPairing.isPending}
												onClick={async () => {
													setActionError("");
													setMessage("");
													try {
														if (!window.confirm("Repair or pair this node? Its stored proxy configuration will remain unchanged. Synchronization is paused until you approve the first snapshot.")) return;
														const result = await joinPairing.mutateAsync({ pairingCode: joinCode.trim(), confirmExistingPeer: true });
														setFieldValue("enabled", false);
														setFieldValue("primaryUrl", result.status.primaryUrl);
														setJoinCode("");
														setMessage(
															result.recoveredPeerId ? "Existing secondary identity recovered without replacing configuration. Review and approve the first snapshot separately." : "Pairing completed without replacing local configuration. Review and approve synchronization separately.",
														);
													} catch (err) {
														setActionError(err instanceof Error ? err.message : String(err));
													}
												}}
											>
												<IconShieldLock size={16} />
												Repair / pair safely
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
											const nodeName = peer.nodeName || peer.node_name || `Node ${index + 1}`;
											const nodeId = peer.nodeId || peer.node_id || "";
											const publicUrl = peer.publicUrl || peer.public_url || "";
											const lastSeen = peer.lastSeen || peer.last_seen;
											return (
												<tr key={nodeId || `${nodeName}-${index}`}>
													<td>
														{editingPeerId === nodeId ? (
															<input
																className="form-control form-control-sm mb-1"
																aria-label={`Edit name of ${nodeName}`}
																maxLength={100}
																value={peerDraft.nodeName}
																onChange={(event) => setPeerDraft((current) => ({ ...current, nodeName: event.target.value }))}
															/>
														) : <div className="fw-bold">{nodeName}</div>}
														<div className="small text-secondary">{nodeId}</div>
																			{data.role === "primary" && nodeId && peer.role === "secondary" ? (
																			<div className="d-flex flex-wrap gap-2 mt-2">
																				{editingPeerId === nodeId ? (
																					<>
																						<Button type="button" disabled={updatePeer.isPending || !peerDraft.nodeName.trim()} onClick={async () => {
																							setActionError("");
																							try {
																								await updatePeer.mutateAsync({ nodeId, nodeName: peerDraft.nodeName.trim(), publicUrl: peerDraft.publicUrl.trim() });
																								setEditingPeerId("");
																								setMessage(`Saved ${peerDraft.nodeName.trim()} without changing its enrollment or synchronized configuration.`);
																							} catch (err) { setActionError(err instanceof Error ? err.message : String(err)); }
																						}}>Save edit</Button>
																						<Button type="button" disabled={updatePeer.isPending} onClick={() => setEditingPeerId("")}>Cancel</Button>
																					</>
																				) : <Button type="button" onClick={() => {
																					setEditingPeerId(nodeId);
																					setPeerDraft({ nodeName, publicUrl });
																				}}>Edit node</Button>}
																				</div>
																		) : null}
																	{data.role === "primary" && nodeId && peer.role === "secondary" ? (
																				<Button type="button" disabled={createPairing.isPending} onClick={async () => {
																					setActionError("");
																					try {
																						const primaryUrl = values.publicUrl.trim() || data.publicUrl || window.location.origin;
																						const code = await createPairing.mutateAsync({ primaryUrl, targetPeerId: nodeId });
																						setPairingCode(code.pairingCode);
																						setPairingExpires(code.expiresAt);
																						setPairingTarget(nodeId);
																						setMessage(`Reconnect code renewed for ${nodeName}; its existing peer record is preserved.`);
																					} catch (err) { setActionError(err instanceof Error ? err.message : String(err)); }
																				}}><IconKey size={15} /> Reconnect / renew code</Button>
																			) : null}
																			{pairingTarget === nodeId && pairingCode ? (
																				<div className="mt-2">
																					<label className="form-label small" htmlFor={`npmx-peer-code-${nodeId}`}>Reconnect code for {nodeName}</label>
																					<textarea id={`npmx-peer-code-${nodeId}`} className="form-control font-monospace" rows={3} readOnly value={pairingCode} />
																					<div className="d-flex flex-wrap align-items-center gap-2 mt-1">
																						<Button type="button" onClick={async () => {
																							try { await navigator.clipboard.writeText(pairingCode); setMessage("Reconnect code copied."); }
																							catch (err) { setActionError(err instanceof Error ? err.message : "Could not copy code."); }
																						}}>Copy code</Button>
																						<span className="small text-secondary">Expires {formatDate(pairingExpires)}. Use on this secondary only.</span>
																					</div>
																				</div>
																			) : null}
													</td>
													<td>
														{peer.role === "primary" ? (
															<T id="sync.node-role-primary" />
														) : (
															<T id="sync.node-role-secondary" />
														)}
													</td>
													<td>{editingPeerId === nodeId ? (
																<input
																type="url"
																className="form-control form-control-sm"
																aria-label={`Edit address of ${nodeName}`}
																value={peerDraft.publicUrl}
																onChange={(event) => setPeerDraft((current) => ({ ...current, publicUrl: event.target.value }))}
															/>
														) : publicUrl || "Not advertised"}</td>
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

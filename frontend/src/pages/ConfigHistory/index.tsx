import { IconEye, IconRestore } from "@tabler/icons-react";
import { useState } from "react";
import { Alert, Modal } from "react-bootstrap";
import type {
	ConfigHistoryFilters,
	ConfigRevision,
	ConfigRevisionObjectType,
	ConfigRevisionStatus,
} from "src/api/backend";
import { Button, HasPermission, Loading } from "src/components";
import { useConfigHistory, useConfigRevision, useRestoreConfigRevision } from "src/hooks";
import { T } from "src/locale";
import { ADMIN, VIEW } from "src/modules/Permissions";

const objectLabels: Record<ConfigRevisionObjectType, string> = {
	proxy_host: "Proxy Host",
	redirection_host: "Redirection Host",
	dead_host: "404 Host",
	stream: "Stream",
};

const statusClass: Record<ConfigRevisionStatus, string> = {
	active: "bg-green-lt",
	superseded: "bg-secondary-lt",
	failed: "bg-red-lt",
	pending: "bg-yellow-lt",
};

const operationLabel = (operation: ConfigRevision["operation"]) =>
	operation.charAt(0).toUpperCase() + operation.slice(1);

const RevisionDetails = ({
	id,
	onClose,
	onRestore,
}: {
	id: number | null;
	onClose: () => void;
	onRestore: (revision: ConfigRevision) => void;
}) => {
	const { data, isLoading, error } = useConfigRevision(id);

	return (
		<Modal show={id !== null} onHide={onClose} size="lg">
			<Modal.Header closeButton>
				<Modal.Title>{data ? `Revision #${data.id}` : "Configuration revision"}</Modal.Title>
			</Modal.Header>
			<Modal.Body>
				{isLoading && <Loading noLogo />}
				{error && <Alert variant="danger">{error.message}</Alert>}
				{data && (
					<>
						<div className="row g-3 mb-4">
							<div className="col-md-6">
								<div className="text-secondary small">Object</div>
								<div className="fw-semibold">
									{objectLabels[data.objectType]} #{data.objectId}
								</div>
							</div>
							<div className="col-md-3">
								<div className="text-secondary small">Operation</div>
								<div>{operationLabel(data.operation)}</div>
							</div>
							<div className="col-md-3">
								<div className="text-secondary small">State</div>
								<span className={`badge ${statusClass[data.status]}`}>{data.status}</span>
							</div>
							<div className="col-md-6">
								<div className="text-secondary small">Recorded</div>
								<div>{new Date(data.createdOn).toLocaleString()}</div>
							</div>
							<div className="col-md-6">
								<div className="text-secondary small">Actor</div>
								<div>{data.user?.name || (data.userId ? `User #${data.userId}` : "System")}</div>
							</div>
						</div>

						{data.meta?.sourceRevisionId ? (
							<Alert variant="info">
								This revision was created by restoring revision #{data.meta.sourceRevisionId}.
							</Alert>
						) : null}

						{data.errorText ? (
							<Alert variant="danger">
								<div className="fw-semibold mb-1">Activation failed</div>
								<div className="mb-1">Phase: {data.meta?.phase || "unknown"}</div>
								<pre className="mb-0 text-wrap">{data.errorText}</pre>
							</Alert>
						) : null}

						<div className="mb-4">
							<h4>Generated Nginx configuration</h4>
							<pre
								className="bg-dark text-light rounded p-3 mb-0"
								style={{ maxHeight: 360, overflow: "auto", whiteSpace: "pre-wrap" }}
							>
								{data.configText || "No live Nginx configuration for this revision."}
							</pre>
						</div>

						<div>
							<h4>Database snapshot</h4>
							<pre
								className="bg-light rounded border p-3 mb-0"
								style={{ maxHeight: 360, overflow: "auto", whiteSpace: "pre-wrap" }}
							>
								{JSON.stringify(data.snapshot || {}, null, 2)}
							</pre>
						</div>
					</>
				)}
			</Modal.Body>
			<Modal.Footer>
				<Button onClick={onClose}>Close</Button>
				{data?.status === "superseded" ? (
					<Button actionType="primary" className="bg-orange" onClick={() => onRestore(data)}>
						<IconRestore size={18} className="me-1" />
						Restore this revision
					</Button>
				) : null}
			</Modal.Footer>
		</Modal>
	);
};

const ConfigHistory = () => {
	const [filters, setFilters] = useState<ConfigHistoryFilters>({ limit: 100 });
	const [selectedId, setSelectedId] = useState<number | null>(null);
	const [restoreTarget, setRestoreTarget] = useState<ConfigRevision | null>(null);
	const [restoreError, setRestoreError] = useState<string | null>(null);
	const { data = [], isLoading, isFetching, error } = useConfigHistory(filters);
	const restore = useRestoreConfigRevision();

	const setObjectType = (value: string) =>
		setFilters((current) => ({
			...current,
			objectType: value as ConfigRevisionObjectType | "",
		}));
	const setStatus = (value: string) =>
		setFilters((current) => ({
			...current,
			status: value as ConfigRevisionStatus | "",
		}));

	const confirmRestore = () => {
		if (!restoreTarget) return;
		setRestoreError(null);
		restore.mutate(restoreTarget.id, {
			onSuccess: (newRevision) => {
				setRestoreTarget(null);
				setSelectedId(newRevision.id);
			},
			onError: (err: Error) => setRestoreError(err.message),
		});
	};

	return (
		<HasPermission section={ADMIN} permission={VIEW} pageLoading loadingNoLogo>
			<div className="card mt-4">
				<div className="card-status-top bg-orange" />
				<div className="card-header">
					<div>
						<h2 className="card-title mb-1">
							<T id="config-history" />
						</h2>
						<div className="text-secondary">
							Durable Nginx configuration revisions, failed candidates, and last-known-good restore points.
						</div>
					</div>
				</div>

				<div className="card-body border-bottom">
					<div className="row g-3 align-items-end">
						<div className="col-md-4">
							<label className="form-label" htmlFor="config-history-object">
								Object type
							</label>
							<select
								id="config-history-object"
								className="form-select"
								value={filters.objectType || ""}
								onChange={(event) => setObjectType(event.target.value)}
							>
								<option value="">All HTTP hosts and streams</option>
								<option value="proxy_host">Proxy Hosts</option>
								<option value="redirection_host">Redirection Hosts</option>
								<option value="dead_host">404 Hosts</option>
								<option value="stream">Streams</option>
							</select>
						</div>
						<div className="col-md-4">
							<label className="form-label" htmlFor="config-history-status">
								State
							</label>
							<select
								id="config-history-status"
								className="form-select"
								value={filters.status || ""}
								onChange={(event) => setStatus(event.target.value)}
							>
								<option value="">All states</option>
								<option value="active">Active</option>
								<option value="superseded">Superseded</option>
								<option value="failed">Failed</option>
								<option value="pending">Pending</option>
							</select>
						</div>
						<div className="col-md-4 text-md-end">
							<span className="text-secondary">
								{isFetching && !isLoading ? "Refreshing… " : ""}
								{data.length} revision{data.length === 1 ? "" : "s"}
							</span>
						</div>
					</div>
				</div>

				{error ? <Alert variant="danger" className="m-3">{error.message}</Alert> : null}
				{isLoading ? (
					<div className="card-body">
						<Loading noLogo />
					</div>
				) : data.length === 0 ? (
					<div className="card-body text-center text-secondary py-5">
						No configuration revisions match the selected filters.
					</div>
				) : (
					<div className="table-responsive">
						<table className="table table-vcenter card-table">
							<thead>
								<tr>
									<th>Revision</th>
									<th>Recorded</th>
									<th>Object</th>
									<th>Operation</th>
									<th>State</th>
									<th>Actor</th>
									<th className="w-1" />
								</tr>
							</thead>
							<tbody>
								{data.map((revision) => (
									<tr key={revision.id}>
										<td className="fw-semibold">#{revision.id}</td>
										<td>{new Date(revision.createdOn).toLocaleString()}</td>
										<td>
											{objectLabels[revision.objectType]} #{revision.objectId}
										</td>
										<td>{operationLabel(revision.operation)}</td>
										<td>
											<span className={`badge ${statusClass[revision.status]}`}>
												{revision.status}
											</span>
											{revision.errorText ? (
												<div className="text-danger small mt-1 text-truncate" style={{ maxWidth: 280 }}>
													{revision.errorText}
												</div>
											) : null}
										</td>
										<td>{revision.user?.name || (revision.userId ? `User #${revision.userId}` : "System")}</td>
										<td>
											<button
												type="button"
												className="btn btn-action"
												title="View revision"
												onClick={() => setSelectedId(revision.id)}
											>
												<IconEye size={18} />
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>

			<RevisionDetails
				id={selectedId}
				onClose={() => setSelectedId(null)}
				onRestore={(revision) => {
					setRestoreError(null);
					setRestoreTarget(revision);
				}}
			/>

			<Modal
				show={restoreTarget !== null}
				onHide={() => {
					if (!restore.isPending) setRestoreTarget(null);
				}}
			>
				<Modal.Header closeButton={!restore.isPending}>
					<Modal.Title>Restore configuration revision</Modal.Title>
				</Modal.Header>
				<Modal.Body>
					{restoreError ? <Alert variant="danger">{restoreError}</Alert> : null}
					<p>
						Restore revision <strong>#{restoreTarget?.id}</strong> for{" "}
						<strong>
							{restoreTarget ? objectLabels[restoreTarget.objectType] : "host"} #{restoreTarget?.objectId}
						</strong>
						?
					</p>
					<Alert variant="warning" className="mb-0">
						NPM Improved will restore the stored database state, regenerate Nginx, run <code>nginx -t</code>,
						and reload. If activation fails, the currently active configuration remains in service.
					</Alert>
				</Modal.Body>
				<Modal.Footer>
					<Button onClick={() => setRestoreTarget(null)} disabled={restore.isPending}>
						Cancel
					</Button>
					<Button
						actionType="primary"
						className="bg-orange"
						onClick={confirmRestore}
						isLoading={restore.isPending}
						disabled={restore.isPending}
					>
						<IconRestore size={18} className="me-1" />
						Restore
					</Button>
				</Modal.Footer>
			</Modal>
		</HasPermission>
	);
};

export default ConfigHistory;

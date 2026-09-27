import { useQuery } from "@tanstack/react-query";
import { type ChangeEvent, useMemo, useState } from "react";
import { Alert } from "react-bootstrap";
import {
	exportDisasterRecoveryBackup,
	getDisasterRecoveryStatus,
	inspectDisasterRecoveryBackup,
	restoreDisasterRecoveryBackup,
	type DisasterRecoveryBackupSummary,
	type DisasterRecoveryScope,
} from "src/api/backend";
import { Button, Loading } from "src/components";

const formatBytes = (bytes: number) => {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
	const units = ["B", "KiB", "MiB", "GiB"];
	const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

export default function DisasterRecovery() {
	const { data: status, isLoading, error, refetch } = useQuery({
		queryKey: ["disaster-recovery-status"],
		queryFn: getDisasterRecoveryStatus,
		refetchInterval: 15000,
	});

	const [scope, setScope] = useState<DisasterRecoveryScope>("configuration");
	const [exportPassphrase, setExportPassphrase] = useState("");
	const [exportPassphraseConfirm, setExportPassphraseConfirm] = useState("");
	const [exporting, setExporting] = useState(false);
	const [exportError, setExportError] = useState("");

	const [backupFile, setBackupFile] = useState<File | null>(null);
	const [restorePassphrase, setRestorePassphrase] = useState("");
	const [summary, setSummary] = useState<DisasterRecoveryBackupSummary | null>(null);
	const [inspectError, setInspectError] = useState("");
	const [inspecting, setInspecting] = useState(false);
	const [confirmation, setConfirmation] = useState("");
	const [restoring, setRestoring] = useState(false);
	const [restoreError, setRestoreError] = useState("");
	const [restoreSuccess, setRestoreSuccess] = useState("");

	const canExport = useMemo(
		() =>
			exportPassphrase.length >= (status?.minimumPassphraseLength || 12) &&
			exportPassphrase === exportPassphraseConfirm &&
			!exporting,
		[exportPassphrase, exportPassphraseConfirm, exporting, status?.minimumPassphraseLength],
	);

	if (isLoading) {
		return (
			<div className="card-body">
				<Loading noLogo />
			</div>
		);
	}

	if (error) {
		return (
			<div className="card-body">
				<Alert variant="danger">{error.message}</Alert>
			</div>
		);
	}

	const doExport = async () => {
		setExportError("");
		setExporting(true);
		try {
			await exportDisasterRecoveryBackup(scope, exportPassphrase);
		} catch (err) {
			setExportError(err instanceof Error ? err.message : String(err));
		} finally {
			setExporting(false);
		}
	};

	const onFile = (event: ChangeEvent<HTMLInputElement>) => {
		setBackupFile(event.target.files?.[0] || null);
		setSummary(null);
		setInspectError("");
		setRestoreError("");
		setRestoreSuccess("");
		setConfirmation("");
	};

	const inspect = async () => {
		if (!backupFile) return;
		setInspectError("");
		setInspecting(true);
		try {
			setSummary(await inspectDisasterRecoveryBackup(backupFile, restorePassphrase));
		} catch (err) {
			setSummary(null);
			setInspectError(err instanceof Error ? err.message : String(err));
		} finally {
			setInspecting(false);
		}
	};

	const restore = async () => {
		if (!backupFile || !summary || confirmation !== "RESTORE") return;
		setRestoreError("");
		setRestoreSuccess("");
		setRestoring(true);
		try {
			const result = await restoreDisasterRecoveryBackup(
				backupFile,
				restorePassphrase,
				confirmation,
			);
			const safety = result.safetyBackupPath ? ` Pre-restore safety backup: ${result.safetyBackupPath}` : "";
			setRestoreSuccess(
				(result.restartRequired
					? "Restore completed successfully. Restart NPM Improved before relying on restored authentication/JWT state."
					: "Configuration restore completed successfully and Nginx validated/reloaded.") + safety,
			);
			await refetch();
		} catch (err) {
			setRestoreError(err instanceof Error ? err.message : String(err));
		} finally {
			setRestoring(false);
		}
	};

	return (
		<div className="card-body">
			<h3 className="mb-1">Backup &amp; Disaster Recovery</h3>
			<p className="text-secondary mb-4">
				Create encrypted backups, inspect them without making changes, and restore configuration or full instance state.
			</p>

			{status?.restoreInProgress ? (
				<Alert variant="warning">
					A restore is currently in progress. Do not restart the container until it completes or rolls back.
				</Alert>
			) : null}

			<div className="card mb-4">
				<div className="card-header">
					<h3 className="card-title">Create encrypted backup</h3>
				</div>
				<div className="card-body">
					{exportError ? <Alert variant="danger">{exportError}</Alert> : null}
					<div className="mb-3">
						<label className="form-label" htmlFor="backup-scope">
							Backup type
						</label>
						<select
							id="backup-scope"
							className="form-select"
							value={scope}
							onChange={(e) => setScope(e.target.value as DisasterRecoveryScope)}
						>
							<option value="configuration">Configuration backup</option>
							<option value="disaster-recovery">Full disaster recovery backup</option>
						</select>
					</div>

					<Alert variant={scope === "disaster-recovery" ? "warning" : "info"}>
						{scope === "configuration"
							? "Portable configuration backup: hosts, streams, access lists, settings, certificate definitions/material, custom Nginx files, and Let's Encrypt state. User accounts and JWT identity are not replaced when this backup is restored."
							: "Full disaster recovery backup: includes configuration plus user/authentication state and JWT keys. Restoring it is intended to rebuild the same NPM Improved instance and requires a restart afterward."}
					</Alert>

					<div className="row">
						<div className="col-md-6">
							<label className="form-label" htmlFor="backup-passphrase">
								Encryption passphrase
							</label>
							<input
								id="backup-passphrase"
								type="password"
								className="form-control"
								autoComplete="new-password"
								value={exportPassphrase}
								onChange={(e) => setExportPassphrase(e.target.value)}
							/>
						</div>
						<div className="col-md-6">
							<label className="form-label" htmlFor="backup-passphrase-confirm">
								Confirm passphrase
							</label>
							<input
								id="backup-passphrase-confirm"
								type="password"
								className="form-control"
								autoComplete="new-password"
								value={exportPassphraseConfirm}
								onChange={(e) => setExportPassphraseConfirm(e.target.value)}
							/>
						</div>
					</div>
					<div className="text-secondary mt-2">
						Minimum {status?.minimumPassphraseLength || 12} characters. There is no passphrase recovery; keep it with your disaster-recovery documentation.
					</div>
					{exportPassphraseConfirm && exportPassphrase !== exportPassphraseConfirm ? (
						<div className="text-danger mt-2">Passphrases do not match.</div>
					) : null}
				</div>
				<div className="card-footer bg-transparent">
					<div className="btn-list justify-content-end">
						<Button
							actionType="primary"
							onClick={doExport}
							isLoading={exporting}
							disabled={!canExport}
						>
							Download encrypted backup
						</Button>
					</div>
				</div>
			</div>

			<div className="card">
				<div className="card-header">
					<h3 className="card-title">Inspect or restore backup</h3>
				</div>
				<div className="card-body">
					{inspectError ? <Alert variant="danger">{inspectError}</Alert> : null}
					{restoreError ? <Alert variant="danger">{restoreError}</Alert> : null}
					{restoreSuccess ? <Alert variant="success">{restoreSuccess}</Alert> : null}

					<div className="mb-3">
						<label className="form-label" htmlFor="restore-file">
							NPM Improved backup file
						</label>
						<input
							id="restore-file"
							type="file"
							className="form-control"
							accept=".npmibak,application/vnd.npm-improved.backup"
							onChange={onFile}
						/>
					</div>

					<div className="mb-3">
						<label className="form-label" htmlFor="restore-passphrase">
							Backup passphrase
						</label>
						<input
							id="restore-passphrase"
							type="password"
							className="form-control"
							autoComplete="current-password"
							value={restorePassphrase}
							onChange={(e) => {
								setRestorePassphrase(e.target.value);
								setSummary(null);
							}}
						/>
					</div>

					<Button
						onClick={inspect}
						isLoading={inspecting}
						disabled={!backupFile || restorePassphrase.length < (status?.minimumPassphraseLength || 12) || inspecting}
					>
						Inspect backup
					</Button>

					{summary ? (
						<div className="mt-4">
							<h4>Validated backup</h4>
							<div className="table-responsive">
								<table className="table table-sm table-vcenter">
									<tbody>
										<tr><th>Type</th><td>{summary.scope === "configuration" ? "Configuration" : "Full disaster recovery"}</td></tr>
										<tr><th>Created</th><td>{new Date(summary.createdAt).toLocaleString()}</td></tr>
										<tr><th>Source version</th><td>{summary.sourceVersion}</td></tr>
										<tr><th>Source database</th><td>{summary.sourceDatabase}</td></tr>
										<tr><th>Filesystem</th><td>{summary.filesystemEntries} entries / {formatBytes(summary.filesystemBytes)}</td></tr>
										<tr><th>Hosts</th><td>{(summary.counts.proxy_host || 0) + (summary.counts.redirection_host || 0) + (summary.counts.dead_host || 0)}</td></tr>
										<tr><th>Streams</th><td>{summary.counts.stream || 0}</td></tr>
										<tr><th>Certificates</th><td>{summary.counts.certificate || 0}</td></tr>
										<tr><th>Access lists</th><td>{summary.counts.access_list || 0}</td></tr>
									</tbody>
								</table>
							</div>

							<Alert variant="danger">
								Restore replaces the matching configuration scope. NPM Improved takes a local rollback snapshot first and restores it automatically if the imported configuration cannot pass <code>nginx -t</code> or reload.
							</Alert>

							<label className="form-label" htmlFor="restore-confirmation">
								Type <strong>RESTORE</strong> to continue
							</label>
							<input
								id="restore-confirmation"
								className="form-control"
								value={confirmation}
								onChange={(e) => setConfirmation(e.target.value)}
								autoComplete="off"
							/>

							<div className="btn-list justify-content-end mt-3">
								<Button
									actionType="danger"
									onClick={restore}
									isLoading={restoring}
									disabled={confirmation !== "RESTORE" || restoring}
								>
									Restore validated backup
								</Button>
							</div>
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}

import * as api from "./base";
import type { DisasterRecoveryBackupSummary } from "./inspectDisasterRecoveryBackup";

export interface DisasterRecoveryRestoreResult {
	ok: boolean;
	scope: "configuration" | "disaster-recovery";
	restoredAt: string;
	restartRequired: boolean;
	safetyBackupPath: string;
	summary: DisasterRecoveryBackupSummary;
}

export async function restoreDisasterRecoveryBackup(
	file: File,
	passphrase: string,
	confirmation: string,
): Promise<DisasterRecoveryRestoreResult> {
	const data = new FormData();
	data.append("backup", file);
	data.append("passphrase", passphrase);
	data.append("confirmation", confirmation);
	return await api.post({ url: "/disaster-recovery/restore", data });
}

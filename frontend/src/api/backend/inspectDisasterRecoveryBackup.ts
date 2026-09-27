import * as api from "./base";

export interface DisasterRecoveryBackupSummary {
	formatVersion: number;
	scope: "configuration" | "disaster-recovery";
	createdAt: string;
	sourceVersion: string;
	sourceDatabase: string;
	counts: Record<string, number>;
	filesystemEntries: number;
	filesystemBytes: number;
	containsAuthenticationState: boolean;
	requiresRestart: boolean;
}

export async function inspectDisasterRecoveryBackup(file: File, passphrase: string): Promise<DisasterRecoveryBackupSummary> {
	const data = new FormData();
	data.append("backup", file);
	data.append("passphrase", passphrase);
	return await api.post({ url: "/disaster-recovery/inspect", data });
}

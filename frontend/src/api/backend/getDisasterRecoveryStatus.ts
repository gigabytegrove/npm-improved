import * as api from "./base";

export interface DisasterRecoveryStatus {
	formatVersion: number;
	database: string;
	counts: Record<string, number>;
	scopes: Array<"configuration" | "disaster-recovery">;
	encryptionRequired: boolean;
	minimumPassphraseLength: number;
	restoreInProgress: boolean;
	automation: {
		enabled: boolean;
		scope: "configuration" | "disaster-recovery";
		intervalHours: number;
		retention: number;
		retainedCount: number;
		latestBackup: {
			name: string;
			size: number;
			modifiedAt: string;
			type: string;
		} | null;
	};
}

export async function getDisasterRecoveryStatus(): Promise<DisasterRecoveryStatus> {
	return await api.get({ url: "/disaster-recovery/status" });
}

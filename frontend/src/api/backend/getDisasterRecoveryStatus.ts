import * as api from "./base";

export interface DisasterRecoveryStatus {
	formatVersion: number;
	database: string;
	counts: Record<string, number>;
	scopes: Array<"configuration" | "disaster-recovery">;
	encryptionRequired: boolean;
	minimumPassphraseLength: number;
	restoreInProgress: boolean;
}

export async function getDisasterRecoveryStatus(): Promise<DisasterRecoveryStatus> {
	return await api.get({ url: "/disaster-recovery/status" });
}

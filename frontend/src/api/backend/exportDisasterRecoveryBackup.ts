import * as api from "./base";

export type DisasterRecoveryScope = "configuration" | "disaster-recovery";

export async function exportDisasterRecoveryBackup(scope: DisasterRecoveryScope, passphrase: string) {
	return await api.downloadPost(
		{
			url: "/disaster-recovery/export",
			data: { scope, passphrase },
		},
		"npm-improved-" + scope + ".npmibak",
	);
}

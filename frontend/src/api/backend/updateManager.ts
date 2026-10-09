import * as api from "./base";

export interface UpdateRelease {
	current: string | null;
	latest: string | null;
	updateAvailable: boolean;
	releaseName: string | null;
	releaseNotes: string | null;
	publishedAt: string | null;
	releaseUrl: string | null;
}

export interface UpdateCapabilities {
	enabled: boolean;
	dockerSocketAvailable: boolean;
	hostProjectConfigured: boolean;
	hostProjectDir: string | null;
	deploymentMode: "sqlite" | "mysql" | "postgres";
	helperImage: string | null;
	handoffSource: string;
	hostServiceInstalled: boolean;
	reason: string | null;
}

export interface UpdateStatus {
	state: string;
	action: string | null;
	message: string;
	startedAt: string | null;
	completedAt: string | null;
	sourceVersion: string | null;
	targetVersion: string | null;
	previousVersion: string | null;
	previousImage: string | null;
	targetImage: string | null;
	targetDigest: string | null;
	error: string | null;
}

export interface UpdateCoordination {
	instanceSyncEnabled: boolean;
	role: "primary" | "secondary" | null;
	mode: "rolling" | "standalone";
}

export interface UpdateManagerResponse {
	release: UpdateRelease;
	capabilities: UpdateCapabilities;
	coordination: UpdateCoordination;
	status: UpdateStatus;
}

export async function getUpdateManager(
	refresh = false,
	clearFailed = false,
): Promise<UpdateManagerResponse> {
	const params: Record<string, string> = {};
	if (refresh) params.refresh = "1";
	if (clearFailed) params.clearFailed = "1";

	return await api.get({
		url: "/version/update",
		params: Object.keys(params).length > 0 ? params : undefined,
	});
}

export async function startManagedUpdate(password: string): Promise<UpdateStatus> {
	return await api.post({
		url: "/version/update",
		data: { password },
	});
}

export async function rollbackManagedUpdate(password: string): Promise<UpdateStatus> {
	return await api.post({
		url: "/version/update/rollback",
		data: { password },
	});
}

export async function restartManagedInstance(password: string): Promise<UpdateStatus> {
	return await api.post({
		url: "/version/update/restart",
		data: { password },
	});
}

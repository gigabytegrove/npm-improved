import * as api from "./base";

export interface InstanceSyncPeer {
	nodeId?: string;
	nodeName?: string;
	node_id?: string;
	node_name?: string;
	publicUrl?: string;
	public_url?: string;
	role: "primary" | "secondary";
	version: string;
	buildCommit?: string | null;
	build_commit?: string | null;
	lastSync?: string | null;
	last_sync?: string | null;
	lastSeen?: string | null;
	last_seen?: string | null;
	remoteAddress?: string | null;
	remote_address?: string | null;
}

export interface InstanceSyncStatus {
	enabled: boolean;
	nodeId: string | null;
	nodeName: string;
	role: "primary" | "secondary";
	publicUrl: string;
	primaryUrl: string;
	intervalSeconds: number;
	secretConfigured: boolean;
	lastSync: string | null;
	lastAttempt: string | null;
	lastError: string | null;
	primaryStatus: InstanceSyncPeer | null;
	peers: InstanceSyncPeer[];
	version: string;
	buildCommit: string | null;
	buildDate: string | null;
	sharedDatabaseMode?: boolean;
}

export interface InstanceSyncSettings {
	enabled?: boolean;
	nodeName?: string;
	role?: "primary" | "secondary";
	publicUrl?: string;
	primaryUrl?: string;
	intervalSeconds?: number;
	sharedSecret?: string;
}

export interface InstanceSyncResult {
	ok: boolean;
	syncedAt: string;
	primary: InstanceSyncPeer;
	summary: Record<string, any>;
}

export async function getInstanceSyncStatus(): Promise<InstanceSyncStatus> {
	return await api.get({ url: "/cluster/status" });
}

export async function updateInstanceSyncSettings(
	data: InstanceSyncSettings,
): Promise<InstanceSyncStatus> {
	return await api.put({ url: "/cluster/settings", data });
}

export async function runInstanceSync(): Promise<InstanceSyncResult> {
	return await api.post({ url: "/cluster/sync-now" });
}

export async function promoteInstanceSync(): Promise<InstanceSyncStatus> {
	return await api.post({ url: "/cluster/promote" });
}

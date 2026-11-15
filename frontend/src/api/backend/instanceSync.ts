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
	blockedBySharedDatabase?: boolean;
	nodeId: string;
	nodeName: string;
	role: "primary" | "secondary";
	publicUrl: string;
	primaryUrl: string;
	intervalSeconds: number;
	secretConfigured: boolean;
	lastSync: string | null;
	lastPeerCheckin: string | null;
	lastHeartbeatError: string | null;
	lastAttempt: string | null;
	lastError: string | null;
	recoveryPending?: boolean;
	primaryStatus: InstanceSyncPeer | null;
	peers: InstanceSyncPeer[];
	version: string;
	buildCommit: string | null;
	buildDate: string | null;
	npmx?: {
		protocol: string;
		protocolVersion?: number;
		protocol_version?: number;
		snapshotFormat?: string;
		snapshot_format?: string;
		capabilities: string[];
		paired: boolean;
	};
}

export interface InstanceSyncSettings {
	enabled?: boolean;
	nodeName?: string;
	role?: "primary" | "secondary";
	publicUrl?: string;
	primaryUrl?: string;
	intervalSeconds?: number;
	sharedSecret?: string;
	approveRecoverySync?: boolean;
}

export interface InstanceSyncResult {
	ok: boolean;
	syncedAt: string;
	heartbeatWarning?: string | null;
	primary: InstanceSyncPeer;
	summary: Record<string, any>;
}

export interface NpmxPairingCode {
	protocol: "npmx";
	protocolVersion: number;
	primaryUrl: string;
	expiresAt: string;
	pairingCode: string;
	targetPeerId?: string | null;
	mode?: "repair" | "enroll";
}

export interface NpmxJoinResult {
	ok: boolean;
	protocol: "npmx";
	protocolVersion: number;
	primary: Record<string, any>;
	status: InstanceSyncStatus;
	recoveredPeerId?: string | null;
	requiresSyncApproval?: boolean;
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

export async function createNpmxPairingCode(options: { primaryUrl?: string; targetPeerId?: string } = {}): Promise<NpmxPairingCode> {
	return await api.post({
		url: "/cluster/npmx/pairing-code",
		data: options,
	});
}

export async function updateNpmxPeer(nodeId: string, data: { nodeName: string; publicUrl: string }): Promise<InstanceSyncStatus> {
	return await api.put({
		url: `/cluster/npmx/peers/${encodeURIComponent(nodeId)}`,
		data,
	});
}

export async function joinNpmxPairing(options: { pairingCode: string; confirmExistingPeer?: boolean }): Promise<NpmxJoinResult> {
	return await api.post({
		url: "/cluster/npmx/join",
		data: options,
	});
}


export interface NpmxSecondaryReconnectCode {
	pairingCode: string;
	expiresAt: string;
}

export interface NpmxPeerReconnectResult {
	ok: boolean;
	nodeId: string;
	status: InstanceSyncStatus;
	protocolUpgraded?: boolean;
	peerVersion?: string;
	versionMismatch?: boolean;
}

export async function createSecondaryNpmxReconnectCode(secondaryUrl: string): Promise<NpmxSecondaryReconnectCode> {
	return await api.post({ url: "/cluster/npmx/reconnect-code", data: { secondaryUrl } });
}

export async function reconnectExistingNpmxPeer(
	nodeId: string,
	pairingCode: string,
	primaryUrl: string,
): Promise<NpmxPeerReconnectResult> {
	return await api.post({
		url: "/cluster/npmx/peers/" + encodeURIComponent(nodeId) + "/reconnect",
		data: { pairingCode, primaryUrl },
	});
}

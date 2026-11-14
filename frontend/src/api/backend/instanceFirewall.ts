import * as api from "./base";

export type FirewallMode = "static" | "forwarded" | "dmz" | "unmanaged";
export type FirewallState = "active" | "deferred";

export interface InstanceFirewallStatus {
	enabled: boolean;
	state: string;
	enforced: boolean;
	releasePending: boolean;
	helperReady: boolean;
	helperError: string | null;
	pendingUntil: string | null;
	droppedPackets: number | null;
	droppedBytes: number | null;
	managementPort: number;
	warning: string;
	config: {
		configured: boolean;
		enabled: boolean;
		mode: FirewallMode;
		state: FirewallState;
		trustedNetworks: string[];
		hostLanIp: string;
		acknowledgedDmz: boolean;
	};
}

export async function getInstanceFirewallStatus(): Promise<InstanceFirewallStatus> {
	return await api.get({ url: "/instance-security" });
}

export async function setInstanceFirewallEnabled(enabled: boolean): Promise<InstanceFirewallStatus> {
	return await api.put({ url: "/instance-security/enabled", data: { enabled } });
}

export async function reconcileInstanceFirewall(): Promise<InstanceFirewallStatus> {
	return await api.post({ url: "/instance-security/reconcile", data: {} });
}

export async function confirmInstanceFirewallActivation(): Promise<InstanceFirewallStatus> {
	return await api.post({ url: "/instance-security/confirm", data: {} });
}

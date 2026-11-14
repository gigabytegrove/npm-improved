/**
 * Only an explicit, authenticated enabled=true status exposes the top-level
 * firewall navigation. Loading, denied, unavailable, and disabled are hidden.
 */
export function showFirewallNavigation(enabled?: boolean | null): boolean {
	return enabled === true;
}

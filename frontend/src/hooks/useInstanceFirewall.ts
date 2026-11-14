import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	confirmInstanceFirewallActivation,
	getInstanceFirewallStatus,
	reconcileInstanceFirewall,
	setInstanceFirewallEnabled,
} from "src/api/backend/instanceFirewall";

export const FIREWALL_QUERY_KEY = ["instance-firewall"] as const;

export function useInstanceFirewall() {
	return useQuery({
		queryKey: FIREWALL_QUERY_KEY,
		queryFn: getInstanceFirewallStatus,
		staleTime: 5_000,
		refetchInterval: 10_000,
		refetchOnWindowFocus: true,
		retry: 1,
	});
}

export function useFirewallActions() {
	const client = useQueryClient();
	const refresh = async () => {
		await Promise.all([
			client.invalidateQueries({ queryKey: FIREWALL_QUERY_KEY }),
			client.invalidateQueries({ queryKey: ["system-health"] }),
		]);
	};
	const toggle = useMutation({
		mutationFn: setInstanceFirewallEnabled,
		onSuccess: refresh,
	});
	const reconcile = useMutation({
		mutationFn: reconcileInstanceFirewall,
		onSuccess: refresh,
	});
	const confirm = useMutation({
		mutationFn: confirmInstanceFirewallActivation,
		onSuccess: refresh,
	});
	return { toggle, reconcile, confirm };
}

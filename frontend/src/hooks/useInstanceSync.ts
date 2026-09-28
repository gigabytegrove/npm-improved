import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createNpmxPairingCode,
	getInstanceSyncStatus,
	joinNpmxPairing,
	promoteInstanceSync,
	runInstanceSync,
	type InstanceSyncSettings,
	updateInstanceSyncSettings,
} from "src/api/backend";

const useInstanceSync = () =>
	useQuery({
		queryKey: ["instance-sync"],
		queryFn: getInstanceSyncStatus,
		refetchInterval: 10_000,
	});

const useSetInstanceSync = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (settings: InstanceSyncSettings) => updateInstanceSyncSettings(settings),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["instance-sync"] });
		},
	});
};

const useRunInstanceSync = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: runInstanceSync,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["instance-sync"] });
			await queryClient.invalidateQueries({ queryKey: ["proxy-hosts"] });
			await queryClient.invalidateQueries({ queryKey: ["redirection-hosts"] });
			await queryClient.invalidateQueries({ queryKey: ["dead-hosts"] });
			await queryClient.invalidateQueries({ queryKey: ["streams"] });
			await queryClient.invalidateQueries({ queryKey: ["certificates"] });
			await queryClient.invalidateQueries({ queryKey: ["users"] });
		},
	});
};

const useCreateNpmxPairingCode = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (primaryUrl?: string) => createNpmxPairingCode(primaryUrl),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["instance-sync"] });
		},
	});
};

const useJoinNpmxPairing = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (pairingCode: string) => joinNpmxPairing(pairingCode),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["instance-sync"] });
		},
	});
};

const usePromoteInstanceSync = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: promoteInstanceSync,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["instance-sync"] });
		},
	});
};

export {
	useInstanceSync,
	useSetInstanceSync,
	useRunInstanceSync,
	useCreateNpmxPairingCode,
	useJoinNpmxPairing,
	usePromoteInstanceSync,
};

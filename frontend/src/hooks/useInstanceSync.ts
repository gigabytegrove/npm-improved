import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createNpmxPairingCode,
	previewNpmxCode,
	updateNpmxPeer,
	activateNpmxPair,
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
		mutationFn: (input: { primaryUrl?: string; peerNodeId?: string }) => createNpmxPairingCode(input),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["instance-sync"] });
		},
	});
};

const useJoinNpmxPairing = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (request: { pairingCode: string; restoreIdentity?: boolean }) => joinNpmxPairing(request.pairingCode, request.restoreIdentity),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["instance-sync"] });
		},
	});
};

const usePreviewNpmxCode = () => useMutation({ mutationFn: previewNpmxCode });

const useEditNpmxPeer = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (request: { nodeId: string; nodeName?: string; publicUrl?: string }) =>
			updateNpmxPeer(request.nodeId, { nodeName: request.nodeName, publicUrl: request.publicUrl }),
		onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["instance-sync"] }); },
	});
};

const useActivateNpmxPair = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: activateNpmxPair,
		onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["instance-sync"] }); },
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
	usePreviewNpmxCode,
	useEditNpmxPeer,
	useActivateNpmxPair,
};

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type ConfigHistoryFilters,
	type ConfigRevision,
	getConfigHistory,
	getConfigRevision,
	restoreConfigRevision,
} from "src/api/backend";

export const useConfigHistory = (filters: ConfigHistoryFilters = {}) =>
	useQuery<ConfigRevision[], Error>({
		queryKey: ["config-history", filters],
		queryFn: () => getConfigHistory(filters),
		staleTime: 15 * 1000,
	});

export const useConfigRevision = (id: number | null) =>
	useQuery<ConfigRevision, Error>({
		queryKey: ["config-revision", id],
		queryFn: () => getConfigRevision(id as number),
		enabled: typeof id === "number" && id > 0,
		staleTime: 15 * 1000,
	});

export const useRestoreConfigRevision = () => {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (id: number) => restoreConfigRevision(id),
		onSuccess: async (revision: ConfigRevision) => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["config-history"] }),
				queryClient.invalidateQueries({ queryKey: ["config-revision"] }),
				queryClient.invalidateQueries({ queryKey: ["proxy-hosts"] }),
				queryClient.invalidateQueries({ queryKey: ["redirection-hosts"] }),
				queryClient.invalidateQueries({ queryKey: ["dead-hosts"] }),
				queryClient.invalidateQueries({ queryKey: ["streams"] }),
				queryClient.invalidateQueries({ queryKey: ["host-report"] }),
				queryClient.invalidateQueries({ queryKey: ["audit-logs"] }),
			]);
			queryClient.setQueryData(["config-revision", revision.id], revision);
		},
	});
};

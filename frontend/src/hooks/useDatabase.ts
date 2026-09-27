import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	getDatabaseStatus,
	migrateDatabase,
	setSharedDatabaseRole,
	testDatabaseTarget,
	type DatabaseTarget,
} from "src/api/backend";

const useDatabaseStatus = () =>
	useQuery({
		queryKey: ["database-status"],
		queryFn: getDatabaseStatus,
		refetchInterval: 5000,
	});

const useTestDatabase = () =>
	useMutation({
		mutationFn: (target: DatabaseTarget) => testDatabaseTarget(target),
	});

const useMigrateDatabase = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: migrateDatabase,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["database-status"] });
		},
	});
};

const useSetSharedDatabaseRole = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: setSharedDatabaseRole,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["database-status"] });
		},
	});
};

export {
	useDatabaseStatus,
	useMigrateDatabase,
	useSetSharedDatabaseRole,
	useTestDatabase,
};

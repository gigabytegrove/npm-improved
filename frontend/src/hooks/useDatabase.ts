import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	getDatabaseStatus,
	joinDatabase,
	migrateDatabase,
	resetDatabaseSelection,
	testDatabaseConnection,
	type DatabaseTarget,
} from "src/api/backend";

const useDatabaseStatus = () =>
	useQuery({
		queryKey: ["database-status"],
		queryFn: getDatabaseStatus,
		refetchInterval: 10_000,
	});

const useTestDatabase = () =>
	useMutation({
		mutationFn: (target: DatabaseTarget) => testDatabaseConnection(target),
	});

const useMigrateDatabase = () => {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (target: DatabaseTarget) => migrateDatabase(target),
		onSuccess: async () => {
			await client.invalidateQueries({ queryKey: ["database-status"] });
		},
	});
};

const useJoinDatabase = () => {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (target: DatabaseTarget) => joinDatabase(target),
		onSuccess: async () => {
			await client.invalidateQueries({ queryKey: ["database-status"] });
		},
	});
};

const useResetDatabaseSelection = () => {
	const client = useQueryClient();
	return useMutation({
		mutationFn: resetDatabaseSelection,
		onSuccess: async () => {
			await client.invalidateQueries({ queryKey: ["database-status"] });
		},
	});
};

export {
	useDatabaseStatus,
	useTestDatabase,
	useMigrateDatabase,
	useJoinDatabase,
	useResetDatabaseSelection,
};

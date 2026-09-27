import * as api from "./base";

export type DatabaseEngine = "sqlite" | "mysql";

export interface DatabaseCurrentStatus {
	source: string;
	engine: string;
	shared: boolean;
	filename: string | null;
	host: string | null;
	port: number | null;
	user: string | null;
	name: string | null;
	ssl: boolean;
}

export interface SharedDatabaseNode {
	id: string;
	name: string;
	version: string;
	lastSeen: string;
}

export interface DatabaseStatus {
	current: DatabaseCurrentStatus;
	migrationInProgress: boolean;
	runtimeConfigPresent: boolean;
	supportedTargets: DatabaseEngine[];
	mysqlSharedMode: boolean;
	sharedNodes: SharedDatabaseNode[];
	sharedModeRequirements: string[];
}

export interface MysqlTarget {
	host: string;
	port: number;
	user: string;
	password: string;
	name: string;
	ssl: boolean;
	sslRejectUnauthorized?: boolean;
	sslVerifyIdentity?: boolean;
}

export interface DatabaseTarget {
	engine: DatabaseEngine;
	shared?: boolean;
	sqlite?: {
		filename: string;
	};
	mysql?: MysqlTarget;
	replaceTarget?: boolean;
	confirmation?: string;
}

export interface DatabaseTestResult {
	ok: boolean;
	engine: DatabaseEngine;
	shared: boolean;
	reachable: boolean;
	npmSchema: boolean;
	tableCount: number;
	rowCount: number;
	counts: Record<string, number>;
	migration: string;
	sharedVersion: string | null;
}

export interface DatabaseSwitchResult {
	ok: boolean;
	restartScheduled: boolean;
	message: string;
	copiedRows?: number;
	counts?: Record<string, number>;
	target?: {
		engine: DatabaseEngine;
		shared: boolean;
		host?: string | null;
		name?: string | null;
		filename?: string | null;
	};
}

export async function getDatabaseStatus(): Promise<DatabaseStatus> {
	return await api.get({ url: "/database/status" });
}

export async function testDatabaseConnection(data: DatabaseTarget): Promise<DatabaseTestResult> {
	return await api.post({ url: "/database/test", data });
}

export async function migrateDatabase(data: DatabaseTarget): Promise<DatabaseSwitchResult> {
	return await api.post({ url: "/database/migrate", data });
}

export async function joinDatabase(data: DatabaseTarget): Promise<DatabaseSwitchResult> {
	return await api.post({ url: "/database/join", data });
}

export async function resetDatabaseSelection(): Promise<DatabaseSwitchResult> {
	return await api.post({
		url: "/database/reset",
		data: { confirmation: "RESET" },
	});
}

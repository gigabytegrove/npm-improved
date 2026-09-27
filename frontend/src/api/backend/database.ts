import * as api from "./base";

export type DatabaseEngine = "sqlite" | "mysql";

export interface DatabasePublicConfig {
	engine: DatabaseEngine | string;
	filename?: string;
	host?: string;
	port?: number;
	user?: string;
	name?: string;
	ssl?: boolean;
	sslRejectUnauthorized?: boolean;
	sslVerifyIdentity?: boolean;
	shared?: boolean;
}

export interface SharedDatabaseNode {
	nodeId: string;
	nodeName: string;
	role: "primary" | "secondary";
	version?: string | null;
	buildCommit?: string | null;
	publicUrl?: string | null;
	lastAppliedRevision: number;
	lastSeen: string;
	lastError?: string | null;
}

export interface SharedDatabaseStatus {
	enabled: boolean;
	role: "primary" | "secondary" | null;
	nodeId: string | null;
	nodeName: string | null;
	publicUrl?: string | null;
	revision: number;
	lastAppliedRevision?: number;
	initialized?: boolean;
	lastError?: string | null;
	primaryNodeId?: string | null;
	primarySeenOn?: string | null;
	primaryHealthy?: boolean;
	nodes: SharedDatabaseNode[];
}

export interface DatabaseStatus {
	engine: DatabaseEngine | string;
	source: "runtime" | "environment" | "config-file" | string;
	configFile: string;
	current: DatabasePublicConfig;
	shared: boolean;
	sharedCluster: SharedDatabaseStatus;
	migrationInProgress: boolean;
	supportedTargets: DatabaseEngine[];
	sqliteDefaultPath: string;
}

export interface DatabaseTarget {
	engine: DatabaseEngine;
	filename?: string;
	host?: string;
	port?: number;
	user?: string;
	password?: string;
	name?: string;
	shared?: boolean;
	ssl?: {
		enabled: boolean;
		rejectUnauthorized: boolean;
		verifyIdentity: boolean;
	};
}

export interface DatabaseTestResult {
	ok: boolean;
	target: DatabasePublicConfig;
	reachable: boolean;
	hasNPMiSchema: boolean;
	hasNPMiData: boolean;
	userCount: number;
	latestMigration: string | null;
	expectedMigration: string | null;
	schemaCurrent: boolean;
}

export interface DatabaseMigrationResult {
	ok: boolean;
	operation: "migrate" | "connect";
	target: DatabasePublicConfig;
	restartRequired: boolean;
	message: string;
}

export async function getDatabaseStatus(): Promise<DatabaseStatus> {
	return await api.get({ url: "/database/status" });
}

export async function testDatabaseTarget(target: DatabaseTarget): Promise<DatabaseTestResult> {
	return await api.post({ url: "/database/test", data: { target } });
}

export async function migrateDatabase(data: {
	target: DatabaseTarget;
	operation: "migrate" | "connect";
	confirmation: string;
	nodeRole?: "primary" | "secondary";
	nodeName?: string;
	publicUrl?: string;
}): Promise<DatabaseMigrationResult> {
	return await api.post({ url: "/database/migrate", data });
}

export async function setSharedDatabaseRole(data: {
	role: "primary" | "secondary";
	force?: boolean;
	confirmation?: string;
}): Promise<SharedDatabaseStatus> {
	return await api.post({ url: "/database/shared/role", data });
}

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import knex from "knex";
import db from "../db.js";
import { getDatabaseRuntime, isMysql, isPostgres, isSqlite } from "../lib/config.js";
import errs from "../lib/error.js";
import { global as logger } from "../logger.js";
import pjson from "../package.json" with { type: "json" };
import internalDisasterRecovery from "./disaster-recovery.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");
const RUNTIME_FILE = "/data/database-config.json";
const SHARED_IDENTITY_KEY = "jwt-keys";
const SHARED_VERSION_KEY = "npmi-version";
const SHARED_NODE_FILE = "/data/shared-database-node-id";
const POLL_SECONDS_MIN = 2;
const POLL_SECONDS_MAX = 60;
const DEFAULT_POLL_SECONDS = 5;
const COPY_BATCH_SIZE = 250;

const FINGERPRINT_TABLES = [
	"proxy_host",
	"redirection_host",
	"dead_host",
	"stream",
	"access_list",
	"access_list_auth",
	"access_list_client",
	"certificate",
	"setting",
];

let migrationInProgress = false;
let watcherTimer = null;
let lastFingerprint = null;
let refreshInProgress = false;

const currentVersion = () => (process.env.NPM_BUILD_VERSION || pjson.version || "0.0.0").trim();

const getSharedNodeId = () => {
	try {
		const value = fs.readFileSync(SHARED_NODE_FILE, "utf8").trim();
		if (value) return value;
	} catch {
		// Create a stable local node identity below.
	}
	const value = crypto.randomUUID();
	fs.writeFileSync(SHARED_NODE_FILE, value + "\n", { mode: 0o600 });
	fs.chmodSync(SHARED_NODE_FILE, 0o600);
	return value;
};

const engineName = () => (isSqlite() ? "sqlite" : isMysql() ? "mysql" : isPostgres() ? "postgres" : "unknown");

const sanitizeRuntime = () => {
	const runtime = getDatabaseRuntime();
	return {
		source: runtime.source || "unknown",
		engine: runtime.engine || engineName(),
		shared: Boolean(runtime.shared),
		filename: runtime.filename || null,
		host: runtime.host || null,
		port: runtime.port || null,
		user: runtime.user || null,
		name: runtime.name || null,
		ssl: Boolean(runtime.ssl),
	};
};

const normalizeSqliteFilename = (value) => {
	const filename = String(value || "/data/database.sqlite").trim();
	if (!filename.startsWith("/data/")) {
		throw new errs.ValidationError("SQLite database files managed by the wizard must be stored under /data");
	}
	if (!filename.endsWith(".sqlite") && !filename.endsWith(".db")) {
		throw new errs.ValidationError("SQLite filename must end in .sqlite or .db");
	}
	return path.normalize(filename);
};

const normalizeMysql = (raw = {}) => {
	const host = String(raw.host || "").trim();
	const user = String(raw.user || "").trim();
	const name = String(raw.name || "").trim();
	const password = String(raw.password || "");
	const port = Number.parseInt(raw.port || 3306, 10);
	if (!host) throw new errs.ValidationError("MySQL host is required");
	if (!user) throw new errs.ValidationError("MySQL user is required");
	if (!name) throw new errs.ValidationError("MySQL database name is required");
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new errs.ValidationError("MySQL port must be between 1 and 65535");
	}
	return {
		host,
		port,
		user,
		password,
		name,
		ssl: Boolean(raw.ssl),
		sslRejectUnauthorized: raw.sslRejectUnauthorized !== false,
		sslVerifyIdentity: raw.sslVerifyIdentity !== false,
	};
};

const normalizeTarget = (data = {}) => {
	const engine = String(data.engine || "").toLowerCase();
	if (!["sqlite", "mysql"].includes(engine)) {
		throw new errs.ValidationError("Database target must be SQLite or MySQL/MariaDB");
	}
	if (engine === "sqlite") {
		return {
			version: 1,
			engine: "sqlite",
			shared: false,
			sqlite: { filename: normalizeSqliteFilename(data.sqlite?.filename) },
		};
	}
	return {
		version: 1,
		engine: "mysql",
		shared: Boolean(data.shared),
		mysql: normalizeMysql(data.mysql),
	};
};

const knexConfigFor = (config) => {
	if (config.engine === "sqlite") {
		return {
			client: "better-sqlite3",
			connection: { filename: config.sqlite.filename },
			useNullAsDefault: true,
			pool: { min: 1, max: 1 },
		};
	}
	const mysql = config.mysql;
	return {
		client: "mysql2",
		connection: {
			host: mysql.host,
			port: mysql.port,
			user: mysql.user,
			password: mysql.password,
			database: mysql.name,
			connectTimeout: 7000,
			...(mysql.ssl
				? {
						ssl: {
							rejectUnauthorized: mysql.sslRejectUnauthorized,
							verifyIdentity: mysql.sslVerifyIdentity,
						},
					}
				: {}),
		},
		pool: { min: 0, max: 3 },
	};
};

const buildClient = (config) => knex(knexConfigFor(config));

const listTables = async (client) => {
	const clientName = client.client.config.client;
	if (clientName === "better-sqlite3" || clientName === "sqlite3") {
		const result = await client.raw(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
		);
		const rows = Array.isArray(result) ? result : result?.rows || [];
		return rows.map((row) => row.name).filter(Boolean);
	}
	if (clientName === "mysql2" || clientName === "mysql") {
		const [rows] = await client.raw("SHOW TABLES");
		return rows
			.map((row) => Object.values(row)[0])
			.filter(Boolean)
			.sort();
	}
	if (clientName === "pg") {
		const result = await client.raw(
			"SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename",
		);
		return (result.rows || []).map((row) => row.tablename);
	}
	throw new Error(`Unsupported database client: ${clientName}`);
};

const appTables = (tables) => tables.filter((name) => !["migrations", "migrations_lock", "shared_runtime"].includes(name));

const tableCounts = async (client, tables) => {
	const counts = {};
	for (const table of tables) {
		const row = await client(table).count({ count: "*" }).first();
		counts[table] = Number(row?.count || 0);
	}
	return counts;
};

const totalRows = (counts) => Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);

const migrationStatus = async (client) => {
	try {
		const current = await client.migrate.currentVersion({
			tableName: "migrations",
			directory: MIGRATIONS_DIR,
		});
		return current || "none";
	} catch {
		return "none";
	}
};

const inspectClient = async (client) => {
	await client.raw("SELECT 1");
	const tables = await listTables(client);
	const dataTables = appTables(tables);
	const counts = await tableCounts(client, dataTables);
	let sharedVersion = null;
	if (tables.includes("shared_runtime")) {
		const row = await client("shared_runtime").where({ id: SHARED_VERSION_KEY }).first();
		sharedVersion = row?.value ? String(row.value) : null;
	}
	return {
		reachable: true,
		npmSchema: tables.includes("user") && tables.includes("setting") && tables.includes("proxy_host"),
		tableCount: dataTables.length,
		rowCount: totalRows(counts),
		counts,
		migration: await migrationStatus(client),
		sharedVersion,
	};
};

const writeRuntimeConfig = (config) => {
	fs.mkdirSync("/data", { recursive: true, mode: 0o750 });
	const temp = `${RUNTIME_FILE}.${process.pid}.tmp`;
	fs.writeFileSync(temp, JSON.stringify(config, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
	fs.chmodSync(temp, 0o600);
	fs.renameSync(temp, RUNTIME_FILE);
};

const scheduleBackendRestart = () => {
	setTimeout(() => {
		logger.info("Restarting backend to activate the selected database");
		process.exit(0);
	}, 1200);
};

const connectionSignature = (config) => {
	if (config.engine === "sqlite") return `sqlite:${path.resolve(config.sqlite.filename)}`;
	return `mysql:${config.mysql.user}@${config.mysql.host}:${config.mysql.port}/${config.mysql.name}`;
};

const currentSignature = () => {
	const runtime = getDatabaseRuntime();
	if (isSqlite()) return `sqlite:${path.resolve(runtime.filename || "/data/database.sqlite")}`;
	if (isMysql()) return `mysql:${runtime.user}@${runtime.host}:${runtime.port || 3306}/${runtime.name}`;
	return engineName();
};

const normalizeRowForTarget = (row) => {
	const normalized = {};
	for (const [key, value] of Object.entries(row)) {
		if (value instanceof Date) {
			normalized[key] = value.toISOString().slice(0, 19).replace("T", " ");
		} else if (Buffer.isBuffer(value) || value === null || typeof value !== "object") {
			normalized[key] = value;
		} else {
			normalized[key] = JSON.stringify(value);
		}
	}
	return normalized;
};

const captureSource = async () => {
	return await db().transaction(async (trx) => {
		const tables = appTables(await listTables(trx));
		const rows = {};
		for (const table of tables) {
			rows[table] = await trx(table).select("*");
		}
		return { tables, rows };
	});
};

const prepareTargetSchema = async (target) => {
	await target.migrate.latest({
		tableName: "migrations",
		directory: MIGRATIONS_DIR,
	});
};

const copySnapshot = async (target, snapshot, replaceTarget) => {
	const targetTables = appTables(await listTables(target));
	const commonTables = snapshot.tables.filter((table) => targetTables.includes(table));
	const counts = await tableCounts(target, commonTables);
	if (totalRows(counts) > 0 && !replaceTarget) {
		throw new errs.ValidationError(
			"Target database already contains NPM Improved data. Enable Replace target data or use Join existing database instead.",
		);
	}

	await target.transaction(async (trx) => {
		for (const table of [...commonTables].reverse()) {
			await trx(table).del();
		}
		for (const table of commonTables) {
			const rows = snapshot.rows[table] || [];
			for (let offset = 0; offset < rows.length; offset += COPY_BATCH_SIZE) {
				const batch = rows.slice(offset, offset + COPY_BATCH_SIZE).map(normalizeRowForTarget);
				if (batch.length) await trx(table).insert(batch);
			}
		}
	});

	const copiedCounts = await tableCounts(target, commonTables);
	for (const table of commonTables) {
		if (copiedCounts[table] !== (snapshot.rows[table] || []).length) {
			throw new Error(
				`Database verification failed for ${table}: expected ${(snapshot.rows[table] || []).length}, copied ${copiedCounts[table]}`,
			);
		}
	}
	return copiedCounts;
};

const fingerprint = async () => {
	const parts = [];
	for (const table of FINGERPRINT_TABLES) {
		if (!(await db().schema.hasTable(table))) continue;
		const row = await db()(table)
			.count({ count: "*" })
			.max({ modified: "modified_on" })
			.first();
		parts.push(`${table}:${row?.count || 0}:${row?.modified || ""}`);
	}
	return parts.join("|");
};

const syncSharedJwtIdentity = async () => {
	if (!(await db().schema.hasTable("shared_runtime"))) return false;

	const now = new Date();
	const versionRow = await db()("shared_runtime").where({ id: SHARED_VERSION_KEY }).first();
	if (!versionRow) {
		await db()("shared_runtime").insert({
			id: SHARED_VERSION_KEY,
			value: currentVersion(),
			modified_on: now,
		});
	} else if (String(versionRow.value) !== currentVersion()) {
		logger.warn(
			`Shared MySQL cluster version differs: database=${versionRow.value}, local=${currentVersion()}. Coordinate upgrades across all nodes.`,
		);
		await db()("shared_runtime").where({ id: SHARED_VERSION_KEY }).update({
			value: currentVersion(),
			modified_on: now,
		});
	}

	const local = fs.readFileSync("/data/keys.json", "utf8").trim();
	const existing = await db()("shared_runtime").where({ id: SHARED_IDENTITY_KEY }).first();
	if (!existing) {
		try {
			await db()("shared_runtime").insert({
				id: SHARED_IDENTITY_KEY,
				value: local,
				modified_on: new Date(),
			});
			logger.info("Published shared MySQL JWT identity for other NPMi nodes");
			return false;
		} catch {
			// Another node may have won the first-start race. Read it below.
		}
	}
	const resolved = existing || (await db()("shared_runtime").where({ id: SHARED_IDENTITY_KEY }).first());
	if (!resolved?.value || String(resolved.value).trim() === local) return false;

	let parsed;
	try {
		parsed = JSON.parse(resolved.value);
		if (!parsed?.key || !parsed?.pub) throw new Error("Shared JWT identity is incomplete");
	} catch (err) {
		throw new Error(`Shared MySQL JWT identity is invalid: ${err.message}`);
	}
	const temp = `/data/keys.json.${process.pid}.tmp`;
	fs.writeFileSync(temp, JSON.stringify(parsed, null, 2), { mode: 0o600 });
	fs.chmodSync(temp, 0o600);
	fs.renameSync(temp, "/data/keys.json");
	logger.info("Adopted shared MySQL JWT identity; backend restart required");
	return true;
};

const recordSharedNodeHeartbeat = async () => {
	const id = getSharedNodeId();
	const value = JSON.stringify({
		id,
		name: os.hostname(),
		version: currentVersion(),
		last_seen: new Date().toISOString(),
	});
	const rowId = `node:${id}`;
	const existing = await db()("shared_runtime").where({ id: rowId }).first();
	if (existing) {
		await db()("shared_runtime").where({ id: rowId }).update({ value, modified_on: new Date() });
	} else {
		await db()("shared_runtime").insert({ id: rowId, value, modified_on: new Date() });
	}
};

const listSharedNodes = async () => {
	if (!(await db().schema.hasTable("shared_runtime"))) return [];
	const rows = await db()("shared_runtime").where("id", "like", "node:%").select("value", "modified_on");
	const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
	return rows
		.map((row) => {
			try {
				return JSON.parse(row.value);
			} catch {
				return null;
			}
		})
		.filter((row) => row && (!row.last_seen || Date.parse(row.last_seen) >= cutoff))
		.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
};

const pollSharedDatabase = async () => {
	if (refreshInProgress) return;
	refreshInProgress = true;
	try {
		await recordSharedNodeHeartbeat();
		const next = await fingerprint();
		if (lastFingerprint === null) {
			lastFingerprint = next;
			return;
		}
		if (next !== lastFingerprint) {
			lastFingerprint = next;
			logger.info("Shared MySQL configuration changed on another node; regenerating local Nginx state");
			await internalDisasterRecovery.regenerateNginx();
		}
	} catch (err) {
		logger.warn(`Shared MySQL watcher failed: ${err instanceof Error ? err.message : String(err)}`);
	} finally {
		refreshInProgress = false;
	}
};

const internalDatabaseManager = {
	status: async (access) => {
		await access.can("settings:update", "database");
		const runtime = sanitizeRuntime();
		const mysqlSharedMode = runtime.engine === "mysql" && runtime.shared;
		return {
			current: runtime,
			migrationInProgress,
			runtimeConfigPresent: fs.existsSync(RUNTIME_FILE),
			supportedTargets: ["sqlite", "mysql"],
			mysqlSharedMode,
			sharedNodes: mysqlSharedMode ? await listSharedNodes() : [],
			sharedModeRequirements: [
				"All NPM Improved nodes must use the same NPM Improved version.",
				"All nodes must be able to reach the same MySQL/MariaDB database.",
				"Certificate files must be available on every node. Use shared storage for /etc/letsencrypt and /data/custom_ssl, or another storage replication method.",
				"NPM Improved synchronizes JWT signing identity through the shared database so logins can work across nodes.",
				"Each node regenerates and reloads its own Nginx configuration when shared database changes are detected.",
			],
		};
	},

	testConnection: async (access, data) => {
		await access.can("settings:update", "database");
		const config = normalizeTarget(data);
		const client = buildClient(config);
		try {
			const inspection = await inspectClient(client);
			return {
				ok: true,
				engine: config.engine,
				shared: Boolean(config.shared),
				...inspection,
			};
		} catch (err) {
			throw new errs.ValidationError(
				`Could not connect to the target database: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			await client.destroy().catch(() => undefined);
		}
	},

	migrateAndSwitch: async (access, data) => {
		await access.can("settings:update", "database");
		if (data.confirmation !== "MIGRATE") {
			throw new errs.ValidationError('Type "MIGRATE" to confirm the database move');
		}
		if (migrationInProgress) {
			throw new errs.ValidationError("A database migration is already in progress");
		}
		const config = normalizeTarget(data);
		if (connectionSignature(config) === currentSignature()) {
			throw new errs.ValidationError("The selected target is already the active database");
		}

		migrationInProgress = true;
		const client = buildClient(config);
		try {
			await inspectClient(client);
			await prepareTargetSchema(client);
			const snapshot = await captureSource();
			const counts = await copySnapshot(client, snapshot, Boolean(data.replaceTarget));
			writeRuntimeConfig(config);
			const targetInspection = await inspectClient(client);
			logger.info(
				`Database migration completed: ${engineName()} -> ${config.engine}, rows=${totalRows(counts)}`,
			);
			scheduleBackendRestart();
			return {
				ok: true,
				restartScheduled: true,
				target: {
					engine: config.engine,
					shared: Boolean(config.shared),
					host: config.engine === "mysql" ? config.mysql.host : null,
					name: config.engine === "mysql" ? config.mysql.name : null,
					filename: config.engine === "sqlite" ? config.sqlite.filename : null,
				},
				copiedRows: totalRows(counts),
				counts,
				migration: targetInspection.migration,
				message: "Database copied and verified. NPM Improved is restarting its backend on the new database.",
			};
		} catch (err) {
			throw err instanceof errs.ValidationError
				? err
				: new errs.ValidationError(
						`Database migration failed. The current database was not changed: ${err instanceof Error ? err.message : String(err)}`,
					);
		} finally {
			migrationInProgress = false;
			await client.destroy().catch(() => undefined);
		}
	},

	joinExisting: async (access, data) => {
		await access.can("settings:update", "database");
		if (data.confirmation !== "CONNECT") {
			throw new errs.ValidationError('Type "CONNECT" to switch to an existing database');
		}
		if (migrationInProgress) {
			throw new errs.ValidationError("A database migration is already in progress");
		}
		const config = normalizeTarget(data);
		if (config.engine !== "mysql") {
			throw new errs.ValidationError("Join existing database is intended for a MySQL/MariaDB NPM Improved database");
		}
		const client = buildClient(config);
		try {
			const inspection = await inspectClient(client);
			if (!inspection.npmSchema || inspection.rowCount < 1) {
				throw new errs.ValidationError(
					"Target does not contain an existing NPM Improved database. Use Move current data instead.",
				);
			}
			if (inspection.sharedVersion && inspection.sharedVersion !== currentVersion()) {
				throw new errs.ValidationError(
					`Shared database belongs to NPM Improved ${inspection.sharedVersion}, but this node is ${currentVersion()}. Install the same NPM Improved version before joining.`,
				);
			}
			await prepareTargetSchema(client);
			writeRuntimeConfig(config);
			scheduleBackendRestart();
			return {
				ok: true,
				restartScheduled: true,
				target: {
					engine: "mysql",
					shared: Boolean(config.shared),
					host: config.mysql.host,
					name: config.mysql.name,
				},
				message: "Existing NPM Improved database accepted. The backend is restarting with that database.",
			};
		} finally {
			await client.destroy().catch(() => undefined);
		}
	},

	resetToDeployment: async (access, data) => {
		await access.can("settings:update", "database");
		if (data.confirmation !== "RESET") {
			throw new errs.ValidationError('Type "RESET" to return database selection to deployment configuration');
		}
		if (fs.existsSync(RUNTIME_FILE)) fs.rmSync(RUNTIME_FILE, { force: true });
		scheduleBackendRestart();
		return {
			ok: true,
			restartScheduled: true,
			message: "Runtime database selection removed. The backend is restarting using deployment environment settings.",
		};
	},

	writeGuard: (req, _res, next) => {
		if (!migrationInProgress || ["GET", "HEAD", "OPTIONS"].includes(req.method)) {
			next();
			return;
		}
		next(new errs.ValidationError("Configuration changes are temporarily paused while the database migration is running"));
	},

	initializeSharedMode: async () => {
		const runtime = sanitizeRuntime();
		if (runtime.engine !== "mysql" || !runtime.shared) return { enabled: false, restartRequired: false };

		if (await db().schema.hasTable("setting")) {
			await db()("setting").where({ id: "instance-sync" }).update({ value: "disabled" });
		}

		const restartRequired = await syncSharedJwtIdentity();
		return { enabled: true, restartRequired };
	},

	initWatcher: () => {
		if (watcherTimer) {
			clearInterval(watcherTimer);
			watcherTimer = null;
		}
		const runtime = sanitizeRuntime();
		if (runtime.engine !== "mysql" || !runtime.shared) {
			lastFingerprint = null;
			return;
		}
		const requested = Number.parseInt(process.env.NPM_SHARED_DB_POLL_SECONDS || String(DEFAULT_POLL_SECONDS), 10);
		const seconds = Math.min(POLL_SECONDS_MAX, Math.max(POLL_SECONDS_MIN, requested || DEFAULT_POLL_SECONDS));
		lastFingerprint = null;
		pollSharedDatabase().catch(() => undefined);
		watcherTimer = setInterval(() => pollSharedDatabase(), seconds * 1000);
		watcherTimer.unref?.();
		logger.info(`Shared MySQL watcher enabled (every ${seconds}s)`);
	},
};

export default internalDatabaseManager;

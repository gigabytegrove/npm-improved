import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import knex from "knex";
import db, { generateDbConfigFor } from "../db.js";
import errs from "../lib/error.js";
import { configGet, getDatabaseSource, isMysql, isSharedDatabase, isSqlite } from "../lib/config.js";
import {
	normalizeRuntimeDatabaseConfig,
	publicDatabaseConfig,
	runtimeDatabaseConfigFile,
	writeRuntimeDatabaseConfig,
} from "../lib/database-runtime-config.js";
import internalDisasterRecovery from "./disaster-recovery.js";
import internalSharedDatabase from "./shared-database.js";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const SQLITE_DEFAULT = "/data/database.sqlite";
let migrationInProgress = false;

const localMigrationNames = () =>
	fs
		.readdirSync(MIGRATIONS_DIR)
		.filter((name) => name.endsWith(".js"))
		.sort();

const latestMigrationName = () => localMigrationNames().at(-1) || null;

const activePublicConfig = () => publicDatabaseConfig({ database: configGet("database") });

const withExistingMysqlPassword = (input) => {
	if (String(input?.engine || "").toLowerCase() !== "mysql" || String(input?.password || "")) {
		return input;
	}
	const current = activePublicConfig();
	const probe = publicDatabaseConfig(
		normalizeRuntimeDatabaseConfig({
			...input,
			password: "__probe__",
		}),
	);
	if (sameMysqlDatabase(current, probe)) {
		return {
			...input,
			password: String(configGet("database")?.password || ""),
		};
	}
	return input;
};

const currentEngine = () => (isSqlite() ? "sqlite" : isMysql() ? "mysql" : configGet("database")?.engine || "unknown");

const createTarget = (normalized) => knex(generateDbConfigFor(normalized.database));

const inspectConnection = async (target) => {
	await target.raw("SELECT 1");
	const hasUser = await target.schema.hasTable("user");
	const hasMigrations = await target.schema.hasTable("migrations");
	let users = 0;
	let latestMigration = null;
	if (hasUser) {
		users = Number((await target("user").count({ count: "*" }).first())?.count || 0);
	}
	if (hasMigrations) {
		const row = await target("migrations").orderBy("id", "desc").first();
		latestMigration = row?.name || null;
	}
	return {
		reachable: true,
		hasNPMiSchema: hasUser && hasMigrations,
		hasNPMiData: users > 0,
		userCount: users,
		latestMigration,
		expectedMigration: latestMigrationName(),
		schemaCurrent: Boolean(latestMigration && latestMigration === latestMigrationName()),
	};
};

const sameMysqlDatabase = (left, right) => {
	if (left?.engine !== "mysql" || right?.engine !== "mysql") return false;
	return (
		String(left.host).toLowerCase() === String(right.host).toLowerCase() &&
		Number(left.port || 3306) === Number(right.port || 3306) &&
		String(left.name).toLowerCase() === String(right.name).toLowerCase()
	);
};

const verifySnapshotCounts = async (target, snapshot) => {
	const mismatches = [];
	for (const [table, rows] of Object.entries(snapshot)) {
		const actual = Number((await target(table).count({ count: "*" }).first())?.count || 0);
		const expected = Array.isArray(rows) ? rows.length : 0;
		if (actual !== expected) mismatches.push({ table, expected, actual });
	}
	if (mismatches.length) {
		throw new Error(
			"Database migration verification failed: " +
				mismatches.map((item) => `${item.table} expected ${item.expected}, found ${item.actual}`).join("; "),
		);
	}
	return true;
};

const resetSharedMetadata = async (target) => {
	for (const table of ["npmi_shared_node", "npmi_shared_file"]) {
		if (await target.schema.hasTable(table)) await target(table).del();
	}
	if (await target.schema.hasTable("npmi_shared_state")) {
		const existing = await target("npmi_shared_state").where({ id: 1 }).first();
		const value = {
			revision: 0,
			updated_on: null,
			updated_by: null,
			filesystem_hash: null,
			primary_node_id: null,
			primary_seen_on: null,
		};
		if (existing) await target("npmi_shared_state").where({ id: 1 }).update(value);
		else await target("npmi_shared_state").insert({ id: 1, ...value });
	}
};

const finalizeSqliteFile = (tempFilename, finalFilename) => {
	fs.mkdirSync(path.dirname(finalFilename), { recursive: true, mode: 0o750 });
	if (fs.existsSync(finalFilename)) {
		const suffix = new Date().toISOString().replace(/[:.]/g, "-");
		const previous = `${finalFilename}.previous-${suffix}`;
		fs.renameSync(finalFilename, previous);
	}
	fs.renameSync(tempFilename, finalFilename);
};

const sanitizeCandidate = (input) => {
	const normalized = normalizeRuntimeDatabaseConfig(input);
	return publicDatabaseConfig(normalized);
};

const internalDatabaseManager = {
	isMigrating: () => migrationInProgress,

	writeGuard: (req, _res, next) => {
		if (
			migrationInProgress &&
			!["GET", "HEAD", "OPTIONS"].includes(req.method) &&
			!req.path.startsWith("/database")
		) {
			next(new errs.ValidationError("Database migration is in progress. Configuration changes are temporarily paused."));
			return;
		}
		next();
	},

	status: async (access) => {
		await access.can("settings:update", "database");
		const current = activePublicConfig();
		return {
			engine: currentEngine(),
			source: getDatabaseSource(),
			configFile: runtimeDatabaseConfigFile,
			current,
			shared: isSharedDatabase(),
			sharedCluster: await internalSharedDatabase.status(),
			migrationInProgress,
			supportedTargets: ["sqlite", "mysql"],
			sqliteDefaultPath: SQLITE_DEFAULT,
		};
	},

	test: async (access, candidateInput) => {
		await access.can("settings:update", "database");
		let normalized;
		try {
			normalized = normalizeRuntimeDatabaseConfig(withExistingMysqlPassword(candidateInput));
		} catch (err) {
			throw new errs.ValidationError(err.message);
		}
		const target = createTarget(normalized);
		try {
			const inspection = await inspectConnection(target);
			return {
				ok: true,
				target: publicDatabaseConfig(normalized),
				...inspection,
			};
		} catch (err) {
			throw new errs.ValidationError(`Database connection failed: ${err.message}`);
		} finally {
			await target.destroy().catch(() => undefined);
		}
	},

	migrate: async (
		access,
		{
			target: targetInput,
			operation = "migrate",
			confirmation,
			nodeRole = "primary",
			nodeName = "",
			publicUrl = "",
		},
	) => {
		await access.can("settings:update", "database");
		if (migrationInProgress) throw new errs.ValidationError("A database migration is already in progress");
		if (!["migrate", "connect"].includes(operation)) {
			throw new errs.ValidationError("Database operation must be migrate or connect");
		}
		const expectedConfirmation = operation === "connect" ? "CONNECT" : "MIGRATE";
		if (confirmation !== expectedConfirmation) {
			throw new errs.ValidationError(`Type "${expectedConfirmation}" to confirm this database operation`);
		}

		let normalized;
		try {
			normalized = normalizeRuntimeDatabaseConfig(withExistingMysqlPassword(targetInput));
		} catch (err) {
			throw new errs.ValidationError(err.message);
		}
		const targetPublic = publicDatabaseConfig(normalized);
		if (operation === "connect" && (targetPublic.engine !== "mysql" || !targetPublic.shared)) {
			throw new errs.ValidationError("Joining an existing database requires Shared MySQL mode");
		}
		if (targetPublic.shared && targetPublic.engine !== "mysql") {
			throw new errs.ValidationError("Shared database mode is supported only with MySQL/MariaDB");
		}

		const current = activePublicConfig();
		const sameDatabase = sameMysqlDatabase(current, targetPublic);
		if (
			current.engine === "sqlite" &&
			targetPublic.engine === "sqlite" &&
			path.resolve(current.filename) === path.resolve(targetPublic.filename)
		) {
			throw new errs.ValidationError("The selected SQLite file is already the active database");
		}

		migrationInProgress = true;
		let target = null;
		let sqliteTemp = null;
		try {
			let workingNormalized = normalized;
			if (targetPublic.engine === "sqlite") {
				const finalFilename = targetPublic.filename || SQLITE_DEFAULT;
				sqliteTemp = `${finalFilename}.migration-${crypto.randomUUID()}`;
				workingNormalized = normalizeRuntimeDatabaseConfig({
					engine: "sqlite",
					filename: sqliteTemp,
				});
			}

			target = createTarget(workingNormalized);
			const before = await inspectConnection(target);

			if (operation === "connect") {
				if (!before.hasNPMiSchema || !before.hasNPMiData) {
					throw new errs.ValidationError(
						"The selected MySQL database does not contain an existing NPM Improved installation to join",
					);
				}
				if (!before.schemaCurrent) {
					throw new errs.ValidationError(
						`The shared database schema is not current for this NPM Improved build. Expected ${before.expectedMigration || "latest"}, found ${before.latestMigration || "none"}.`,
					);
				}
			} else if (!sameDatabase) {
				await target.migrate.latest({
					tableName: "migrations",
					directory: MIGRATIONS_DIR,
				});
				const snapshot = await internalDisasterRecovery.captureDatabaseMigrationSnapshot();
				await internalDisasterRecovery.replaceDatabaseMigrationSnapshot(target, snapshot);
				await verifySnapshotCounts(target, snapshot);
				await resetSharedMetadata(target);
			}

			await target.destroy();
			target = null;

			if (targetPublic.engine === "sqlite") {
				finalizeSqliteFile(sqliteTemp, targetPublic.filename || SQLITE_DEFAULT);
				sqliteTemp = null;
			}

			writeRuntimeDatabaseConfig(
				targetPublic.engine === "sqlite"
					? {
							engine: "sqlite",
							filename: targetPublic.filename || SQLITE_DEFAULT,
						}
					: {
							engine: "mysql",
							host: targetPublic.host,
							port: targetPublic.port,
							user: targetPublic.user,
							password: String(withExistingMysqlPassword(targetInput).password || ""),
							name: targetPublic.name,
							ssl: {
								enabled: Boolean(targetInput.ssl?.enabled ?? targetInput.ssl),
								rejectUnauthorized: targetInput.ssl?.rejectUnauthorized ?? true,
								verifyIdentity: targetInput.ssl?.verifyIdentity ?? true,
							},
							shared: targetPublic.shared,
						},
			);

			if (targetPublic.shared) {
				internalSharedDatabase.configureLocalNode({
					role: nodeRole,
					nodeName,
					publicUrl,
				});
			}

			setTimeout(() => process.exit(0), 1500).unref?.();
			return {
				ok: true,
				operation,
				target: targetPublic,
				restartRequired: true,
				message:
					operation === "connect"
						? "Database connection saved. NPM Improved will restart the backend and join the shared database."
						: "Database migration verified and saved. NPM Improved will restart the backend on the new database.",
			};
		} catch (err) {
			if (target) await target.destroy().catch(() => undefined);
			if (sqliteTemp && fs.existsSync(sqliteTemp)) fs.rmSync(sqliteTemp, { force: true });
			throw err instanceof errs.ValidationError
				? err
				: new errs.ValidationError(`Database migration failed: ${err.message}`);
		} finally {
			migrationInProgress = false;
		}
	},

	setSharedRole: async (access, data) => {
		await access.can("settings:update", "database");
		return internalSharedDatabase.setRole(data);
	},

	testCandidateShape: sanitizeCandidate,
};

export default internalDatabaseManager;

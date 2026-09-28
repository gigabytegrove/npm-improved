import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import pjson from "../package.json" with { type: "json" };
import db from "../db.js";
import errs from "../lib/error.js";
import { configGet } from "../lib/config.js";
import { createBackupEnvelope, openBackupEnvelope } from "../lib/backup-bundle.js";
import { renderProtectionPolicy } from "../lib/protection.js";
import accessListModel from "../models/access_list.js";
import accessListAuthModel from "../models/access_list_auth.js";
import accessListClientModel from "../models/access_list_client.js";
import authModel from "../models/auth.js";
import auditLogModel from "../models/audit-log.js";
import certificateModel from "../models/certificate.js";
import configRevisionModel from "../models/config_revision.js";
import deadHostModel from "../models/dead_host.js";
import proxyHostModel from "../models/proxy_host.js";
import redirectionHostModel from "../models/redirection_host.js";
import settingModel from "../models/setting.js";
import streamModel from "../models/stream.js";
import userModel from "../models/user.js";
import userPermissionModel from "../models/user_permission.js";
import internalAuditLog from "./audit-log.js";
import internalNginx from "./nginx.js";

const MAX_BUNDLE_BYTES = 512 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 384 * 1024 * 1024;

const TABLES = Object.freeze({
	configuration: [
		["setting", settingModel],
		["access_list", accessListModel],
		["access_list_auth", accessListAuthModel],
		["access_list_client", accessListClientModel],
		["certificate", certificateModel],
		["proxy_host", proxyHostModel],
		["redirection_host", redirectionHostModel],
		["dead_host", deadHostModel],
		["stream", streamModel],
		["config_revision", configRevisionModel],
	],
	cluster: [
		["user", userModel],
		["user_permission", userPermissionModel],
		["auth", authModel],
		["setting", settingModel],
		["access_list", accessListModel],
		["access_list_auth", accessListAuthModel],
		["access_list_client", accessListClientModel],
		["certificate", certificateModel],
		["proxy_host", proxyHostModel],
		["redirection_host", redirectionHostModel],
		["dead_host", deadHostModel],
		["stream", streamModel],
		["config_revision", configRevisionModel],
	],
	"disaster-recovery": [
		["user", userModel],
		["user_permission", userPermissionModel],
		["auth", authModel],
		["setting", settingModel],
		["access_list", accessListModel],
		["access_list_auth", accessListAuthModel],
		["access_list_client", accessListClientModel],
		["certificate", certificateModel],
		["proxy_host", proxyHostModel],
		["redirection_host", redirectionHostModel],
		["dead_host", deadHostModel],
		["stream", streamModel],
		["config_revision", configRevisionModel],
		["audit_log", auditLogModel],
	],
});

const FILE_ROOTS = Object.freeze({
	custom_nginx: "/data/nginx/custom",
	default_www: "/data/nginx/default_www",
	custom_ssl: "/data/custom_ssl",
	letsencrypt: "/etc/letsencrypt",
});

let restoreInProgress = false;

const toPlain = (row) => (typeof row?.toJSON === "function" ? row.toJSON() : structuredClone(row));

const captureDatabase = async (scope) => {
	const result = {};
	for (const [table, model] of TABLES[scope]) {
		const rows = await model.query().orderBy("id", "ASC");
		result[table] = rows.map(toPlain);
	}
	return result;
};

const captureEntry = (root, current, entries, state) => {
	if (!fs.existsSync(current)) return;
	const stat = fs.lstatSync(current);
	const relative = path.relative(root, current).split(path.sep).join("/");
	if (relative.startsWith("../") || path.isAbsolute(relative)) {
		throw new Error("Backup path escaped its allowed root");
	}

	if (stat.isSymbolicLink()) {
		entries.push({
			path: relative,
			type: "symlink",
			target: fs.readlinkSync(current),
			mode: stat.mode & 0o777,
		});
		return;
	}

	if (stat.isDirectory()) {
		if (relative) {
			entries.push({ path: relative, type: "directory", mode: stat.mode & 0o777 });
		}
		for (const name of fs.readdirSync(current)) {
			if (name === ".certbot.lock") continue;
			captureEntry(root, path.join(current, name), entries, state);
		}
		return;
	}

	if (!stat.isFile()) return;
	state.bytes += stat.size;
	if (state.bytes > MAX_CAPTURE_BYTES) {
		throw new Error("Backup filesystem payload exceeds the 384 MiB safety limit");
	}
	entries.push({
		path: relative,
		type: "file",
		mode: stat.mode & 0o777,
		data: fs.readFileSync(current).toString("base64"),
	});
};

const captureFilesystem = (scope) => {
	const roots = {};
	const state = { bytes: 0 };

	for (const [name, root] of Object.entries(FILE_ROOTS)) {
		// Cluster payloads synchronize the default-site template through the settings
		// table, then render it locally on each node so node variables identify the
		// server that actually answered. Never copy another node's rendered HTML.
		if (scope === "cluster" && name === "default_www") {
			roots[name] = [];
			continue;
		}
		const entries = [];
		captureEntry(root, root, entries, state);
		roots[name] = entries;
	}

	if (scope === "disaster-recovery") {
		for (const [name, filename] of [
			["jwt_keys", "/data/keys.json"],
			["recovery_access", "/data/recovery-access.json"],
			["cluster_secret", "/data/cluster-secret"],
		]) {
			if (!fs.existsSync(filename)) continue;
			const stat = fs.statSync(filename);
			state.bytes += stat.size;
			roots[name] = [{
				path: path.basename(filename),
				type: "file",
				mode: stat.mode & 0o777,
				data: fs.readFileSync(filename).toString("base64"),
			}];
		}
	}

	if (state.bytes > MAX_CAPTURE_BYTES) {
		throw new Error("Backup filesystem payload exceeds the 384 MiB safety limit");
	}

	return { roots, bytes: state.bytes };
};

const validateRelativePath = (value) => {
	if (typeof value !== "string") throw new Error("Backup filesystem entry path is invalid");
	if (!value || value === ".") return "";
	const normalized = path.posix.normalize(value);
	if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
		throw new Error("Backup contains an unsafe filesystem path");
	}
	return normalized;
};

const summarize = (bundle) => {
	const counts = {};
	for (const [name, rows] of Object.entries(bundle.database || {})) {
		counts[name] = Array.isArray(rows) ? rows.length : 0;
	}
	let filesystemEntries = 0;
	for (const entries of Object.values(bundle.filesystem?.roots || {})) {
		if (Array.isArray(entries)) filesystemEntries += entries.length;
	}
	return {
		formatVersion: bundle.format_version,
		scope: bundle.scope,
		createdAt: bundle.created_at,
		sourceVersion: bundle.source?.version || "unknown",
		sourceDatabase: bundle.source?.database || "unknown",
		counts,
		filesystemEntries,
		filesystemBytes: bundle.filesystem?.bytes || 0,
		containsAuthenticationState: ["cluster", "disaster-recovery"].includes(bundle.scope),
		requiresRestart: bundle.scope === "disaster-recovery",
	};
};

const validateBundle = (bundle) => {
	if (!["configuration", "cluster", "disaster-recovery"].includes(bundle?.scope)) {
		throw new Error("Backup scope is unsupported");
	}
	if (!bundle.database || typeof bundle.database !== "object") {
		throw new Error("Backup database payload is missing");
	}
	if (!bundle.filesystem?.roots || typeof bundle.filesystem.roots !== "object") {
		throw new Error("Backup filesystem payload is missing");
	}

	for (const [table] of TABLES[bundle.scope]) {
		if (!Array.isArray(bundle.database[table])) {
			throw new Error("Backup table is missing: " + table);
		}
	}

	for (const [rootName, entries] of Object.entries(bundle.filesystem.roots)) {
		if (![...Object.keys(FILE_ROOTS), "jwt_keys", "recovery_access", "cluster_secret"].includes(rootName) || !Array.isArray(entries)) {
			throw new Error("Backup contains an unsupported filesystem root");
		}
		for (const entry of entries) {
			validateRelativePath(entry.path);
			if (!["file", "directory", "symlink"].includes(entry.type)) {
				throw new Error("Backup contains an unsupported filesystem entry");
			}
			if (entry.type === "file" && typeof entry.data !== "string") {
				throw new Error("Backup file entry is missing data");
			}
			if (entry.type === "symlink" && typeof entry.target !== "string") {
				throw new Error("Backup symlink entry is invalid");
			}
		}
	}

	return summarize(bundle);
};

const databaseEngineName = () => {
	const cfg = configGet("database");
	if (cfg?.engine === "knex-native") return cfg.knex?.client || "sqlite";
	return cfg?.engine || "unknown";
};

const writeRows = async (trx, table, model, rows, ownerUserId = null) => {
	for (const input of rows) {
		const row = structuredClone(input);
		if (ownerUserId && Object.hasOwn(row, "owner_user_id")) {
			row.owner_user_id = ownerUserId;
		}
		if (table === "config_revision" && ownerUserId) {
			if (Object.hasOwn(row, "user_id")) row.user_id = ownerUserId;
			if (row.snapshot && typeof row.snapshot === "object" && Object.hasOwn(row.snapshot, "owner_user_id")) {
				row.snapshot.owner_user_id = ownerUserId;
			}
		}

		const instance = model.fromJson(row);
		const dbRow = typeof instance.$toDatabaseJson === "function"
			? instance.$toDatabaseJson()
			: instance.$formatDatabaseJson(row);
		await trx(table).insert(dbRow);
	}

	if (rows.length && db().client.config.client === "pg" && rows.some((row) => Number.isInteger(row.id))) {
		const maxId = Math.max(...rows.map((row) => Number(row.id) || 0));
		if (maxId > 0) {
			await trx.raw("SELECT setval(pg_get_serial_sequence(quote_ident(?), 'id'), ?, true)", [table, maxId]);
		}
	}
};

const replaceDatabase = async (snapshot, scope, ownerUserId = null) => {
	const tables = TABLES[scope];
	await db().transaction(async (trx) => {
		for (const [table] of [...tables].reverse()) {
			await trx(table).del();
		}
		for (const [table, model] of tables) {
			await writeRows(trx, table, model, snapshot[table] || [], ownerUserId);
		}
	});
};

const removePath = (target) => fs.rmSync(target, { recursive: true, force: true });

const restoreEntries = (root, entries) => {
	removePath(root);
	fs.mkdirSync(root, { recursive: true, mode: 0o750 });

	const directories = entries.filter((entry) => entry.type === "directory");
	const files = entries.filter((entry) => entry.type !== "directory");

	for (const entry of directories) {
		const relative = validateRelativePath(entry.path);
		const target = path.join(root, relative);
		fs.mkdirSync(target, { recursive: true, mode: entry.mode || 0o750 });
	}

	for (const entry of files) {
		const relative = validateRelativePath(entry.path);
		const target = path.join(root, relative);
		const resolved = path.resolve(target);
		const resolvedRoot = path.resolve(root);
		if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
			throw new Error("Backup filesystem entry escaped its restore root");
		}
		fs.mkdirSync(path.dirname(target), { recursive: true });
		if (entry.type === "file") {
			fs.writeFileSync(target, Buffer.from(entry.data, "base64"), { mode: entry.mode || 0o640 });
		} else if (entry.type === "symlink") {
			const linkTarget = path.resolve(path.dirname(target), entry.target);
			if (linkTarget !== resolvedRoot && !linkTarget.startsWith(resolvedRoot + path.sep)) {
				throw new Error("Backup symlink escaped its restore root");
			}
			fs.symlinkSync(entry.target, target);
		}
	}
};

const restoreFilesystem = (bundle) => {
	for (const [name, root] of Object.entries(FILE_ROOTS)) {
		restoreEntries(root, bundle.filesystem.roots[name] || []);
	}

	if (bundle.scope === "disaster-recovery") {
		for (const [rootName, filename] of [
			["jwt_keys", "/data/keys.json"],
			["recovery_access", "/data/recovery-access.json"],
			["cluster_secret", "/data/cluster-secret"],
		]) {
			const entry = bundle.filesystem.roots[rootName]?.find((item) => item.type === "file");
			if (entry) {
				fs.writeFileSync(filename, Buffer.from(entry.data, "base64"), { mode: 0o600 });
				fs.chmodSync(filename, 0o600);
			}
		}
	}
};

const snapshotLiveFilesystem = () => {
	const rollbackRoot = path.join("/data", "backups", ".restore-" + crypto.randomUUID());
	fs.mkdirSync(rollbackRoot, { recursive: true, mode: 0o700 });

	const sources = {
		nginx: "/data/nginx",
		custom_ssl: "/data/custom_ssl",
		letsencrypt: "/etc/letsencrypt",
		keys: "/data/keys.json",
		recovery_access: "/data/recovery-access.json",
		cluster_secret: "/data/cluster-secret",
	};
	for (const [name, source] of Object.entries(sources)) {
		if (fs.existsSync(source)) {
			fs.cpSync(source, path.join(rollbackRoot, name), {
				recursive: true,
				preserveTimestamps: true,
				dereference: false,
			});
		}
	}
	return rollbackRoot;
};

const restoreLiveFilesystemSnapshot = (rollbackRoot) => {
	const targets = {
		nginx: "/data/nginx",
		custom_ssl: "/data/custom_ssl",
		letsencrypt: "/etc/letsencrypt",
		keys: "/data/keys.json",
		recovery_access: "/data/recovery-access.json",
		cluster_secret: "/data/cluster-secret",
	};
	for (const [name, target] of Object.entries(targets)) {
		removePath(target);
		const source = path.join(rollbackRoot, name);
		if (fs.existsSync(source)) {
			fs.cpSync(source, target, {
				recursive: true,
				preserveTimestamps: true,
				dereference: false,
			});
		}
	}
};

const regenerateNginx = async () => {
	for (const dir of ["proxy_host", "redirection_host", "dead_host", "stream", "default_host"]) {
		const full = path.join("/data/nginx", dir);
		removePath(full);
		fs.mkdirSync(full, { recursive: true });
	}

	const protection = await settingModel.query().findById("http-protection");
	if (protection) {
		fs.mkdirSync("/data/nginx/protection", { recursive: true });
		fs.writeFileSync("/data/nginx/protection/policy.conf", renderProtectionPolicy(protection), {
			encoding: "utf8",
			mode: 0o640,
		});
	}

	const defaultSite = await settingModel.query().findById("default-site");
	if (defaultSite) {
		await internalNginx.generateConfig("default", defaultSite);
	}

	const groups = [
		["proxy_host", proxyHostModel],
		["redirection_host", redirectionHostModel],
		["dead_host", deadHostModel],
		["stream", streamModel],
	];

	for (const [hostType, model] of groups) {
		let query = model.query().where("is_deleted", 0).andWhere("enabled", 1);
		if (model.defaultAllowGraph) {
			query = query.allowGraph(model.defaultAllowGraph).withGraphFetched(model.defaultAllowGraph);
		}
		const rows = await query;
		for (const row of rows) {
			await internalNginx.generateConfig(hostType, row);
		}
	}

	await internalNginx.test();
	await internalNginx.reload();
};


const makePayload = (scope, database, filesystem) => ({
	scope,
	created_at: new Date().toISOString(),
	source: {
		product: "NPM Improved",
		version: pjson.version,
		database: databaseEngineName(),
		hostname: os.hostname(),
	},
	database,
	filesystem,
});

const writePreRestoreBackup = (scope, database, passphrase) => {
	const backupDir = "/data/backups";
	fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
	const payload = makePayload(scope, database, captureFilesystem(scope));
	const filename =
		"pre-restore-" +
		new Date().toISOString().replace(/[:.]/g, "-") +
		"-" +
		scope +
		".npmibak";
	const fullPath = path.join(backupDir, filename);
	fs.writeFileSync(fullPath, createBackupEnvelope(payload, passphrase), { mode: 0o600 });

	const retained = fs
		.readdirSync(backupDir)
		.filter((name) => name.startsWith("pre-restore-") && name.endsWith(".npmibak"))
		.map((name) => ({
			name,
			path: path.join(backupDir, name),
			mtime: fs.statSync(path.join(backupDir, name)).mtimeMs,
		}))
		.sort((a, b) => b.mtime - a.mtime);

	for (const stale of retained.slice(10)) {
		fs.rmSync(stale.path, { force: true });
	}

	return fullPath;
};

const parseUploadedBundle = (file, passphrase) => {
	const buffer = file?.data;
	if (!Buffer.isBuffer(buffer) || !buffer.length) {
		throw new errs.ValidationError("Backup file is required");
	}
	if (buffer.length > MAX_BUNDLE_BYTES) {
		throw new errs.ValidationError("Backup file exceeds the 512 MiB upload limit");
	}
	try {
		const bundle = openBackupEnvelope(buffer, passphrase);
		validateBundle(bundle);
		return bundle;
	} catch (err) {
		throw new errs.ValidationError(err instanceof Error ? err.message : String(err));
	}
};


const captureClusterDatabase = async () => {
	const database = await captureDatabase("cluster");
	database.setting = (database.setting || []).filter((row) => row.id !== "instance-sync");
	return database;
};

const replaceClusterDatabase = async (snapshot) => {
	const localSyncSetting = await settingModel.query().findById("instance-sync");
	await replaceDatabase(snapshot, "cluster");
	if (localSyncSetting) {
		const plain = toPlain(localSyncSetting);
		const instance = settingModel.fromJson(plain);
		const dbRow = typeof instance.$toDatabaseJson === "function"
			? instance.$toDatabaseJson()
			: instance.$formatDatabaseJson(plain);
		await db()("setting").insert(dbRow);
	}
};

const applyClusterPayload = async (bundle) => {
	if (bundle.scope !== "cluster") {
		throw new Error("Cluster synchronization payload has the wrong scope");
	}

	const previousDatabase = await captureDatabase("cluster");
	const rollbackRoot = snapshotLiveFilesystem();

	restoreInProgress = true;
	try {
		await replaceClusterDatabase(bundle.database);
		restoreFilesystem(bundle);
		await regenerateNginx();
		removePath(rollbackRoot);
		return {
			ok: true,
			scope: "cluster",
			restoredAt: new Date().toISOString(),
			source: bundle.source || {},
			summary: summarize(bundle),
		};
	} catch (err) {
		try {
			await replaceDatabase(previousDatabase, "cluster");
			restoreLiveFilesystemSnapshot(rollbackRoot);
			await internalNginx.test();
			await internalNginx.reload();
		} catch (rollbackErr) {
			err.rollbackError = rollbackErr;
		}
		throw err;
	} finally {
		restoreInProgress = false;
		removePath(rollbackRoot);
	}
};


const readScheduledBackupConfig = () => {
	const passphrase = process.env.NPM_BACKUP_PASSPHRASE || "";
	const requestedScope = process.env.NPM_BACKUP_SCOPE || "disaster-recovery";
	const scope = TABLES[requestedScope] ? requestedScope : "disaster-recovery";
	const intervalHoursRaw = Number.parseInt(process.env.NPM_BACKUP_INTERVAL_HOURS || "24", 10);
	const retentionRaw = Number.parseInt(process.env.NPM_BACKUP_RETENTION || "7", 10);
	const intervalHours = Number.isInteger(intervalHoursRaw) ? Math.min(Math.max(intervalHoursRaw, 1), 8760) : 24;
	const retention = Number.isInteger(retentionRaw) ? Math.min(Math.max(retentionRaw, 1), 365) : 7;

	return {
		enabled: passphrase.length >= 12,
		scope,
		intervalHours,
		retention,
		passphrase,
	};
};

const listRetainedBackups = () => {
	const backupDir = "/data/backups";
	if (!fs.existsSync(backupDir)) return [];
	return fs
		.readdirSync(backupDir)
		.filter((name) => name.endsWith(".npmibak"))
		.map((name) => {
			const fullPath = path.join(backupDir, name);
			const stat = fs.statSync(fullPath);
			return {
				name,
				size: stat.size,
				modifiedAt: stat.mtime.toISOString(),
				type: name.startsWith("scheduled-") ? "scheduled" : name.startsWith("pre-restore-") ? "pre-restore" : "manual",
				mtime: stat.mtimeMs,
			};
		})
		.sort((a, b) => b.mtime - a.mtime);
};

const createRetainedBackup = async ({ scope, passphrase, prefix = "scheduled", retention = 7 }) => {
	if (!TABLES[scope]) throw new Error("Backup scope is unsupported");
	const database = await captureDatabase(scope);
	const filesystem = captureFilesystem(scope);
	const payload = makePayload(scope, database, filesystem);
	const backupDir = "/data/backups";
	fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
	const filename =
		prefix +
		"-" +
		new Date().toISOString().replace(/[:.]/g, "-") +
		"-" +
		scope +
		".npmibak";
	const fullPath = path.join(backupDir, filename);
	fs.writeFileSync(fullPath, createBackupEnvelope(payload, passphrase), { mode: 0o600 });

	const retained = listRetainedBackups().filter((item) => item.type === prefix);
	for (const stale of retained.slice(retention)) {
		fs.rmSync(path.join(backupDir, stale.name), { force: true });
	}
	return {
		path: fullPath,
		name: filename,
		summary: summarize({ ...payload, format_version: 1 }),
	};
};


const performRestore = async ({ bundle, passphrase, currentUserId = null, access = null }) => {
	const rollbackScope = bundle.scope === "disaster-recovery" ? "disaster-recovery" : "configuration";
	const previousDatabase = await captureDatabase(rollbackScope);
	const safetyBackupPath = writePreRestoreBackup(rollbackScope, previousDatabase, passphrase);
	const rollbackRoot = snapshotLiveFilesystem();

	restoreInProgress = true;
	try {
		await replaceDatabase(
			bundle.database,
			bundle.scope,
			bundle.scope === "configuration" ? currentUserId : null,
		);
		restoreFilesystem(bundle);
		await regenerateNginx();

		removePath(rollbackRoot);
		if (access) {
			await internalAuditLog.add(access, {
				action: "restored",
				object_type: "disaster-recovery",
				object_id: 0,
				meta: {
					scope: bundle.scope,
					source_version: bundle.source?.version || "unknown",
					safety_backup_path: safetyBackupPath,
				},
			});
		}
		return {
			ok: true,
			scope: bundle.scope,
			restoredAt: new Date().toISOString(),
			restartRequired: bundle.scope === "disaster-recovery",
			safetyBackupPath,
			summary: summarize(bundle),
		};
	} catch (err) {
		try {
			await replaceDatabase(
				previousDatabase,
				rollbackScope,
				bundle.scope === "configuration" ? currentUserId : null,
			);
			restoreLiveFilesystemSnapshot(rollbackRoot);
			await internalNginx.test();
			await internalNginx.reload();
		} catch (rollbackErr) {
			err.rollbackError = rollbackErr;
		}
		throw err;
	} finally {
		restoreInProgress = false;
		removePath(rollbackRoot);
	}
};

const internalDisasterRecovery = {
	regenerateNginx,
	status: async (access) => {
		await access.can("settings:update", "disaster-recovery");
		const counts = {};
		for (const [table, model] of TABLES.configuration) {
			counts[table] = Number(await model.query().resultSize());
		}
		return {
			formatVersion: 1,
			database: databaseEngineName(),
			counts,
			scopes: ["configuration", "disaster-recovery"],
			encryptionRequired: true,
			minimumPassphraseLength: 12,
			restoreInProgress,
			automation: (() => {
				const config = readScheduledBackupConfig();
				const retained = listRetainedBackups().filter((item) => item.type === "scheduled");
				return {
					enabled: config.enabled,
					scope: config.scope,
					intervalHours: config.intervalHours,
					retention: config.retention,
					retainedCount: retained.length,
					latestBackup: retained[0] || null,
				};
			})(),
		};
	},

	createClusterEnvelope: async (passphrase) => {
		const database = await captureClusterDatabase();
		const filesystem = captureFilesystem("cluster");
		const payload = makePayload("cluster", database, filesystem);
		return {
			data: createBackupEnvelope(payload, passphrase),
			summary: summarize({ ...payload, format_version: 1 }),
		};
	},

	applyClusterEnvelope: async (buffer, passphrase) => {
		if (!Buffer.isBuffer(buffer) || !buffer.length) {
			throw new errs.ValidationError("Cluster synchronization payload is empty");
		}
		if (buffer.length > MAX_BUNDLE_BYTES) {
			throw new errs.ValidationError("Cluster synchronization payload exceeds the 512 MiB limit");
		}
		let bundle;
		try {
			bundle = openBackupEnvelope(buffer, passphrase);
			validateBundle(bundle);
		} catch (err) {
			throw new errs.ValidationError(err instanceof Error ? err.message : String(err));
		}
		return applyClusterPayload(bundle);
	},

	export: async (access, { scope, passphrase }) => {
		await access.can("settings:update", "disaster-recovery");
		if (!TABLES[scope]) throw new errs.ValidationError("Backup scope is unsupported");

		const database = await captureDatabase(scope);
		const filesystem = captureFilesystem(scope);
		const payload = makePayload(scope, database, filesystem);
		const data = createBackupEnvelope(payload, passphrase);
		const filename =
			"npm-improved-" +
			scope +
			"-" +
			new Date().toISOString().replace(/[:.]/g, "-") +
			".npmibak";
		await internalAuditLog.add(access, {
			action: "exported",
			object_type: "disaster-recovery",
			object_id: 0,
			meta: {
				scope,
				filename,
			},
		});
		return {
			data,
			filename,
			summary: summarize({ ...payload, format_version: 1 }),
		};
	},

	inspect: async (access, { file, passphrase }) => {
		await access.can("settings:update", "disaster-recovery");
		return validateBundle(parseUploadedBundle(file, passphrase));
	},

	runScheduledBackup: async () => {
		const config = readScheduledBackupConfig();
		if (!config.enabled) {
			return { enabled: false, skipped: true };
		}
		const result = await createRetainedBackup({
			scope: config.scope,
			passphrase: config.passphrase,
			prefix: "scheduled",
			retention: config.retention,
		});
		return {
			enabled: true,
			skipped: false,
			...result,
		};
	},

	getScheduledBackupConfig: () => {
		const config = readScheduledBackupConfig();
		return {
			enabled: config.enabled,
			scope: config.scope,
			intervalHours: config.intervalHours,
			retention: config.retention,
		};
	},

	restore: async (access, { file, passphrase, confirmation }) => {
		await access.can("settings:update", "disaster-recovery");
		if (confirmation !== "RESTORE") {
			throw new errs.ValidationError('Type "RESTORE" to confirm this destructive operation');
		}
		if (restoreInProgress) {
			throw new errs.ValidationError("A restore is already in progress");
		}

		const bundle = parseUploadedBundle(file, passphrase);
		return performRestore({
			bundle,
			passphrase,
			currentUserId: access.token.getUserId(1),
			access,
		});
	},

	restoreEmergencyFile: async ({ filename, passphrase, confirmation }) => {
		if (confirmation !== "RESTORE") {
			throw new errs.ValidationError('Type "RESTORE" to confirm this destructive operation');
		}
		if (restoreInProgress) {
			throw new errs.ValidationError("A restore is already in progress");
		}
		if (typeof filename !== "string" || !filename.endsWith(".npmibak") || !fs.existsSync(filename)) {
			throw new errs.ValidationError("Emergency backup file is missing");
		}
		const stat = fs.statSync(filename);
		if (!stat.isFile() || stat.size > MAX_BUNDLE_BYTES) {
			throw new errs.ValidationError("Emergency backup file is invalid or too large");
		}

		const bundle = parseUploadedBundle({ data: fs.readFileSync(filename) }, passphrase);
		if (bundle.scope !== "disaster-recovery") {
			throw new errs.ValidationError(
				"Native emergency restore only accepts full disaster-recovery backups",
			);
		}
		return performRestore({
			bundle,
			passphrase,
		});
	},
};

export default internalDisasterRecovery;

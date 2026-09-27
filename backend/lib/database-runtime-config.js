import fs from "node:fs";
import path from "node:path";

const CONFIG_FILE = process.env.NPM_DATABASE_CONFIG_FILE || "/data/database-config.json";
const SQLITE_CLIENT = "better-sqlite3";

const bool = (value, fallback = false) =>
	typeof value === "boolean" ? value : typeof value === "undefined" ? fallback : /^(1|true|yes|on)$/i.test(String(value));

const normalizePort = (value, fallback) => {
	const parsed = Number.parseInt(String(value ?? fallback), 10);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
		throw new Error("Database port must be between 1 and 65535");
	}
	return parsed;
};

const normalizeRuntimeDatabaseConfig = (input) => {
	if (!input || typeof input !== "object") throw new Error("Database configuration is invalid");
	const engine = String(input.engine || "").trim().toLowerCase();

	if (["sqlite", "better-sqlite3", "knex-native"].includes(engine)) {
		const filename = String(input.filename || input.knex?.connection?.filename || "/data/database.sqlite").trim();
		if (!filename || !path.isAbsolute(filename)) {
			throw new Error("SQLite database path must be an absolute path");
		}
		return {
			version: 1,
			database: {
				engine: "knex-native",
				knex: {
					client: SQLITE_CLIENT,
					connection: { filename },
					useNullAsDefault: true,
				},
				shared: false,
			},
		};
	}

	if (["mysql", "mysql2", "mariadb"].includes(engine)) {
		const host = String(input.host || "").trim();
		const user = String(input.user || "").trim();
		const name = String(input.name || input.database || "").trim();
		if (!host || !user || !name) {
			throw new Error("MySQL host, database name, and user are required");
		}
		const sslEnabled = bool(input.ssl?.enabled ?? input.ssl, false);
		const rejectUnauthorized = bool(input.ssl?.rejectUnauthorized, true);
		const verifyIdentity = bool(input.ssl?.verifyIdentity, true);
		return {
			version: 1,
			database: {
				engine: "mysql2",
				host,
				port: normalizePort(input.port, 3306),
				user,
				password: String(input.password || ""),
				name,
				ssl: sslEnabled ? { rejectUnauthorized, verifyIdentity } : false,
				shared: bool(input.shared, false),
			},
		};
	}

	throw new Error("Only SQLite and MySQL/MariaDB are supported by the in-app database wizard");
};

const readRuntimeDatabaseConfig = () => {
	if (!fs.existsSync(CONFIG_FILE)) return null;
	const raw = fs.readFileSync(CONFIG_FILE, "utf8");
	const parsed = JSON.parse(raw);
	const normalized = normalizeRuntimeDatabaseConfig(
		parsed?.database?.engine === "knex-native"
			? {
					engine: "sqlite",
					filename: parsed.database.knex?.connection?.filename,
				}
			: {
					engine: parsed?.database?.engine,
					host: parsed?.database?.host,
					port: parsed?.database?.port,
					user: parsed?.database?.user,
					password: parsed?.database?.password,
					name: parsed?.database?.name,
					ssl: parsed?.database?.ssl
						? {
								enabled: true,
								rejectUnauthorized: parsed.database.ssl.rejectUnauthorized,
								verifyIdentity: parsed.database.ssl.verifyIdentity,
							}
						: false,
					shared: parsed?.database?.shared,
				},
	);
	return normalized;
};

const writeRuntimeDatabaseConfig = (input) => {
	const normalized = normalizeRuntimeDatabaseConfig(input);
	fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true, mode: 0o750 });
	const temp = `${CONFIG_FILE}.${process.pid}.tmp`;
	fs.writeFileSync(temp, JSON.stringify(normalized, null, 2) + "\n", {
		encoding: "utf8",
		mode: 0o600,
	});
	fs.chmodSync(temp, 0o600);
	fs.renameSync(temp, CONFIG_FILE);
	return normalized;
};

const publicDatabaseConfig = (config) => {
	const db = config?.database || config;
	if (!db) return null;
	if (db.engine === "knex-native") {
		return {
			engine: "sqlite",
			filename: db.knex?.connection?.filename || "/data/database.sqlite",
			shared: false,
		};
	}
	return {
		engine: db.engine === "mysql2" ? "mysql" : db.engine,
		host: db.host,
		port: Number(db.port || 3306),
		user: db.user,
		name: db.name,
		ssl: Boolean(db.ssl),
		sslRejectUnauthorized: db.ssl ? db.ssl.rejectUnauthorized !== false : false,
		sslVerifyIdentity: db.ssl ? db.ssl.verifyIdentity !== false : false,
		shared: db.shared === true,
	};
};

const runtimeDatabaseConfigExists = () => fs.existsSync(CONFIG_FILE);

export {
	CONFIG_FILE as runtimeDatabaseConfigFile,
	normalizeRuntimeDatabaseConfig,
	publicDatabaseConfig,
	readRuntimeDatabaseConfig,
	runtimeDatabaseConfigExists,
	writeRuntimeDatabaseConfig,
};

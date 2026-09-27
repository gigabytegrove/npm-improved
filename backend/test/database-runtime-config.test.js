import assert from "node:assert/strict";
import test from "node:test";
import {
	normalizeRuntimeDatabaseConfig,
	publicDatabaseConfig,
} from "../lib/database-runtime-config.js";

test("normalizes SQLite database configuration", () => {
	const config = normalizeRuntimeDatabaseConfig({
		engine: "sqlite",
		filename: "/data/custom.sqlite",
	});

	assert.equal(config.database.engine, "knex-native");
	assert.equal(config.database.knex.client, "better-sqlite3");
	assert.equal(config.database.knex.connection.filename, "/data/custom.sqlite");
	assert.equal(config.database.shared, false);
});

test("normalizes shared MySQL configuration without exposing its password", () => {
	const config = normalizeRuntimeDatabaseConfig({
		engine: "mysql",
		host: "mysql.internal",
		port: 3307,
		name: "npm",
		user: "npm",
		password: "super-secret",
		shared: true,
		ssl: {
			enabled: true,
			rejectUnauthorized: true,
			verifyIdentity: true,
		},
	});

	assert.equal(config.database.engine, "mysql2");
	assert.equal(config.database.shared, true);
	assert.equal(config.database.ssl.rejectUnauthorized, true);

	const visible = publicDatabaseConfig(config);
	assert.equal(visible.engine, "mysql");
	assert.equal(visible.host, "mysql.internal");
	assert.equal(visible.shared, true);
	assert.equal(Object.hasOwn(visible, "password"), false);
});

test("rejects relative SQLite paths", () => {
	assert.throws(
		() =>
			normalizeRuntimeDatabaseConfig({
				engine: "sqlite",
				filename: "database.sqlite",
			}),
		/absolute path/i,
	);
});

test("rejects incomplete MySQL settings", () => {
	assert.throws(
		() =>
			normalizeRuntimeDatabaseConfig({
				engine: "mysql",
				host: "mysql.internal",
				name: "npm",
			}),
		/host, database name, and user/i,
	);
});

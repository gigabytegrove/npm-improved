import { migrate as logger } from "../logger.js";

const migrateName = "shared-database-cluster";

const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	if (!(await knex.schema.hasTable("npmi_shared_state"))) {
		await knex.schema.createTable("npmi_shared_state", (table) => {
			table.integer("id").primary();
			table.bigInteger("revision").notNull().defaultTo(0);
			table.dateTime("updated_on").nullable();
			table.string("updated_by", 64).nullable();
			table.string("filesystem_hash", 64).nullable();
			table.string("primary_node_id", 64).nullable();
			table.dateTime("primary_seen_on").nullable();
		});
	}

	if (!(await knex.schema.hasTable("npmi_shared_file"))) {
		await knex.schema.createTable("npmi_shared_file", (table) => {
			table.increments().primary();
			table.string("root", 40).notNull();
			table.string("path", 380).notNull();
			table.string("type", 16).notNull();
			table.integer("mode").notNull().defaultTo(0);
			table.text("target").nullable();
			table.text("data", "longtext").nullable();
			table.string("sha256", 64).nullable();
			table.unique(["root", "path"]);
		});
	}

	if (!(await knex.schema.hasTable("npmi_shared_node"))) {
		await knex.schema.createTable("npmi_shared_node", (table) => {
			table.string("node_id", 64).primary();
			table.string("node_name", 100).notNull();
			table.string("role", 20).notNull();
			table.string("version", 64).nullable();
			table.string("build_commit", 128).nullable();
			table.string("public_url", 2048).nullable();
			table.bigInteger("last_applied_revision").notNull().defaultTo(0);
			table.dateTime("last_seen").notNull();
			table.text("last_error").nullable();
		});
	}

	const existing = await knex("npmi_shared_state").where({ id: 1 }).first();
	if (!existing) {
		await knex("npmi_shared_state").insert({
			id: 1,
			revision: 0,
			updated_on: null,
			updated_by: null,
			filesystem_hash: null,
			primary_node_id: null,
			primary_seen_on: null,
		});
	}

	logger.info(`[${migrateName}] Shared database cluster tables ready`);
};

const down = async (knex) => {
	logger.info(`[${migrateName}] Migrating Down...`);
	await knex.schema.dropTableIfExists("npmi_shared_node");
	await knex.schema.dropTableIfExists("npmi_shared_file");
	await knex.schema.dropTableIfExists("npmi_shared_state");
};

export { up, down };

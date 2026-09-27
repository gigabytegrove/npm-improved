import { migrate as logger } from "../logger.js";

const migrateName = "config-revision-history";

const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	await knex.schema.createTable("config_revision", (table) => {
		table.increments().primary();
		table.dateTime("created_on").notNull();
		table.dateTime("modified_on").notNull();
		table.integer("user_id").notNull().unsigned().defaultTo(0);
		table.string("object_type", 40).notNull();
		table.integer("object_id").notNull().unsigned().defaultTo(0);
		table.string("operation", 30).notNull();
		table.string("status", 20).notNull();
		table.text("config_text", "longtext").notNull();
		table.json("snapshot").notNull();
		table.text("error_text").nullable();
		table.json("meta").notNull();
		table.index(["object_type", "object_id"]);
		table.index(["status"]);
		table.index(["created_on"]);
	});

	logger.info(`[${migrateName}] config_revision Table created`);
};

const down = async (knex) => {
	logger.info(`[${migrateName}] Migrating Down...`);
	await knex.schema.dropTableIfExists("config_revision");
};

export { up, down };

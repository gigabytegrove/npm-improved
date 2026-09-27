import { migrate as logger } from "../logger.js";

const migrateName = "shared-runtime";

const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	const exists = await knex.schema.hasTable("shared_runtime");
	if (!exists) {
		await knex.schema.createTable("shared_runtime", (table) => {
			table.string("id", 100).primary();
			table.text("value", "longtext").notNull();
			table.dateTime("modified_on").notNull();
		});
	}

	logger.info(`[${migrateName}] Shared runtime table ready`);
};

const down = async (knex) => {
	logger.info(`[${migrateName}] Migrating Down...`);
	await knex.schema.dropTableIfExists("shared_runtime");
};

export { up, down };

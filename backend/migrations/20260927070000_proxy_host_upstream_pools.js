import { migrate as logger } from "../logger.js";

const migrateName = "proxy-host-upstream-pools";

const up = async (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);
	const hasUpstreams = await knex.schema.hasColumn("proxy_host", "upstreams");
	const hasMode = await knex.schema.hasColumn("proxy_host", "upstream_mode");

	if (!hasUpstreams || !hasMode) {
		await knex.schema.alterTable("proxy_host", (table) => {
			if (!hasUpstreams) table.json("upstreams").nullable();
			if (!hasMode) table.string("upstream_mode", 32).notNull().defaultTo("round-robin");
		});
	}
	logger.info(`[${migrateName}] Proxy host upstream pool columns ready`);
};

const down = async (knex) => {
	logger.info(`[${migrateName}] Migrating Down...`);
	await knex.schema.alterTable("proxy_host", (table) => {
		table.dropColumn("upstreams");
		table.dropColumn("upstream_mode");
	});
};

export { up, down };

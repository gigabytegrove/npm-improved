import fs from "node:fs";
import internalNginx from "./nginx.js";
import proxyHostModel from "../models/proxy_host.js";
import redirectionHostModel from "../models/redirection_host.js";
import deadHostModel from "../models/dead_host.js";
import { global as logger } from "../logger.js";

const ACME_INCLUDE = "include conf.d/include/letsencrypt-acme-challenge.conf;";

// An image upgrade changes the templates, but does not automatically replace
// host-specific .conf files persisted in /data. Refresh only hosts whose active
// config still lacks the cluster-aware ACME location or still uses the\n// legacy Analytics Center deny variables, which can block ACME requests. Each replacement uses the
// existing Nginx validation, rollback and reload transaction.
export const refreshAcmeHostConfigs = async () => {
	let attempted = 0;
	let updated = 0;
	const errors = [];
	for (const [model, type] of [
		[proxyHostModel, "proxy_host"],
		[redirectionHostModel, "redirection_host"],
		[deadHostModel, "dead_host"],
	]) {
		const rows = await model.query()
			.where("is_deleted", 0)
			.andWhere("enabled", 1)
			.allowGraph(model.defaultAllowGraph)
			.withGraphFetched(`[${model.defaultExpand.join(", ")}]`);
		for (const host of rows) {
			const filename = internalNginx.getConfigName(type, host.id);
			let current = "";
			try {
				current = fs.readFileSync(filename, "utf8");
			} catch (err) {
				if (err?.code !== "ENOENT") {
					errors.push(`${type}#${host.id}: ${err.message}`);
					continue;
				}
			}
			if (current.includes(ACME_INCLUDE) &&
				!current.includes("$npmi_analytics_block_ip") &&
				!current.includes("$npmi_analytics_block_ua")) continue;
			attempted++;
			try {
				await internalNginx.configure(model, type, host, {
					operation: "acme-template-upgrade",
					recordRevision: false,
				});
				updated++;
			} catch (err) {
				// Failure leaves last-known-good config in place; do not take a
				// production proxy offline solely to adopt the ACME enhancement.
				errors.push(`${type}#${host.id}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
	}
	if (attempted) logger.info(`ACME template refresh: updated ${updated}/${attempted} enabled host configs`);
	for (const message of errors) logger.error(`ACME template refresh failed: ${message}`);
	return { attempted, updated, errors };
};

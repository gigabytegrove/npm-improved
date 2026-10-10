import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const LIVE_CONFIG = /^([1-9][0-9]*)\.conf$/;
const QUARANTINE_DIR = "/data/nginx/orphan-quarantine";

/**
 * Orphaned .conf files must never be left active: Nginx may select one before
 * the real host and silently swallow SSL challenges, access lists or routing.
 *
 * Only numeric generated host configs are eligible, and only when the database
 * confirms there is no corresponding enabled, non-deleted row. Keep all
 * original bytes in a directory that is not included by Nginx.
 */
export const reconcileOrphanedHostConfigs = async ({
	groups,
	getConfigName,
	validate,
	reload,
	log = () => {},
	quarantineDir = QUARANTINE_DIR,
}) => {
	const result = { quarantined: [], skipped: [], errors: [] };
	for (const { type, model, directory } of groups) {
		let entries;
		try {
			entries = fs.readdirSync(directory, { withFileTypes: true });
		} catch (err) {
			if (err?.code === "ENOENT") continue;
			result.errors.push(`${type}: ${err.message}`);
			continue;
		}
		let active;
		try {
			const rows = await model.query().select("id")
				.where("is_deleted", 0).andWhere("enabled", 1);
			active = new Set(rows.map((row) => Number(row.id)));
		} catch (err) {
			// Never infer that a config is an orphan when the database is down.
			result.errors.push(`${type}: database query failed: ${err.message}`);
			continue;
		}

		for (const entry of entries) {
			const match = LIVE_CONFIG.exec(entry.name);
			if (!match || !entry.isFile()) continue;
			const id = Number(match[1]);
			if (!Number.isSafeInteger(id) || active.has(id)) continue;
			const livePath = path.join(directory, entry.name);
			if (getConfigName(type, id) !== livePath) {
				result.skipped.push(`${type}#${id}: path mismatch`);
				continue;
			}
			try {
				// Recheck right before changing the filesystem: configurations
				// can be created or reenabled after the initial DB scan.
				const row = await model.query().findById(id);
				if (row && !row.is_deleted && row.enabled) {
					result.skipped.push(`${type}#${id}: became active`);
					continue;
				}
				if (!fs.lstatSync(livePath).isFile()) continue;
				await validate();
				fs.mkdirSync(quarantineDir, { recursive: true, mode: 0o700 });
				const quarantinePath = path.join(
					quarantineDir,
					`${type}-${id}-${Date.now()}-${crypto.randomUUID()}.conf.bak`,
				);
				fs.renameSync(livePath, quarantinePath);
				try {
					await validate();
					await reload();
				} catch (err) {
					// Restore original host config and active Nginx state when
					// the candidate cannot validate or reload.
					fs.renameSync(quarantinePath, livePath);
					try {
						await validate();
						await reload();
					} catch (rollbackError) {
						log(`CRITICAL: orphan rollback failed for ${livePath}: ${rollbackError.message}`);
						throw new AggregateError([err, rollbackError], "Nginx orphan rollback failed");
					}
					throw err;
				}
				log(`Quarantined orphan Nginx config ${livePath} => ${quarantinePath}`);
				result.quarantined.push({ type, id, backup: quarantinePath });
			} catch (err) {
				result.errors.push(`${type}#${id}: ${err.message}`);
			}
		}
	}
	return result;
};

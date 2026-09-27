import db from "../db.js";
import { getDatabaseRuntime, isMysql } from "./config.js";

const isSharedMysql = () => isMysql() && Boolean(getDatabaseRuntime().shared);

const lockValue = (result) => {
	const rows = Array.isArray(result) ? result[0] : result;
	const row = Array.isArray(rows) ? rows[0] : rows;
	return Number(row?.acquired ?? row?.released ?? 0);
};

/**
 * MySQL advisory locks are connection-scoped. A Knex transaction pins one
 * connection for the lifetime of this callback, which lets NPMi serialize
 * maintenance work across several application servers using the same DB.
 */
const withSharedMysqlLock = async (name, callback, timeoutSeconds = 0) => {
	if (!isSharedMysql()) {
		return await callback();
	}

	return await db().transaction(async (trx) => {
		const acquired = lockValue(await trx.raw("SELECT GET_LOCK(?, ?) AS acquired", [name, timeoutSeconds]));
		if (acquired !== 1) {
			throw new Error(`Shared MySQL maintenance lock is busy: ${name}`);
		}
		try {
			return await callback();
		} finally {
			await trx.raw("SELECT RELEASE_LOCK(?) AS released", [name]).catch(() => undefined);
		}
	});
};

export { isSharedMysql, withSharedMysqlLock };

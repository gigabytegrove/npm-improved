import express from "express";
import internalDatabaseManager from "../internal/database-manager.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import validator from "../lib/validator/index.js";
import { debug, express as logger } from "../logger.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

router.use(jwtdecode());

const requireAdmin = async (res) => {
	await res.locals.access.can("settings:update", "database");
};

const mysqlProperties = {
	host: { type: "string", minLength: 1, maxLength: 255 },
	port: { type: "integer", minimum: 1, maximum: 65535 },
	user: { type: "string", minLength: 1, maxLength: 255 },
	password: { type: "string", maxLength: 4096 },
	name: { type: "string", minLength: 1, maxLength: 255 },
	ssl: { type: "boolean" },
	ssl_reject_unauthorized: { type: "boolean" },
	ssl_verify_identity: { type: "boolean" },
};

const targetSchema = {
	required: ["engine"],
	additionalProperties: false,
	properties: {
		engine: { type: "string", enum: ["sqlite", "mysql"] },
		shared: { type: "boolean" },
		sqlite: {
			type: "object",
			additionalProperties: false,
			properties: {
				filename: { type: "string", minLength: 1, maxLength: 1024 },
			},
		},
		mysql: {
			type: "object",
			additionalProperties: false,
			properties: mysqlProperties,
		},
		replace_target: { type: "boolean" },
		confirmation: { type: "string", maxLength: 32 },
	},
};

router.get("/status", async (_req, res, next) => {
	try {
		await requireAdmin(res);
		res.status(200).send(await internalDatabaseManager.status(res.locals.access));
	} catch (err) {
		next(err);
	}
});

router.post("/test", async (req, res, next) => {
	try {
		await requireAdmin(res);
		const data = await validator(targetSchema, req.body);
		res.status(200).send(await internalDatabaseManager.testConnection(res.locals.access, {
			engine: data.engine,
			shared: data.shared,
			sqlite: data.sqlite,
			mysql: data.mysql
				? {
						host: data.mysql.host,
						port: data.mysql.port,
						user: data.mysql.user,
						password: data.mysql.password,
						name: data.mysql.name,
						ssl: data.mysql.ssl,
						sslRejectUnauthorized: data.mysql.ssl_reject_unauthorized,
						sslVerifyIdentity: data.mysql.ssl_verify_identity,
					}
				: undefined,
		}));
	} catch (err) {
		debug(logger, `POST /database/test: ${err}`);
		next(err);
	}
});

router.post("/migrate", async (req, res, next) => {
	try {
		await requireAdmin(res);
		const data = await validator(targetSchema, req.body);
		res.status(200).send(await internalDatabaseManager.migrateAndSwitch(res.locals.access, {
			engine: data.engine,
			shared: data.shared,
			sqlite: data.sqlite,
			mysql: data.mysql
				? {
						host: data.mysql.host,
						port: data.mysql.port,
						user: data.mysql.user,
						password: data.mysql.password,
						name: data.mysql.name,
						ssl: data.mysql.ssl,
						sslRejectUnauthorized: data.mysql.ssl_reject_unauthorized,
						sslVerifyIdentity: data.mysql.ssl_verify_identity,
					}
				: undefined,
			replaceTarget: data.replace_target,
			confirmation: data.confirmation,
		}));
	} catch (err) {
		debug(logger, `POST /database/migrate: ${err}`);
		next(err);
	}
});

router.post("/join", async (req, res, next) => {
	try {
		await requireAdmin(res);
		const data = await validator(targetSchema, req.body);
		res.status(200).send(await internalDatabaseManager.joinExisting(res.locals.access, {
			engine: data.engine,
			shared: data.shared,
			mysql: data.mysql
				? {
						host: data.mysql.host,
						port: data.mysql.port,
						user: data.mysql.user,
						password: data.mysql.password,
						name: data.mysql.name,
						ssl: data.mysql.ssl,
						sslRejectUnauthorized: data.mysql.ssl_reject_unauthorized,
						sslVerifyIdentity: data.mysql.ssl_verify_identity,
					}
				: undefined,
			confirmation: data.confirmation,
		}));
	} catch (err) {
		debug(logger, `POST /database/join: ${err}`);
		next(err);
	}
});

router.post("/reset", async (req, res, next) => {
	try {
		await requireAdmin(res);
		const data = await validator(
			{
				required: ["confirmation"],
				additionalProperties: false,
				properties: {
					confirmation: { type: "string", maxLength: 32 },
				},
			},
			req.body,
		);
		res.status(200).send(await internalDatabaseManager.resetToDeployment(res.locals.access, data));
	} catch (err) {
		debug(logger, `POST /database/reset: ${err}`);
		next(err);
	}
});

export default router;

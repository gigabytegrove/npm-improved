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

const targetSchema = {
	type: "object",
	required: ["engine"],
	additionalProperties: false,
	properties: {
		engine: { type: "string", enum: ["sqlite", "mysql"] },
		filename: { type: "string", maxLength: 4096 },
		host: { type: "string", maxLength: 255 },
		port: { type: "integer", minimum: 1, maximum: 65535 },
		user: { type: "string", maxLength: 255 },
		password: { type: "string", maxLength: 4096 },
		name: { type: "string", maxLength: 255 },
		shared: { type: "boolean" },
		ssl: {
			type: "object",
			additionalProperties: false,
			properties: {
				enabled: { type: "boolean" },
				reject_unauthorized: { type: "boolean" },
				verify_identity: { type: "boolean" },
			},
		},
	},
};

const mapTarget = (target) => ({
	...target,
	ssl: target.ssl
		? {
				enabled: target.ssl.enabled,
				rejectUnauthorized: target.ssl.reject_unauthorized,
				verifyIdentity: target.ssl.verify_identity,
			}
		: false,
});

router.get("/status", async (_req, res, next) => {
	try {
		res.status(200).send(await internalDatabaseManager.status(res.locals.access));
	} catch (err) {
		debug(logger, `GET /database/status: ${err}`);
		next(err);
	}
});

router.post("/test", async (req, res, next) => {
	try {
		const data = await validator(
			{
				required: ["target"],
				additionalProperties: false,
				properties: { target: targetSchema },
			},
			req.body,
		);
		res.status(200).send(
			await internalDatabaseManager.test(res.locals.access, mapTarget(data.target)),
		);
	} catch (err) {
		debug(logger, `POST /database/test: ${err}`);
		next(err);
	}
});

router.post("/migrate", async (req, res, next) => {
	try {
		req.setTimeout(15 * 60 * 1000);
		const data = await validator(
			{
				required: ["target", "operation", "confirmation"],
				additionalProperties: false,
				properties: {
					target: targetSchema,
					operation: { type: "string", enum: ["migrate", "connect"] },
					confirmation: { type: "string", maxLength: 32 },
					node_role: { type: "string", enum: ["primary", "secondary"] },
					node_name: { type: "string", maxLength: 100 },
					public_url: { type: "string", maxLength: 2048 },
				},
			},
			req.body,
		);
		res.status(200).send(
			await internalDatabaseManager.migrate(res.locals.access, {
				target: mapTarget(data.target),
				operation: data.operation,
				confirmation: data.confirmation,
				nodeRole: data.node_role,
				nodeName: data.node_name,
				publicUrl: data.public_url,
			}),
		);
	} catch (err) {
		debug(logger, `POST /database/migrate: ${err}`);
		next(err);
	}
});

router.post("/shared/role", async (req, res, next) => {
	try {
		const data = await validator(
			{
				required: ["role"],
				additionalProperties: false,
				properties: {
					role: { type: "string", enum: ["primary", "secondary"] },
					force: { type: "boolean" },
					confirmation: { type: "string", maxLength: 32 },
				},
			},
			req.body,
		);
		res.status(200).send(
			await internalDatabaseManager.setSharedRole(res.locals.access, {
				role: data.role,
				force: data.force === true,
				confirmation: data.confirmation || "",
			}),
		);
	} catch (err) {
		debug(logger, `POST /database/shared/role: ${err}`);
		next(err);
	}
});

export default router;

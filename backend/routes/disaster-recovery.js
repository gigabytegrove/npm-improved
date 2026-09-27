import express from "express";
import internalDisasterRecovery from "../internal/disaster-recovery.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import validator from "../lib/validator/index.js";
import { debug, express as logger } from "../logger.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

const passphraseSchema = {
	type: "string",
	minLength: 12,
	maxLength: 1024,
};

router.use(jwtdecode());

router.get("/status", async (_req, res, next) => {
	try {
		res.status(200).send(await internalDisasterRecovery.status(res.locals.access));
	} catch (err) {
		debug(logger, `GET /disaster-recovery/status: ${err}`);
		next(err);
	}
});

router.post("/export", async (req, res, next) => {
	try {
		const data = await validator(
			{
				required: ["scope", "passphrase"],
				additionalProperties: false,
				properties: {
					scope: {
						type: "string",
						enum: ["configuration", "disaster-recovery"],
					},
					passphrase: passphraseSchema,
				},
			},
			req.body,
		);

		const result = await internalDisasterRecovery.export(res.locals.access, data);
		res.set({
			"Content-Type": "application/vnd.npm-improved.backup",
			"Content-Disposition": `attachment; filename="${result.filename}"`,
			"Content-Length": String(result.data.length),
			"X-NPM-Improved-Backup-Scope": data.scope,
		});
		res.status(200).send(result.data);
	} catch (err) {
		debug(logger, `POST /disaster-recovery/export: ${err}`);
		next(err);
	}
});

router.post("/inspect", async (req, res, next) => {
	try {
		if (!req.files?.backup) {
			res.status(400).send({ error: { code: 400, message: "Backup file is required" } });
			return;
		}
		const data = await validator(
			{
				required: ["passphrase"],
				additionalProperties: true,
				properties: {
					passphrase: passphraseSchema,
				},
			},
			req.body,
		);
		res.status(200).send(
			await internalDisasterRecovery.inspect(res.locals.access, {
				file: req.files.backup,
				passphrase: data.passphrase,
			}),
		);
	} catch (err) {
		debug(logger, `POST /disaster-recovery/inspect: ${err}`);
		next(err);
	}
});

router.post("/restore", async (req, res, next) => {
	try {
		req.setTimeout(15 * 60 * 1000);
		if (!req.files?.backup) {
			res.status(400).send({ error: { code: 400, message: "Backup file is required" } });
			return;
		}
		const data = await validator(
			{
				required: ["passphrase", "confirmation"],
				additionalProperties: true,
				properties: {
					passphrase: passphraseSchema,
					confirmation: {
						type: "string",
						const: "RESTORE",
					},
				},
			},
			req.body,
		);
		res.status(200).send(
			await internalDisasterRecovery.restore(res.locals.access, {
				file: req.files.backup,
				passphrase: data.passphrase,
				confirmation: data.confirmation,
			}),
		);
	} catch (err) {
		debug(logger, `POST /disaster-recovery/restore: ${err}`);
		next(err);
	}
});

export default router;

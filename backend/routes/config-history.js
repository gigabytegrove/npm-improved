import express from "express";
import internalConfigHistory from "../internal/config-history.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import validator from "../lib/validator/index.js";
import { debug, express as logger } from "../logger.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

const objectTypeSchema = {
	type: "string",
	enum: ["proxy_host", "redirection_host", "dead_host", "stream"],
};

const statusSchema = {
	type: "string",
	enum: ["pending", "active", "superseded", "failed"],
};

router
	.route("/")
	.options((_, res) => res.sendStatus(204))
	.all(jwtdecode())
	.get(async (req, res, next) => {
		try {
			const data = await validator(
				{
					additionalProperties: false,
					properties: {
						object_type: {
							anyOf: [{ type: "null" }, objectTypeSchema],
						},
						object_id: {
							anyOf: [{ type: "null" }, { type: "integer", minimum: 1 }],
						},
						status: {
							anyOf: [{ type: "null" }, statusSchema],
						},
						limit: {
							anyOf: [{ type: "null" }, { type: "integer", minimum: 1, maximum: 250 }],
						},
					},
				},
				{
					object_type: req.query.object_type || null,
					object_id: req.query.object_id || null,
					status: req.query.status || null,
					limit: req.query.limit || 100,
				},
			);
			res.status(200).send(await internalConfigHistory.list(res.locals.access, data));
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

router
	.route("/:revision_id")
	.options((_, res) => res.sendStatus(204))
	.all(jwtdecode())
	.get(async (req, res, next) => {
		try {
			const data = await validator(
				{
					required: ["revision_id"],
					additionalProperties: false,
					properties: {
						revision_id: {
							type: "integer",
							minimum: 1,
						},
					},
				},
				{
					revision_id: req.params.revision_id,
				},
			);
			res.status(200).send(
				await internalConfigHistory.get(res.locals.access, Number.parseInt(data.revision_id, 10)),
			);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

router
	.route("/:revision_id/restore")
	.options((_, res) => res.sendStatus(204))
	.all(jwtdecode())
	.post(async (req, res, next) => {
		try {
			const data = await validator(
				{
					required: ["revision_id"],
					additionalProperties: false,
					properties: {
						revision_id: {
							type: "integer",
							minimum: 1,
						},
					},
				},
				{
					revision_id: req.params.revision_id,
				},
			);
			res.status(200).send(
				await internalConfigHistory.restore(res.locals.access, Number.parseInt(data.revision_id, 10)),
			);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

export default router;

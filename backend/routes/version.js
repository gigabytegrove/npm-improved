import express from "express";
import internalRemoteVersion from "../internal/remote-version.js";
import internalUpdateManager from "../internal/update-manager.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import { debug, express as logger } from "../logger.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

/**
 * /api/version/check
 */
router
	.route("/check")
	.options((_, res) => {
		res.sendStatus(204);
	})

	/**
	 * GET /api/version/check
	 *
	 * Check for available updates
	 */
	.get(async (req, res, _next) => {
		try {
			const refresh = req.query.refresh === "1" || req.query.refresh === "true";
			const data = await internalRemoteVersion.get(refresh);
			res.status(200).send(data);
		} catch (error) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${error}`);
			// Send 200 even though there's an error to avoid triggering update checks repeatedly
			res.status(200).send({
				current: null,
				latest: null,
				update_available: false,
				release_name: null,
				release_notes: null,
				published_at: null,
				release_url: null,
			});
		}
	});

/**
 * GET /api/version/update
 * POST /api/version/update
 */
router
	.route("/update")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())
	.get(async (req, res, next) => {
		try {
			await res.locals.access.can("settings:get");
			const refresh = req.query.refresh === "1" || req.query.refresh === "true";
			const release = await internalRemoteVersion.get(refresh);
			res.status(200).send({
				release,
				capabilities: internalUpdateManager.capabilities(),
				status: internalUpdateManager.getStatus(),
			});
		} catch (err) {
			next(err);
		}
	})
	.post(async (req, res, next) => {
		try {
			const release = await internalRemoteVersion.get(true);
			const result = await internalUpdateManager.startUpdate(
				res.locals.access,
				release,
				req.body?.password,
			);
			res.status(202).send(result);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

/**
 * POST /api/version/update/rollback
 */
router
	.route("/update/rollback")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())
	.post(async (req, res, next) => {
		try {
			const result = await internalUpdateManager.rollback(res.locals.access, req.body?.password);
			res.status(202).send(result);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

/**
 * POST /api/version/update/restart
 */
router
	.route("/update/restart")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())
	.post(async (req, res, next) => {
		try {
			const result = await internalUpdateManager.restart(res.locals.access, req.body?.password);
			res.status(202).send(result);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

export default router;

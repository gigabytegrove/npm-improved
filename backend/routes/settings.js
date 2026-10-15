import express from "express";
import { getManagementCertificateStatus, requestManagementCertificate, releaseManagementCertificate } from "../lib/management-hostname-certificate.js";
import internalSetting from "../internal/setting.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import apiValidator from "../lib/validator/api.js";
import validator from "../lib/validator/index.js";
import { debug, express as logger } from "../logger.js";
import { getValidationSchema } from "../schema/index.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

/**
 * /api/settings
 */
router
	.route("/")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * GET /api/settings
	 *
	 * Retrieve all settings
	 */
	.get(async (req, res, next) => {
		try {
			const rows = await internalSetting.getAll(res.locals.access);
			res.status(200).send(rows);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

/**
 * Optional hostname certificate for the current physical node. No TLS
 * activation is performed; operators choose whether to configure HTTPS.
 */
router.route("/management-certificate")
    .options((_req, res) => res.sendStatus(204))
    .get(jwtdecode(), async (_req, res, next) => {
        try {
            res.status(200).send(await getManagementCertificateStatus(res.locals.access));
        } catch (err) { next(err); }
    })
    .post(jwtdecode(), async (req, res, next) => {
        try {
            if (!req.body || typeof req.body.hostname !== "string" ||
                Object.keys(req.body).some((key) => key !== "hostname")) {
                res.status(400).json({ error: { code: 400, message: "Specify only the management hostname." } });
                return;
            }
            req.setTimeout(900000);
            res.status(200).send(await requestManagementCertificate(res.locals.access, req.body.hostname));
        } catch (err) { next(err); }
    })
    .delete(jwtdecode(), async (_req, res, next) => {
        try { res.status(200).send(await releaseManagementCertificate(res.locals.access)); }
        catch (err) { next(err); }
    });

/**
 * Specific setting
 *
 * /api/settings/something
 */
router
	.route("/:setting_id")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * GET /settings/something
	 *
	 * Retrieve a specific setting
	 */
	.get(async (req, res, next) => {
		try {
			const data = await validator(
				{
					required: ["setting_id"],
					additionalProperties: false,
					properties: {
						setting_id: {
							type: "string",
							minLength: 1,
						},
					},
				},
				{
					setting_id: req.params.setting_id,
				},
			);
			const row = await internalSetting.get(res.locals.access, {
				id: data.setting_id,
			});
			res.status(200).send(row);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	})

	/**
	 * PUT /api/settings/something
	 *
	 * Update and existing setting
	 */
	.put(async (req, res, next) => {
		try {
			const payload = await apiValidator(getValidationSchema("/settings/{settingID}", "put"), req.body);
			payload.id = req.params.setting_id;
			const result = await internalSetting.update(res.locals.access, payload);
			res.status(200).send(result);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

export default router;

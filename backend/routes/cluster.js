import express from "express";
import internalInstanceSync from "../internal/instance-sync.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import validator from "../lib/validator/index.js";
import { debug, express as logger } from "../logger.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

// Node-to-node endpoints use the dedicated cluster secret rather than a user JWT.
router.get("/peer/status", internalInstanceSync.requirePeerAuth, async (_req, res, next) => {
	try {
		res.status(200).send(await internalInstanceSync.getPeerStatus());
	} catch (err) {
		debug(logger, `GET /cluster/peer/status: ${err}`);
		next(err);
	}
});

router.get("/peer/snapshot", internalInstanceSync.requirePeerAuth, async (_req, res, next) => {
	try {
		const result = await internalInstanceSync.createPeerSnapshot();
		res.set({
			"Content-Type": "application/vnd.npmi.cluster",
			"Content-Length": String(result.data.length),
			"Cache-Control": "no-store",
			"X-NPMi-Cluster-Version": "1",
		});
		res.status(200).send(result.data);
	} catch (err) {
		debug(logger, `GET /cluster/peer/snapshot: ${err}`);
		next(err);
	}
});

router.post("/peer/heartbeat", internalInstanceSync.requirePeerAuth, async (req, res, next) => {
	try {
		const data = await validator(
			{
				required: ["node_id", "node_name", "role", "version"],
				additionalProperties: false,
				properties: {
					node_id: { type: "string", minLength: 1, maxLength: 100 },
					node_name: { type: "string", minLength: 1, maxLength: 100 },
					public_url: { type: "string", maxLength: 2048 },
					role: { type: "string", enum: ["primary", "secondary"] },
					version: { type: "string", minLength: 1, maxLength: 64 },
					build_commit: { type: ["string", "null"], maxLength: 128 },
					last_sync: { type: ["string", "null"], maxLength: 64 },
				},
			},
			req.body,
		);
		res.status(200).send(await internalInstanceSync.recordHeartbeat(data, req.ip));
	} catch (err) {
		debug(logger, `POST /cluster/peer/heartbeat: ${err}`);
		next(err);
	}
});

// Administrative endpoints use normal NPMi authentication and permissions.
router.use(jwtdecode());

const requireAdmin = async (res) => {
	await res.locals.access.can("settings:update", "instance-sync");
};

router.get("/status", async (_req, res, next) => {
	try {
		await requireAdmin(res);
		res.status(200).send(await internalInstanceSync.getStatus());
	} catch (err) {
		next(err);
	}
});

router.put("/settings", async (req, res, next) => {
	try {
		await requireAdmin(res);
		const data = await validator(
			{
				additionalProperties: false,
				properties: {
					enabled: { type: "boolean" },
					nodeName: { type: "string", minLength: 1, maxLength: 100 },
					role: { type: "string", enum: ["primary", "secondary"] },
					publicUrl: { type: "string", maxLength: 2048 },
					primaryUrl: { type: "string", maxLength: 2048 },
					intervalSeconds: { type: "integer", minimum: 15, maximum: 3600 },
					sharedSecret: { type: "string", minLength: 24, maxLength: 1024 },
				},
			},
			req.body,
		);
		res.status(200).send(await internalInstanceSync.updateSettings(data));
	} catch (err) {
		debug(logger, `PUT /cluster/settings: ${err}`);
		next(err);
	}
});

router.post("/sync-now", async (_req, res, next) => {
	try {
		await requireAdmin(res);
		res.status(200).send(await internalInstanceSync.syncNow());
	} catch (err) {
		debug(logger, `POST /cluster/sync-now: ${err}`);
		next(err);
	}
});

router.post("/promote", async (_req, res, next) => {
	try {
		await requireAdmin(res);
		res.status(200).send(await internalInstanceSync.promote());
	} catch (err) {
		debug(logger, `POST /cluster/promote: ${err}`);
		next(err);
	}
});

export default router;

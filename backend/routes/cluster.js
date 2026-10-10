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

// Nginx public ACME ingress. It can only return a bounded opaque Certbot
// challenge token, never arbitrary filesystem content or an upstream response.
router.get("/acme/:token", async (req, res, next) => {
	try {
		const result = await internalInstanceSync.resolveAcmeChallenge(req.params.token);
		res.set({ "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" });
		res.status(result.status).send(result.value || "");
	} catch (err) {
		next(err);
	}
});

// Peer lookups are signed with the existing NPMX shared secret and nonce;
// only an enabled primary answers and no forwarding recursion is possible.
router.get("/npmx/acme/:token", internalInstanceSync.requireNpmxAuth, async (req, res, next) => {
	try {
		const result = await internalInstanceSync.getAuthenticatedAcmeChallenge(req.params.token);
		res.set({ "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" });
		res.status(result.status).send(result.value || "");
	} catch (err) {
		next(err);
	}
});

// NPMX pairing is authenticated by a short-lived one-time pairing token and
// an ephemeral X25519 key exchange. The persistent cluster secret is never
// returned in plaintext.
router.post("/npmx/pair", async (req, res, next) => {
	try {
		const data = await validator(
			{
				required: [
					"token_id",
					"node_id",
					"node_name",
					"version",
					"client_public_key",
					"timestamp",
					"nonce",
					"proof",
				],
				additionalProperties: false,
				properties: {
					token_id: { type: "string", minLength: 8, maxLength: 128 },
					node_id: { type: "string", minLength: 1, maxLength: 100 },
					node_name: { type: "string", minLength: 1, maxLength: 100 },
					public_url: { type: "string", maxLength: 2048 },
					version: { type: "string", minLength: 1, maxLength: 64 },
					build_commit: { type: ["string", "null"], maxLength: 128 },
					client_public_key: { type: "string", minLength: 32, maxLength: 512 },
					timestamp: { type: "string", minLength: 20, maxLength: 64 },
					nonce: { type: "string", minLength: 12, maxLength: 128 },
					proof: { type: "string", minLength: 32, maxLength: 256 },
				},
			},
			req.body,
		);
		res.status(200).send(await internalInstanceSync.acceptNpmxPairing(data, req.ip));
	} catch (err) {
		debug(logger, `POST /cluster/npmx/pair: ${err}`);
		next(err);
	}
});

// Normal NPMX node-to-node traffic is HMAC-signed with timestamp + nonce
// replay protection. The cluster secret itself is never sent as a header.
router.get("/npmx/status", internalInstanceSync.requireNpmxAuth, async (_req, res, next) => {
	try {
		res.status(200).send(await internalInstanceSync.getNpmxStatus());
	} catch (err) {
		debug(logger, `GET /cluster/npmx/status: ${err}`);
		next(err);
	}
});

router.get("/npmx/snapshot", internalInstanceSync.requireNpmxAuth, async (_req, res, next) => {
	try {
		const result = await internalInstanceSync.createPeerSnapshot();
		res.set({
			"Content-Type": "application/vnd.npmx.snapshot+octet-stream",
			"Content-Length": String(result.data.length),
			"Cache-Control": "no-store",
			"X-NPMX-Protocol": "npmx",
			"X-NPMX-Version": "1",
		});
		res.status(200).send(result.data);
	} catch (err) {
		debug(logger, `GET /cluster/npmx/snapshot: ${err}`);
		next(err);
	}
});

router.post("/npmx/heartbeat", internalInstanceSync.requireNpmxAuth, async (req, res, next) => {
	try {
		const data = await validator(
			{
				required: ["node_id", "node_name", "role", "version", "protocol", "protocol_version"],
				additionalProperties: false,
				properties: {
					node_id: { type: "string", minLength: 1, maxLength: 100 },
					node_name: { type: "string", minLength: 1, maxLength: 100 },
					public_url: { type: "string", maxLength: 2048 },
					role: { type: "string", enum: ["primary", "secondary"] },
					version: { type: "string", minLength: 1, maxLength: 64 },
					build_commit: { type: ["string", "null"], maxLength: 128 },
					last_sync: { type: ["string", "null"], maxLength: 64 },
					protocol: { type: "string", enum: ["npmx"] },
					protocol_version: { type: "integer", enum: [1] },
				},
			},
			req.body,
		);
		res.status(200).send(await internalInstanceSync.recordHeartbeat(data, req.ip));
	} catch (err) {
		debug(logger, `POST /cluster/npmx/heartbeat: ${err}`);
		next(err);
	}
});

// Signed, replay-protected NPMX operation relay. Only an enabled primary
// accepts mutations. The actor's identity is revalidated on the primary and
// normal endpoint permissions are enforced before any database writes.
router.post("/npmx/write", internalInstanceSync.requireNpmxAuth, async (req, res, next) => {
	try {
		const response = await internalInstanceSync.applyPeerMutation(req);
		res.status(200).send(response);
	} catch (err) {
		debug(logger, "POST /cluster/npmx/write: " + err);
		next(err);
	}
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

router.post("/npmx/pairing-code", async (req, res, next) => {
	try {
		await requireAdmin(res);
		const data = await validator(
			{
				additionalProperties: false,
				properties: {
					primary_url: { type: "string", maxLength: 2048 },
				},
			},
			req.body || {},
		);
		res.status(200).send(
			await internalInstanceSync.createPairingCode({
				primaryUrl: data.primary_url,
			}),
		);
	} catch (err) {
		debug(logger, `POST /cluster/npmx/pairing-code: ${err}`);
		next(err);
	}
});

router.post("/npmx/join", async (req, res, next) => {
	try {
		await requireAdmin(res);
		const data = await validator(
			{
				required: ["pairing_code"],
				additionalProperties: false,
				properties: {
					pairing_code: { type: "string", minLength: 32, maxLength: 8192 },
				},
			},
			req.body,
		);
		res.status(200).send(await internalInstanceSync.joinNpmxPairing(data.pairing_code));
	} catch (err) {
		debug(logger, `POST /cluster/npmx/join: ${err}`);
		next(err);
	}
});

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
					node_name: { type: "string", minLength: 1, maxLength: 100 },
					role: { type: "string", enum: ["primary", "secondary"] },
					public_url: { type: "string", maxLength: 2048 },
					primary_url: { type: "string", maxLength: 2048 },
					interval_seconds: { type: "integer", minimum: 15, maximum: 3600 },
					shared_secret: { type: "string", minLength: 24, maxLength: 1024 },
				},
			},
			req.body,
		);
		res.status(200).send(
			await internalInstanceSync.updateSettings({
				enabled: data.enabled,
				nodeName: data.node_name,
				role: data.role,
				publicUrl: data.public_url,
				primaryUrl: data.primary_url,
				intervalSeconds: data.interval_seconds,
				sharedSecret: data.shared_secret,
			}),
		);
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

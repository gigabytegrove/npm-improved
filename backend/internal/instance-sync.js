import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { latestPeerCheckin, latestSuccessfulPeerSync } from "../lib/npmx-sync-status.js";
import path from "node:path";
import { getDatabaseRuntime, isMysql } from "../lib/config.js";
import {
	NPMX_AUTH_WINDOW_SECONDS,
	NPMX_PAIRING_TTL_SECONDS,
	NPMX_PROTOCOL,
	NPMX_VERSION,
	createNpmxHeaders,
	createNpmxPairingCode,
	createNpmxPairingProof,
	createNpmxPairingResponseProof,
	decryptNpmxPairingSecret,
	deriveNpmxPairingKey,
	encryptNpmxPairingSecret,
	generateNpmxEphemeralKeyPair,
	generateNpmxNonce,
	generateNpmxSecret,
	generateNpmxTokenId,
	hashNpmxSecret,
	parseNpmxPairingCode,
	verifyNpmxPairingProof,
	verifyNpmxPairingResponseProof,
	verifyNpmxRequestSignature,
} from "../lib/npmx.js";
import errs from "../lib/error.js";
import { validAcmeToken, readLocalAcmeToken } from "../lib/acme-challenge.js";
import settingModel from "../models/setting.js";
import pjson from "../package.json" with { type: "json" };
import { global as logger } from "../logger.js";
import internalDisasterRecovery from "./disaster-recovery.js";
import db from "../db.js";
import { describeNpmxWrite, recordFingerprint } from "../lib/npmx-write-policy.js";
import {
	applyAuthorizedWrite,
	applyForwardedResponse,
	checkWriteBaseline,
	lockConfigurationWrite,
	validateLocalActor,
	validateMutationPayload,
} from "./npmx-mutation.js";

const SECRET_FILE = "/data/cluster-secret";
const PAIRING_FILE = "/data/npmx-pairing.json";
const SETTING_ID = "instance-sync";
const MIN_SECRET_LENGTH = 24;
const MIN_INTERVAL_SECONDS = 15;
const MAX_INTERVAL_SECONDS = 3600;
const REQUEST_TIMEOUT_MS = 15_000;
const SNAPSHOT_TIMEOUT_MS = 180_000;

let schedulerTimer = null;
let syncRunning = false;
const seenNpmxNonces = new Map();

const currentVersion = () => (process.env.NPM_BUILD_VERSION || pjson.version || "0.0.0").trim();

const sharedDatabaseMode = () => {
	const runtime = getDatabaseRuntime();
	return isMysql() && Boolean(runtime.shared);
};

const normalizeUrl = (value, label, required = false) => {
	const raw = String(value || "").trim();
	if (!raw) {
		if (required) throw new errs.ValidationError(`${label} is required`);
		return "";
	}
	let parsed;
	try {
		parsed = new URL(raw);
	} catch {
		throw new errs.ValidationError(`${label} must be a valid http or https URL`);
	}
	if (!["http:", "https:"].includes(parsed.protocol)) {
		throw new errs.ValidationError(`${label} must use http or https`);
	}
	parsed.hash = "";
	parsed.search = "";
	return parsed.toString().replace(/\/$/, "");
};

const readSecret = () => {
	try {
		const value = fs.readFileSync(SECRET_FILE, "utf8").trim();
		return value.length >= MIN_SECRET_LENGTH ? value : "";
	} catch {
		return "";
	}
};

const writeSecret = (value) => {
	const secret = String(value || "").trim();
	if (secret.length < MIN_SECRET_LENGTH) {
		throw new errs.ValidationError(`Cluster secret must be at least ${MIN_SECRET_LENGTH} characters`);
	}
	fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true, mode: 0o750 });
	const temp = `${SECRET_FILE}.${process.pid}.tmp`;
	fs.writeFileSync(temp, secret, { encoding: "utf8", mode: 0o600 });
	fs.chmodSync(temp, 0o600);
	fs.renameSync(temp, SECRET_FILE);
};

const ensureSecret = () => {
	const existing = readSecret();
	if (existing) return existing;
	const secret = generateNpmxSecret();
	writeSecret(secret);
	return secret;
};

const readPairingState = () => {
	try {
		const parsed = JSON.parse(fs.readFileSync(PAIRING_FILE, "utf8"));
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
};

const writePairingState = (value) => {
	const temp = `${PAIRING_FILE}.${process.pid}.tmp`;
	fs.mkdirSync(path.dirname(PAIRING_FILE), { recursive: true, mode: 0o750 });
	fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	fs.chmodSync(temp, 0o600);
	fs.renameSync(temp, PAIRING_FILE);
};

const timestampIsCurrent = (value, windowSeconds = NPMX_AUTH_WINDOW_SECONDS) => {
	const parsed = Date.parse(String(value || ""));
	return Number.isFinite(parsed) && Math.abs(Date.now() - parsed) <= windowSeconds * 1000;
};

const pruneNpmxNonces = () => {
	const cutoff = Date.now() - NPMX_AUTH_WINDOW_SECONDS * 1000;
	for (const [nonce, seenAt] of seenNpmxNonces.entries()) {
		if (seenAt < cutoff) seenNpmxNonces.delete(nonce);
	}
};

const npmxCapabilities = () => ({
	protocol: NPMX_PROTOCOL,
	protocol_version: NPMX_VERSION,
	snapshot_format: "cluster-envelope-v1",
	capabilities: [
		"capability-negotiation",
		"configuration",
		"certificates",
		"custom-nginx",
		"default-site-templates",
		"filesystem-assets",
		"heartbeat",
		"node-local-template-rendering",
		"primary-write-arbitration",
		"acme-http01-relay",
	],
});

const safeEqual = (left, right) => {
	if (!left || !right) return false;
	const leftHash = crypto.createHash("sha256").update(left).digest();
	const rightHash = crypto.createHash("sha256").update(right).digest();
	return crypto.timingSafeEqual(leftHash, rightHash);
};

const getRow = async () => {
	let row = await settingModel.query().findById(SETTING_ID);
	if (!row) {
		row = await settingModel.query().insertAndFetch({
			id: SETTING_ID,
			name: "Instance Synchronization",
			description: "Primary-secondary NPMi configuration synchronization",
			value: "disabled",
			meta: {
				node_id: crypto.randomUUID(),
				node_name: os.hostname(),
				role: "primary",
				public_url: "",
				primary_url: "",
				interval_seconds: 30,
				last_sync: null,
				last_attempt: null,
				last_error: null,
				primary_status: null,
				peers: [],
			},
		});
	}

	const meta = row.meta && typeof row.meta === "object" ? { ...row.meta } : {};
	let changed = false;
	const defaults = {
		node_id: crypto.randomUUID(),
		node_name: os.hostname(),
		role: "primary",
		public_url: "",
		primary_url: "",
		interval_seconds: 30,
		last_sync: null,
		last_attempt: null,
		last_error: null,
		primary_status: null,
		peers: [],
	};
	for (const [key, value] of Object.entries(defaults)) {
		if (typeof meta[key] === "undefined") {
			meta[key] = value;
			changed = true;
		}
	}
	if (!Array.isArray(meta.peers)) {
		meta.peers = [];
		changed = true;
	}
	// A secondary receives the primary's user table on first pairing/sync.
	// Tokens issued before this boundary could refer to a different user ID.
	// Record the boundary once, never on each normal snapshot refresh.
	if (row.value === "enabled" && meta.role === "secondary" && !meta.write_session_floor) {
		meta.write_session_floor = Math.ceil(Date.now() / 1000);
		changed = true;
	}
	if (changed) {
		await settingModel.query().findById(SETTING_ID).patch({ meta });
		row.meta = meta;
	}
	return row;
};

const updateMeta = async (patch) => {
	const row = await getRow();
	const meta = { ...(row.meta || {}), ...patch };
	await settingModel.query().findById(SETTING_ID).patch({ meta });
	return { ...row, meta };
};

const sanitizedStatus = async () => {
	const row = await getRow();
	const meta = row.meta || {};
	const sharedDatabase = sharedDatabaseMode();
	const peers = Array.isArray(meta.peers) ? meta.peers : [];
	const primary = meta.role === "primary";
	return {
		enabled: sharedDatabase ? false : row.value === "enabled",
		blockedBySharedDatabase: sharedDatabase,
		nodeId: meta.node_id,
		nodeName: meta.node_name,
		role: meta.role,
		publicUrl: meta.public_url || "",
		primaryUrl: meta.primary_url || "",
		intervalSeconds: meta.interval_seconds || 30,
		secretConfigured: Boolean(readSecret()),
		// A primary never pulls. Its successful sync timestamp is reported by
		// secondaries after the snapshot has been applied, NOT on pairing.
		lastSync: primary ? latestSuccessfulPeerSync(peers) : (meta.last_sync || null),
		lastAttempt: primary ? null : (meta.last_attempt || null),
		lastPeerCheckin: primary ? latestPeerCheckin(peers) : null,
		lastError: meta.last_error || null,
		lastHeartbeatError: meta.last_heartbeat_error || null,
		primaryStatus: meta.primary_status || null,
		peers,
		version: currentVersion(),
		buildCommit: process.env.NPM_BUILD_COMMIT || null,
		buildDate: process.env.NPM_BUILD_DATE || null,
		npmx: {
			...npmxCapabilities(),
			paired: Boolean(readSecret()),
		},
	};
};

const npmxRequest = async (baseUrl, secret, nodeId, endpoint, options = {}) => {
	const method = options.method || "GET";
	const body = options.body ?? null;
	const signaturePath = `/cluster/npmx${endpoint}`;
	const headers = {
		...createNpmxHeaders({
			secret,
			nodeId,
			method,
			path: signaturePath,
			body,
		}),
		"User-Agent": `NPMX/${NPMX_VERSION} NPM-Improved/${currentVersion()}`,
		...(body !== null ? { "Content-Type": "application/json" } : {}),
	};
	return fetchWithTimeout(
		`${baseUrl}/api/cluster/npmx${endpoint}`,
		{
			method,
			headers,
			...(body !== null ? { body: JSON.stringify(body) } : {}),
		},
		options.timeout || REQUEST_TIMEOUT_MS,
	);
};

const fetchWithTimeout = async (url, options = {}, timeout = REQUEST_TIMEOUT_MS) => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);
	try {
		return await fetch(url, { ...options, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
};

// HTTP-01 tokens are opaque, short-lived Certbot artifacts. Never use a
// request-supplied filesystem path; only these bounded token characters are allowed.
const internalInstanceSync = {
	getStatus: sanitizedStatus,

	// Public ingress reaches this handler through the local Nginx ACME location.
	// Secondary nodes relay only missing tokens to their paired primary using
	// the existing HMAC-signature, nonce and replay-protection machinery.
	resolveAcmeChallenge: async (token) => {
		if (!validAcmeToken(token)) return { status: 404 };
		const local = readLocalAcmeToken(token);
		if (local !== null) return { status: 200, value: local };
		const node = await sanitizedStatus();
		if (!node.enabled || node.role !== "secondary" || !node.secretConfigured || !node.primaryUrl) {
			return { status: 404 };
		}
		try {
			const response = await npmxRequest(
				normalizeUrl(node.primaryUrl, "Primary node URL", true),
				readSecret(),
				node.nodeId,
				`/acme/${token}`,
				{ timeout: 5000 },
			);
			if (response.status === 404) return { status: 404 };
			if (!response.ok) {
				logger.warn(`NPMX ACME relay failed: primary returned HTTP ${response.status}`);
				return { status: 503 };
			}
			const contentLength = Number(response.headers.get("content-length") || 0);
			if (contentLength > 4096) return { status: 502 };
			const value = await response.text();
			if (!value || Buffer.byteLength(value) > 4096) return { status: 502 };
			return { status: 200, value };
		} catch (err) {
			logger.warn(`NPMX ACME relay unavailable: ${err instanceof Error ? err.message : String(err)}`);
			return { status: 503 };
		}
	},

	// Authenticated peer endpoint: never search other peers or recurse.
	getAuthenticatedAcmeChallenge: async (token) => {
		if (!validAcmeToken(token)) return { status: 404 };
		const node = await sanitizedStatus();
		if (!node.enabled || node.role !== "primary") return { status: 403 };
		const value = readLocalAcmeToken(token);
		return value === null ? { status: 404 } : { status: 200, value };
	},

	updateSettings: async (data) => {
		if (sharedDatabaseMode() && data.enabled !== false) {
			throw new errs.ValidationError(
				"Instance Synchronization is not used when multiple NPM Improved nodes share the same MySQL database. Shared Database mode already keeps database state common between nodes.",
			);
		}
		const row = await getRow();
		const current = row.meta || {};
		const enabled = typeof data.enabled === "boolean" ? data.enabled : row.value === "enabled";
		const role = String(data.role || current.role || "primary");
		if (!["primary", "secondary"].includes(role)) {
			throw new errs.ValidationError("Instance sync role must be primary or secondary");
		}

		const intervalSeconds = Number.parseInt(data.intervalSeconds ?? current.interval_seconds ?? 30, 10);
		if (
			!Number.isInteger(intervalSeconds) ||
			intervalSeconds < MIN_INTERVAL_SECONDS ||
			intervalSeconds > MAX_INTERVAL_SECONDS
		) {
			throw new errs.ValidationError(
				`Sync interval must be between ${MIN_INTERVAL_SECONDS} and ${MAX_INTERVAL_SECONDS} seconds`,
			);
		}

		const nodeName = String(data.nodeName ?? current.node_name ?? os.hostname()).trim();
		if (!nodeName || nodeName.length > 100) {
			throw new errs.ValidationError("Node name must be between 1 and 100 characters");
		}

		const publicUrl = normalizeUrl(data.publicUrl ?? current.public_url, "Public URL", false);
		const primaryUrl = role === "secondary"
			? normalizeUrl(data.primaryUrl ?? current.primary_url, "Primary node URL", enabled)
			: "";

		if (typeof data.sharedSecret === "string" && data.sharedSecret.trim()) {
			// Legacy/manual configuration remains accepted for backwards compatibility,
			// but the UI uses NPMX one-time pairing and never asks users to create a secret.
			writeSecret(data.sharedSecret);
		}
		if (enabled && role === "primary") {
			ensureSecret();
		}
		if (enabled && role === "secondary" && !readSecret()) {
			throw new errs.ValidationError(
				"Pair this secondary with the primary using an NPMX pairing code before enabling synchronization",
			);
		}

		const meta = {
			...current,
			node_id: current.node_id || crypto.randomUUID(),
			node_name: nodeName,
			role,
			public_url: publicUrl,
			primary_url: primaryUrl,
			interval_seconds: intervalSeconds,
			last_error: null,
		};
		if (role === "primary") {
			meta.primary_status = null;
		}

		await settingModel.query().findById(SETTING_ID).patch({
			value: enabled ? "enabled" : "disabled",
			meta,
		});
		internalInstanceSync.reschedule(1000);
		return sanitizedStatus();
	},

	promote: async () => {
		if (sharedDatabaseMode()) {
			throw new errs.ValidationError("Shared MySQL nodes do not use primary/secondary database promotion");
		}
		const row = await getRow();
		const meta = {
			...(row.meta || {}),
			role: "primary",
			primary_url: "",
			primary_status: null,
			last_error: null,
		};
		await settingModel.query().findById(SETTING_ID).patch({ value: "enabled", meta });
		internalInstanceSync.reschedule(1000);
		return sanitizedStatus();
	},

	requirePeerAuth: async (req, _res, next) => {
		try {
			const configured = readSecret();
			const supplied = String(req.get("X-NPMi-Cluster-Secret") || "");
			if (!configured || !safeEqual(configured, supplied)) {
				throw new errs.TokenRevokedError("Invalid cluster credentials");
			}
			next();
		} catch (err) {
			next(err);
		}
	},

	getPeerStatus: async () => {
		const status = await sanitizedStatus();
		return {
			product: "NPM Improved",
			enabled: status.enabled,
			node_id: status.nodeId,
			node_name: status.nodeName,
			role: status.role,
			public_url: status.publicUrl,
			version: status.version,
			build_commit: status.buildCommit,
			build_date: status.buildDate,
			last_sync: status.lastSync,
			npmx: npmxCapabilities(),
		};
	},

	getNpmxStatus: async () => {
		const status = await sanitizedStatus();
		return {
			product: "NPM Improved",
			...npmxCapabilities(),
			enabled: status.enabled,
			node_id: status.nodeId,
			node_name: status.nodeName,
			role: status.role,
			public_url: status.publicUrl,
			version: status.version,
			build_commit: status.buildCommit,
			build_date: status.buildDate,
			last_sync: status.lastSync,
			sync_policy: {
				require_same_app_version: true,
				secondary_read_only: false,
				write_authority: "primary",
				conflict_handling: "stale-writes-rejected",
			},
		};
	},

	createPairingCode: async (data = {}) => {
		if (sharedDatabaseMode()) {
			throw new errs.ValidationError("Shared MySQL nodes do not use NPMX Primary/Secondary pairing");
		}
		const row = await getRow();
		const meta = row.meta || {};
		if ((meta.role || "primary") !== "primary") {
			throw new errs.ValidationError("Only a primary node can create an NPMX pairing code");
		}

		const primaryUrl = normalizeUrl(
			data.primaryUrl || meta.public_url,
			"Primary node URL",
			true,
		);
		const tokenId = generateNpmxTokenId();
		const tokenSecret = generateNpmxSecret();
		const expiresAt = new Date(Date.now() + NPMX_PAIRING_TTL_SECONDS * 1000).toISOString();

		ensureSecret();
		writePairingState({
			token_id: tokenId,
			token_secret_hash: hashNpmxSecret(tokenSecret),
			expires_at: expiresAt,
			used: false,
			created_at: new Date().toISOString(),
		});

		if (primaryUrl !== meta.public_url) {
			await updateMeta({ public_url: primaryUrl });
		}

		return {
			protocol: NPMX_PROTOCOL,
			protocolVersion: NPMX_VERSION,
			primaryUrl,
			expiresAt,
			pairingCode: createNpmxPairingCode({
				primaryUrl,
				tokenId,
				tokenSecret,
				expiresAt,
			}),
		};
	},

	acceptNpmxPairing: async (data, remoteAddress = null) => {
		if (sharedDatabaseMode()) {
			throw new errs.ValidationError("Shared MySQL nodes do not use NPMX Primary/Secondary pairing");
		}
		const state = readPairingState();
		if (
			!state.token_id ||
			state.token_id !== data.token_id ||
			state.used ||
			!state.expires_at ||
			Date.parse(state.expires_at) <= Date.now()
		) {
			throw new errs.TokenRevokedError("NPMX pairing code is invalid, expired, or already used");
		}
		if (!timestampIsCurrent(data.timestamp)) {
			throw new errs.TokenRevokedError("NPMX pairing request timestamp is outside the allowed window");
		}

		const proofDetails = {
			tokenId: data.token_id,
			nodeId: data.node_id,
			nodePublicKey: data.client_public_key,
			timestamp: data.timestamp,
			nonce: data.nonce,
		};
		if (!verifyNpmxPairingProof(state.token_secret_hash, proofDetails, data.proof)) {
			throw new errs.TokenRevokedError("NPMX pairing proof is invalid");
		}

		const row = await getRow();
		const meta = row.meta || {};
		if (row.value !== "enabled" || meta.role !== "primary") {
			await settingModel.query().findById(SETTING_ID).patch({
				value: "enabled",
				meta: { ...meta, role: "primary", last_error: null },
			});
		}

		const clusterSecret = ensureSecret();
		const ephemeral = generateNpmxEphemeralKeyPair();
		const key = deriveNpmxPairingKey({
			privateKey: ephemeral.privateKey,
			peerPublicKey: data.client_public_key,
			tokenSecretHash: state.token_secret_hash,
		});
		const aad = `${data.token_id}:${data.node_id}`;
		const encrypted = encryptNpmxPairingSecret(clusterSecret, key, aad);
		const timestamp = new Date().toISOString();
		const nonce = generateNpmxNonce();
		const responseDetails = {
			tokenId: data.token_id,
			nodeId: data.node_id,
			serverPublicKey: ephemeral.publicKey,
			...encrypted,
			timestamp,
			nonce,
		};

		writePairingState({
			...state,
			used: true,
			used_at: timestamp,
			paired_node_id: data.node_id,
			paired_remote_address: remoteAddress,
		});

		await internalInstanceSync.recordHeartbeat(
			{
				node_id: data.node_id,
				node_name: data.node_name,
				public_url: data.public_url || "",
				role: "secondary",
				version: data.version,
				build_commit: data.build_commit || null,
				last_sync: null,
				protocol: NPMX_PROTOCOL,
				protocol_version: NPMX_VERSION,
			},
			remoteAddress,
		);

		return {
			protocol: NPMX_PROTOCOL,
			protocol_version: NPMX_VERSION,
			token_id: data.token_id,
			node_id: data.node_id,
			server_public_key: ephemeral.publicKey,
			...encrypted,
			timestamp,
			nonce,
			proof: createNpmxPairingResponseProof(state.token_secret_hash, responseDetails),
			primary: await internalInstanceSync.getNpmxStatus(),
		};
	},

	joinNpmxPairing: async (pairingCode) => {
		if (sharedDatabaseMode()) {
			throw new errs.ValidationError("Shared MySQL nodes do not use NPMX Primary/Secondary pairing");
		}
		let parsed;
		try {
			parsed = parseNpmxPairingCode(pairingCode);
		} catch (err) {
			throw new errs.ValidationError(err instanceof Error ? err.message : String(err));
		}

		const row = await getRow();
		const meta = row.meta || {};
		const primaryUrl = normalizeUrl(parsed.url, "Primary node URL", true);
		const ephemeral = generateNpmxEphemeralKeyPair();
		const timestamp = new Date().toISOString();
		const nonce = generateNpmxNonce();
		const proofDetails = {
			tokenId: parsed.id,
			nodeId: meta.node_id,
			nodePublicKey: ephemeral.publicKey,
			timestamp,
			nonce,
		};
		const requestBody = {
			token_id: parsed.id,
			node_id: meta.node_id,
			node_name: meta.node_name || os.hostname(),
			public_url: meta.public_url || "",
			version: currentVersion(),
			build_commit: process.env.NPM_BUILD_COMMIT || null,
			client_public_key: ephemeral.publicKey,
			timestamp,
			nonce,
			proof: createNpmxPairingProof(parsed.token, proofDetails),
		};

		const response = await fetchWithTimeout(
			`${primaryUrl}/api/cluster/npmx/pair`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"User-Agent": `NPMX/${NPMX_VERSION} NPM-Improved/${currentVersion()}`,
				},
				body: JSON.stringify(requestBody),
			},
			REQUEST_TIMEOUT_MS,
		);
		if (!response.ok) {
			throw new errs.ValidationError(`Primary rejected NPMX pairing with HTTP ${response.status}`);
		}
		const payload = await response.json();
		if (payload.protocol !== NPMX_PROTOCOL || payload.protocol_version !== NPMX_VERSION) {
			throw new errs.ValidationError("Primary uses an incompatible NPMX protocol version");
		}

		const responseDetails = {
			tokenId: payload.token_id,
			nodeId: payload.node_id,
			serverPublicKey: payload.server_public_key,
			iv: payload.iv,
			tag: payload.tag,
			ciphertext: payload.ciphertext,
			timestamp: payload.timestamp,
			nonce: payload.nonce,
		};
		if (!verifyNpmxPairingResponseProof(parsed.token, responseDetails, payload.proof)) {
			throw new errs.ValidationError("Primary NPMX pairing response could not be authenticated");
		}

		const key = deriveNpmxPairingKey({
			privateKey: ephemeral.privateKey,
			peerPublicKey: payload.server_public_key,
			tokenSecret: parsed.token,
		});
		const secret = decryptNpmxPairingSecret(
			payload,
			key,
			`${parsed.id}:${meta.node_id}`,
		);
		writeSecret(secret);

		await settingModel.query().findById(SETTING_ID).patch({
			value: "enabled",
			meta: {
				...meta,
				role: "secondary",
				primary_url: primaryUrl,
				write_session_floor: Math.ceil(Date.now() / 1000),
				last_error: null,
				primary_status: payload.primary || null,
			},
		});
		internalInstanceSync.reschedule(1000);

		return {
			ok: true,
			protocol: NPMX_PROTOCOL,
			protocolVersion: NPMX_VERSION,
			primary: payload.primary,
			status: await sanitizedStatus(),
		};
	},

	requireNpmxAuth: async (req, _res, next) => {
		try {
			const secret = readSecret();
			if (!secret) throw new errs.TokenRevokedError("NPMX cluster credentials are not configured");
			if (
				String(req.get("X-NPMX-Protocol") || "").toLowerCase() !== NPMX_PROTOCOL ||
				Number.parseInt(req.get("X-NPMX-Version") || "0", 10) !== NPMX_VERSION
			) {
				throw new errs.TokenRevokedError("Unsupported NPMX protocol");
			}

			const nodeId = String(req.get("X-NPMX-Node") || "");
			const timestamp = String(req.get("X-NPMX-Timestamp") || "");
			const nonce = String(req.get("X-NPMX-Nonce") || "");
			const signature = String(req.get("X-NPMX-Signature") || "");
			if (!nodeId || !nonce || !timestampIsCurrent(timestamp)) {
				throw new errs.TokenRevokedError("Invalid NPMX request identity or timestamp");
			}

			pruneNpmxNonces();
			if (seenNpmxNonces.has(nonce)) {
				throw new errs.TokenRevokedError("NPMX request nonce has already been used");
			}

			const pathValue = `${req.baseUrl}${req.path}`;
			const valid = verifyNpmxRequestSignature(
				secret,
				{
					method: req.method,
					path: pathValue,
					nodeId,
					timestamp,
					nonce,
					body: ["GET", "HEAD"].includes(req.method) ? null : req.body ?? null,
				},
				signature,
			);
			if (!valid) throw new errs.TokenRevokedError("Invalid NPMX request signature");
			seenNpmxNonces.set(nonce, Date.now());
			req.npmxNodeId = nodeId;
			next();
		} catch (err) {
			next(err);
		}
	},


	/** A paired secondary submits a signed JSON mutation to the primary. */
	applyPeerMutation: async (req) => {
		const status = await sanitizedStatus();
		if (!status.enabled || status.role !== "primary") {
			throw new errs.ValidationError("Only the enabled primary accepts NPMX mutations");
		}
		if (req.body?.source_version !== currentVersion()) {
			throw new errs.ValidationError("NPMX write rejected: application versions differ");
		}
		if (!status.peers.some((peer) => peer.node_id === req.npmxNodeId)) {
			throw new errs.TokenRevokedError("NPMX write rejected: this node has not paired with the primary");
		}
		const data = validateMutationPayload(req.body);
		return applyAuthorizedWrite({
			method: data.method, path: data.path, query: data.query, body: data.body,
			actor_id: data.actor, actor_iat: data.issuedAt, expected_fingerprint: data.baseline,
		});
	},

	createPeerSnapshot: async () => {
		const status = await sanitizedStatus();
		if (!status.enabled || status.role !== "primary") {
			throw new errs.ValidationError("This node is not an enabled primary synchronization node");
		}
		const secret = readSecret();
		if (!secret) {
			throw new errs.ValidationError("Cluster secret is not configured");
		}
		return internalDisasterRecovery.createClusterEnvelope(secret);
	},

	recordHeartbeat: async (data, remoteAddress = null) => {
		const row = await getRow();
		const meta = row.meta || {};
		if (row.value !== "enabled" || meta.role !== "primary") {
			throw new errs.ValidationError("Heartbeats are accepted only by an enabled primary node");
		}
		const nodeId = String(data.node_id || "").trim();
		const nodeName = String(data.node_name || "").trim();
		if (!nodeId || !nodeName) {
			throw new errs.ValidationError("Heartbeat node identity is required");
		}
		const peers = Array.isArray(meta.peers) ? [...meta.peers] : [];
		const peer = {
			node_id: nodeId,
			node_name: nodeName.slice(0, 100),
			public_url: normalizeUrl(data.public_url, "Peer public URL", false),
			role: data.role === "primary" ? "primary" : "secondary",
			version: String(data.version || "unknown"),
			build_commit: data.build_commit || null,
			last_sync: data.last_sync || null,
			protocol: data.protocol || null,
			protocol_version: data.protocol_version || null,
			last_seen: new Date().toISOString(),
			remote_address: remoteAddress || null,
		};
		const index = peers.findIndex((item) => item.node_id === nodeId);
		if (index >= 0) peers[index] = peer;
		else peers.push(peer);

		const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
		meta.peers = peers
			.filter((item) => !item.last_seen || Date.parse(item.last_seen) >= cutoff)
			.sort((a, b) => String(a.node_name).localeCompare(String(b.node_name)));
		await settingModel.query().findById(SETTING_ID).patch({ meta });
		return { ok: true };
	},

	syncNow: async () => {
		if (syncRunning) {
			throw new errs.ValidationError("An instance synchronization is already running");
		}
		syncRunning = true;
		try {
			const status = await sanitizedStatus();
			if (!status.enabled) throw new errs.ValidationError("Instance synchronization is disabled");
			if (status.role !== "secondary") {
				throw new errs.ValidationError("Only a secondary node pulls configuration from a primary");
			}
			const secret = readSecret();
			if (!secret) throw new errs.ValidationError("Cluster secret is not configured");
			const primaryUrl = normalizeUrl(status.primaryUrl, "Primary node URL", true);
			const attempt = new Date().toISOString();
			await updateMeta({ last_attempt: attempt, last_error: null });

			const peerResponse = await npmxRequest(
				primaryUrl,
				secret,
				status.nodeId,
				"/status",
			);
			if (!peerResponse.ok) {
				throw new Error(`Primary NPMX status request failed with HTTP ${peerResponse.status}`);
			}
			const peer = await peerResponse.json();
			if (
				peer.protocol !== NPMX_PROTOCOL ||
				peer.protocol_version !== NPMX_VERSION ||
				!Array.isArray(peer.capabilities)
			) {
				throw new Error("Primary does not support a compatible NPMX protocol");
			}
			if (!peer.enabled || peer.role !== "primary") {
				throw new Error("Configured NPMX peer is not currently an enabled primary node");
			}
			if (!peer.capabilities.includes("configuration") || !peer.capabilities.includes("filesystem-assets")) {
				throw new Error("Primary NPMX capabilities cannot satisfy full instance synchronization");
			}
			if (String(peer.version) !== currentVersion()) {
				throw new Error(
					`NPMX negotiation refused snapshot sync because application versions differ: local ${currentVersion()}, primary ${peer.version || "unknown"}`,
				);
			}

			const snapshotResponse = await npmxRequest(
				primaryUrl,
				secret,
				status.nodeId,
				"/snapshot",
				{ timeout: SNAPSHOT_TIMEOUT_MS },
			);
			if (!snapshotResponse.ok) {
				throw new Error(`Primary snapshot request failed with HTTP ${snapshotResponse.status}`);
			}
			const contentLength = Number.parseInt(snapshotResponse.headers.get("content-length") || "0", 10);
			if (contentLength > 512 * 1024 * 1024) {
				throw new Error("Primary snapshot exceeds the 512 MiB safety limit");
			}
			const buffer = Buffer.from(await snapshotResponse.arrayBuffer());
			const result = await internalDisasterRecovery.applyClusterEnvelope(buffer, secret);
			const completed = new Date().toISOString();

			await updateMeta({
				last_sync: completed,
				last_attempt: attempt,
				last_error: null,
				primary_status: {
					node_id: peer.node_id,
					node_name: peer.node_name,
					public_url: peer.public_url || primaryUrl,
					version: peer.version,
					build_commit: peer.build_commit || null,
					last_seen: completed,
				},
			});

			const refreshed = await sanitizedStatus();
			const heartbeatBody = {
				node_id: refreshed.nodeId,
				node_name: refreshed.nodeName,
				public_url: refreshed.publicUrl,
				role: refreshed.role,
				version: refreshed.version,
				build_commit: refreshed.buildCommit,
				last_sync: refreshed.lastSync,
				protocol: NPMX_PROTOCOL,
				protocol_version: NPMX_VERSION,
			};
			// A successful snapshot apply is not reversed by a heartbeat failure,
			// but we must surface that telemetry failure (including HTTP errors)
			// rather than telling the operator both nodes were updated.
			let heartbeatWarning = null;
			try {
				const heartbeat = await npmxRequest(
					primaryUrl,
					secret,
					refreshed.nodeId,
					"/heartbeat",
					{ method: "POST", body: heartbeatBody },
				);
				if (!heartbeat.ok) {
					throw new Error(`Primary NPMX heartbeat rejected with HTTP ${heartbeat.status}`);
				}
			} catch (err) {
				heartbeatWarning = err instanceof Error ? err.message : String(err);
				logger.warn(`NPMX heartbeat failed after successful snapshot: ${heartbeatWarning}`);
			}
			await updateMeta({ last_heartbeat_error: heartbeatWarning });

			return {
				ok: true,
				syncedAt: completed,
				heartbeatWarning,
				primary: peer,
				summary: result.summary,
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			await updateMeta({
				last_attempt: new Date().toISOString(),
				last_error: message,
			}).catch(() => undefined);
			logger.warn(`NPMX synchronization failed: ${message}`);
			throw err instanceof errs.ValidationError
				? err
				: new errs.ValidationError(`NPMX synchronization failed: ${message}`);
		} finally {
			syncRunning = false;
		}
	},

	isSecondaryReadOnly: async () => {
		if (sharedDatabaseMode()) return false;
		const row = await getRow();
		return row.value === "enabled" && row.meta?.role === "secondary";
	},

	writeGuard: async (req, res, next) => {
		try {
			if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
			const prefixes = [
				"/nginx/", "/settings", "/users", "/disaster-recovery", "/config-history",
			];
			if (!prefixes.some((prefix) => req.path.startsWith(prefix))) return next();

			const descriptor = describeNpmxWrite(req.method, req.path);
			const row = await getRow();
			const secondary = !sharedDatabaseMode() && row.value === "enabled" && row.meta?.role === "secondary";
			if (!secondary) {
				// Only synchronized configuration needs a mutation lock.
				if (descriptor && row.value === "enabled" && row.meta?.role === "primary") {
					const release = await lockConfigurationWrite(res);
					try {
						if (!(await checkWriteBaseline(req, res, descriptor))) {
							release();
							return;
						}
					} catch (error) {
						release();
						throw error;
					}
				}
				return next();
			}
			if (!descriptor) {
				throw new errs.ValidationError(
					"This action cannot be safely forwarded through NPMX yet. Use the primary for this operation.",
				);
			}
			if (req.files && Object.keys(req.files).length) {
				throw new errs.ValidationError(
					"Multipart configuration uploads must be made on the primary until NPMX supports signed file transfer.",
				);
			}
			const secret = readSecret();
			if (!secret) throw new errs.ValidationError("NPMX pairing credentials are missing");
			const meta = row.meta || {};
			const primaryUrl = normalizeUrl(meta.primary_url, "Primary node URL", true);
			const selfId = String(meta.node_id || "");
			const authUserId = await validateLocalActor(res.locals.token);
			if (authUserId.issuedAt < Number(meta.write_session_floor || 0)) {
				throw new errs.ValidationError(
					"This sign-in predates NPMX pairing or the safe-write upgrade. Sign out and sign in again to make configuration changes.",
				);
			}
			const preflight = await npmxRequest(primaryUrl, secret, selfId, "/status");
			if (!preflight.ok) {
				throw new errs.ValidationError("Primary node is unavailable. Configuration was not changed.");
			}
			const peer = await preflight.json();
			if (!peer.enabled || peer.role !== "primary" ||
				peer.node_id === selfId || peer.version !== currentVersion() ||
				!peer.capabilities?.includes("primary-write-arbitration")) {
				throw new errs.ValidationError(
					"NPMX primary is not ready for conflict-safe writes. Both nodes must run a compatible release.",
				);
			}
			const baseline = await recordFingerprint(db(), descriptor);
			const queryAt = req.originalUrl.indexOf("?");
			const request = {
				source_version: currentVersion(),
				method: req.method,
				path: req.path,
				query: queryAt === -1 ? "" : req.originalUrl.slice(queryAt),
				body: req.body ?? {},
				actor_id: authUserId.id,
				actor_iat: authUserId.issuedAt,
				...(descriptor.key !== null ? { expected_fingerprint: baseline } : {}),
			};
			// Only the primary executes writes and assigns new database IDs.
			const response = await npmxRequest(primaryUrl, secret, selfId, "/write", {
				method: "POST", body: request, timeout: 125_000,
			});
			if (!response.ok) {
				const result = await response.json().catch(() => null);
				throw new errs.ValidationError(
					result?.error?.message || "Primary rejected the synchronized configuration edit.",
				);
			}
			const result = await response.json();
			if (result.status >= 200 && result.status < 300) {
				// Refresh this secondary promptly after the primary accepts the write.
				internalInstanceSync.reschedule(1000);
			}
			return applyForwardedResponse(res, result);
		} catch (err) {
			return next(err instanceof errs.ValidationError ? err :
				new errs.ValidationError(
					"Could not reach the NPMX primary; no local configuration changes were applied. " +
					(err instanceof Error ? err.message : String(err)),
				));
		}
	},

	reschedule: (delayMs = null) => {
		if (schedulerTimer) {
			clearTimeout(schedulerTimer);
			schedulerTimer = null;
		}
		const schedule = async () => {
			const status = await sanitizedStatus().catch((err) => {
				logger.error("Could not read instance synchronization settings:", err);
				return null;
			});
			const nextDelay = status
				? Math.max(MIN_INTERVAL_SECONDS, status.intervalSeconds || 30) * 1000
				: 60_000;

			if (status?.enabled && status.role === "secondary") {
				try {
					await internalInstanceSync.syncNow();
					logger.info(`Instance synchronization completed from ${status.primaryUrl}`);
				} catch (err) {
					logger.warn(`Instance synchronization failed: ${err instanceof Error ? err.message : String(err)}`);
				}
			}
			schedulerTimer = setTimeout(schedule, nextDelay);
		};
		schedulerTimer = setTimeout(schedule, delayMs ?? 30_000);
		schedulerTimer.unref?.();
	},

	initTimer: () => {
		if (sharedDatabaseMode()) {
			if (schedulerTimer) {
				clearTimeout(schedulerTimer);
				schedulerTimer = null;
			}
			logger.info("Instance Synchronization scheduler disabled because Shared MySQL mode is active");
			return;
		}
		internalInstanceSync.reschedule(30_000);
	},
};

export default internalInstanceSync;

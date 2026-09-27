import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import errs from "../lib/error.js";
import settingModel from "../models/setting.js";
import pjson from "../package.json" with { type: "json" };
import { global as logger } from "../logger.js";
import internalDisasterRecovery from "./disaster-recovery.js";

const SECRET_FILE = "/data/cluster-secret";
const SETTING_ID = "instance-sync";
const MIN_SECRET_LENGTH = 24;
const MIN_INTERVAL_SECONDS = 15;
const MAX_INTERVAL_SECONDS = 3600;
const REQUEST_TIMEOUT_MS = 15_000;
const SNAPSHOT_TIMEOUT_MS = 180_000;

let schedulerTimer = null;
let syncRunning = false;

const currentVersion = () => (process.env.NPM_BUILD_VERSION || pjson.version || "0.0.0").trim();

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
				interval_seconds: 60,
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
		interval_seconds: 60,
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
	return {
		enabled: row.value === "enabled",
		nodeId: meta.node_id,
		nodeName: meta.node_name,
		role: meta.role,
		publicUrl: meta.public_url || "",
		primaryUrl: meta.primary_url || "",
		intervalSeconds: meta.interval_seconds || 60,
		secretConfigured: Boolean(readSecret()),
		lastSync: meta.last_sync || null,
		lastAttempt: meta.last_attempt || null,
		lastError: meta.last_error || null,
		primaryStatus: meta.primary_status || null,
		peers: Array.isArray(meta.peers) ? meta.peers : [],
		version: currentVersion(),
		buildCommit: process.env.NPM_BUILD_COMMIT || null,
		buildDate: process.env.NPM_BUILD_DATE || null,
	};
};

const peerHeaders = (secret) => ({
	"X-NPMi-Cluster-Secret": secret,
	"User-Agent": `NPMi/${currentVersion()}`,
});

const fetchWithTimeout = async (url, options = {}, timeout = REQUEST_TIMEOUT_MS) => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);
	try {
		return await fetch(url, { ...options, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
};

const postHeartbeat = async (baseUrl, secret, status) => {
	try {
		const response = await fetchWithTimeout(`${baseUrl}/api/cluster/peer/heartbeat`, {
			method: "POST",
			headers: {
				...peerHeaders(secret),
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				node_id: status.nodeId,
				node_name: status.nodeName,
				public_url: status.publicUrl,
				role: status.role,
				version: status.version,
				build_commit: status.buildCommit,
				last_sync: status.lastSync,
			}),
		});
		if (!response.ok) {
			logger.warn(`Instance sync heartbeat returned HTTP ${response.status}`);
		}
	} catch (err) {
		logger.warn(`Instance sync heartbeat failed: ${err instanceof Error ? err.message : String(err)}`);
	}
};

const internalInstanceSync = {
	getStatus: sanitizedStatus,

	updateSettings: async (data) => {
		const row = await getRow();
		const current = row.meta || {};
		const enabled = typeof data.enabled === "boolean" ? data.enabled : row.value === "enabled";
		const role = String(data.role || current.role || "primary");
		if (!["primary", "secondary"].includes(role)) {
			throw new errs.ValidationError("Instance sync role must be primary or secondary");
		}

		const intervalSeconds = Number.parseInt(data.intervalSeconds ?? current.interval_seconds ?? 60, 10);
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
			writeSecret(data.sharedSecret);
		}
		if (enabled && !readSecret()) {
			throw new errs.ValidationError("Configure a cluster secret before enabling instance synchronization");
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
			product: "NPMi",
			enabled: status.enabled,
			node_id: status.nodeId,
			node_name: status.nodeName,
			role: status.role,
			public_url: status.publicUrl,
			version: status.version,
			build_commit: status.buildCommit,
			build_date: status.buildDate,
			last_sync: status.lastSync,
		};
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

			const peerResponse = await fetchWithTimeout(`${primaryUrl}/api/cluster/peer/status`, {
				headers: peerHeaders(secret),
			});
			if (!peerResponse.ok) {
				throw new Error(`Primary status request failed with HTTP ${peerResponse.status}`);
			}
			const peer = await peerResponse.json();
			if (!peer.enabled || peer.role !== "primary") {
				throw new Error("Configured primary is not currently an enabled primary node");
			}
			if (String(peer.version) !== currentVersion()) {
				throw new Error(
					`Cluster version mismatch: local ${currentVersion()}, primary ${peer.version || "unknown"}`,
				);
			}

			const snapshotResponse = await fetchWithTimeout(
				`${primaryUrl}/api/cluster/peer/snapshot`,
				{ headers: peerHeaders(secret) },
				SNAPSHOT_TIMEOUT_MS,
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
			await postHeartbeat(primaryUrl, secret, refreshed);

			return {
				ok: true,
				syncedAt: completed,
				primary: peer,
				summary: result.summary,
			};
		} catch (err) {
			await updateMeta({
				last_attempt: new Date().toISOString(),
				last_error: err instanceof Error ? err.message : String(err),
			}).catch(() => undefined);
			throw err;
		} finally {
			syncRunning = false;
		}
	},

	isSecondaryReadOnly: async () => {
		const row = await getRow();
		return row.value === "enabled" && row.meta?.role === "secondary";
	},

	writeGuard: async (req, _res, next) => {
		try {
			if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
				next();
				return;
			}
			if (!(await internalInstanceSync.isSecondaryReadOnly())) {
				next();
				return;
			}
			const guardedPrefixes = [
				"/nginx/",
				"/settings",
				"/users",
				"/disaster-recovery",
				"/config-history",
			];
			if (guardedPrefixes.some((prefix) => req.path.startsWith(prefix))) {
				throw new errs.ValidationError(
					"Secondary cluster nodes are read-only. Promote this node before changing synchronized configuration.",
				);
			}
			next();
		} catch (err) {
			next(err);
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
				? Math.max(MIN_INTERVAL_SECONDS, status.intervalSeconds || 60) * 1000
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
		internalInstanceSync.reschedule(30_000);
	},
};

export default internalInstanceSync;

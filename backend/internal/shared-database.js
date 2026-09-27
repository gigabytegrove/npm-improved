import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import db from "../db.js";
import pjson from "../package.json" with { type: "json" };
import errs from "../lib/error.js";
import { isSharedDatabase } from "../lib/config.js";
import { global as logger } from "../logger.js";
import internalDisasterRecovery from "./disaster-recovery.js";

const NODE_FILE = "/data/shared-database-node.json";
const POLL_MS = 5000;
const PRIMARY_LEASE_MS = 30_000;
const FILE_SAFETY_SCAN_MS = 30_000;

let timer = null;
let publishTimer = null;
let publishRunning = false;
let reconcileRunning = false;
let lastSafetyScan = 0;

const currentVersion = () => (process.env.NPM_BUILD_VERSION || pjson.version || "0.0.0").trim();

const atomicWriteJson = (filename, value) => {
	fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o750 });
	const temp = `${filename}.${process.pid}.tmp`;
	fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
	fs.chmodSync(temp, 0o600);
	fs.renameSync(temp, filename);
};

const readNode = () => {
	let node = null;
	try {
		node = JSON.parse(fs.readFileSync(NODE_FILE, "utf8"));
	} catch {
		// First use creates a local identity below.
	}
	if (!node || typeof node !== "object") node = {};
	const normalized = {
		version: 1,
		node_id: String(node.node_id || crypto.randomUUID()),
		node_name: String(node.node_name || os.hostname()).slice(0, 100),
		role: node.role === "secondary" ? "secondary" : "primary",
		public_url: String(node.public_url || "").slice(0, 2048),
		last_applied_revision: Number.parseInt(String(node.last_applied_revision || 0), 10) || 0,
		initialized: node.initialized === true,
		last_error: node.last_error ? String(node.last_error) : null,
	};
	if (!fs.existsSync(NODE_FILE) || JSON.stringify(node) !== JSON.stringify(normalized)) {
		atomicWriteJson(NODE_FILE, normalized);
	}
	return normalized;
};

const writeNode = (patch) => {
	const next = { ...readNode(), ...patch, version: 1 };
	atomicWriteJson(NODE_FILE, next);
	return next;
};

const stateRow = async (trx = db()) => {
	let row = await trx("npmi_shared_state").where({ id: 1 }).first();
	if (!row) {
		await trx("npmi_shared_state").insert({
			id: 1,
			revision: 0,
			updated_on: null,
			updated_by: null,
			filesystem_hash: null,
			primary_node_id: null,
			primary_seen_on: null,
		});
		row = await trx("npmi_shared_state").where({ id: 1 }).first();
	}
	return row;
};

const revisionNumber = (value) => Number.parseInt(String(value || 0), 10) || 0;

const primaryFresh = (row) => {
	if (!row?.primary_node_id || !row?.primary_seen_on) return false;
	const time = new Date(row.primary_seen_on).getTime();
	return Number.isFinite(time) && Date.now() - time < PRIMARY_LEASE_MS;
};

const registerNode = async (patch = {}) => {
	if (!isSharedDatabase()) return;
	const node = { ...readNode(), ...patch };
	const existing = await db()("npmi_shared_node").where({ node_id: node.node_id }).first();
	const row = {
		node_id: node.node_id,
		node_name: node.node_name,
		role: node.role,
		version: currentVersion(),
		build_commit: process.env.NPM_BUILD_COMMIT || null,
		public_url: node.public_url || "",
		last_applied_revision: node.last_applied_revision || 0,
		last_seen: new Date(),
		last_error: node.last_error || null,
	};
	if (existing) await db()("npmi_shared_node").where({ node_id: node.node_id }).update(row);
	else await db()("npmi_shared_node").insert(row);
};

const claimPrimary = async (force = false) => {
	const node = readNode();
	await db().transaction(async (trx) => {
		const row = await trx("npmi_shared_state").where({ id: 1 }).forUpdate().first();
		const activeOther =
			row?.primary_node_id &&
			row.primary_node_id !== node.node_id &&
			primaryFresh(row);
		if (activeOther && !force) {
			throw new errs.ValidationError(
				`Shared database primary is currently ${row.primary_node_id}. Wait for its lease to expire or use explicit failover promotion.`,
			);
		}
		await trx("npmi_shared_state").where({ id: 1 }).update({
			primary_node_id: node.node_id,
			primary_seen_on: new Date(),
		});
	});
};

const renewPrimaryLease = async () => {
	const node = readNode();
	if (node.role !== "primary") return false;
	const row = await stateRow();
	if (row.primary_node_id && row.primary_node_id !== node.node_id && primaryFresh(row)) {
		writeNode({ last_error: `Another active primary owns the shared database lease: ${row.primary_node_id}` });
		return false;
	}
	await db()("npmi_shared_state").where({ id: 1 }).update({
		primary_node_id: node.node_id,
		primary_seen_on: new Date(),
	});
	if (node.last_error?.includes("primary owns")) writeNode({ last_error: null });
	return true;
};

const filesystemHash = (filesystem) =>
	crypto.createHash("sha256").update(JSON.stringify(filesystem?.roots || {})).digest("hex");

const flattenFilesystem = (filesystem) => {
	const rows = [];
	for (const [root, entries] of Object.entries(filesystem?.roots || {})) {
		for (const entry of entries || []) {
			const data = entry.type === "file" ? String(entry.data || "") : null;
			rows.push({
				root,
				path: String(entry.path || ""),
				type: String(entry.type || "file"),
				mode: Number(entry.mode || 0),
				target: entry.type === "symlink" ? String(entry.target || "") : null,
				data,
				sha256: data ? crypto.createHash("sha256").update(data).digest("hex") : null,
			});
		}
	}
	return rows;
};

const inflateFilesystem = (rows) => {
	const roots = {
		custom_nginx: [],
		default_www: [],
		custom_ssl: [],
		letsencrypt: [],
		jwt_keys: [],
	};
	let bytes = 0;
	for (const row of rows) {
		if (!Object.hasOwn(roots, row.root)) continue;
		const entry = {
			path: row.path || "",
			type: row.type,
			mode: Number(row.mode || 0),
		};
		if (row.type === "file") {
			entry.data = row.data || "";
			bytes += Buffer.byteLength(entry.data, "base64");
		}
		if (row.type === "symlink") entry.target = row.target || "";
		roots[row.root].push(entry);
	}
	return { roots, bytes };
};

const publishNow = async ({ force = true } = {}) => {
	if (!isSharedDatabase() || publishRunning) return null;
	const node = readNode();
	if (node.role !== "primary") return null;
	if (!(await renewPrimaryLease())) {
		throw new errs.ValidationError("This node does not own the shared database primary lease");
	}

	publishRunning = true;
	try {
		const filesystem = internalDisasterRecovery.captureSharedFilesystem();
		const hash = filesystemHash(filesystem);
		const current = await stateRow();
		if (!force && current.filesystem_hash === hash) {
			await registerNode({ last_error: null });
			return { changed: false, revision: revisionNumber(current.revision) };
		}

		const rows = flattenFilesystem(filesystem);
		let nextRevision = 0;
		await db().transaction(async (trx) => {
			const locked = await trx("npmi_shared_state").where({ id: 1 }).forUpdate().first();
			if (
				locked?.primary_node_id &&
				locked.primary_node_id !== node.node_id &&
				primaryFresh(locked)
			) {
				throw new errs.ValidationError("Another node currently owns the shared database primary lease");
			}
			await trx("npmi_shared_file").del();
			for (const row of rows) {
				await trx("npmi_shared_file").insert(row);
			}
			nextRevision = revisionNumber(locked?.revision) + 1;
			await trx("npmi_shared_state").where({ id: 1 }).update({
				revision: nextRevision,
				updated_on: new Date(),
				updated_by: node.node_id,
				filesystem_hash: hash,
				primary_node_id: node.node_id,
				primary_seen_on: new Date(),
			});
		});
		writeNode({
			last_applied_revision: nextRevision,
			initialized: true,
			last_error: null,
		});
		await registerNode({ last_applied_revision: nextRevision, last_error: null });
		return { changed: true, revision: nextRevision };
	} finally {
		publishRunning = false;
	}
};

const markChanged = () => {
	if (!isSharedDatabase()) return;
	const node = readNode();
	if (node.role !== "primary") return;
	if (publishTimer) clearTimeout(publishTimer);
	publishTimer = setTimeout(() => {
		publishTimer = null;
		publishNow({ force: true }).catch((err) => {
			logger.error(`Shared database publish failed: ${err.message}`);
			writeNode({ last_error: err.message });
		});
	}, 600);
	publishTimer.unref?.();
};

const reconcileNow = async () => {
	if (!isSharedDatabase() || reconcileRunning) return null;
	const node = readNode();
	if (node.role !== "secondary") return null;

	reconcileRunning = true;
	try {
		const state = await stateRow();
		const revision = revisionNumber(state.revision);
		if (node.initialized && revision <= node.last_applied_revision) {
			await registerNode({ last_error: null });
			return { changed: false, revision };
		}

		const rows = await db()("npmi_shared_file").orderBy(["root", "path"]);
		const filesystem = inflateFilesystem(rows);
		const applied = await internalDisasterRecovery.applySharedFilesystem(filesystem);
		writeNode({
			last_applied_revision: revision,
			initialized: true,
			last_error: null,
		});
		await registerNode({ last_applied_revision: revision, last_error: null });
		if (applied.restartRequired) {
			logger.info("Shared database JWT identity changed; restarting backend to load the shared signing keys");
			setTimeout(() => process.exit(0), 750).unref?.();
		}
		return { changed: true, revision, restartRequired: applied.restartRequired };
	} catch (err) {
		writeNode({ last_error: err.message });
		await registerNode({ last_error: err.message }).catch(() => undefined);
		throw err;
	} finally {
		reconcileRunning = false;
	}
};

const status = async () => {
	if (!isSharedDatabase()) {
		return {
			enabled: false,
			role: null,
			nodeId: null,
			nodeName: null,
			revision: 0,
			nodes: [],
		};
	}
	const node = readNode();
	const state = await stateRow();
	const nodes = await db()("npmi_shared_node")
		.where("last_seen", ">", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
		.orderBy("node_name", "asc");
	return {
		enabled: true,
		role: node.role,
		nodeId: node.node_id,
		nodeName: node.node_name,
		publicUrl: node.public_url,
		revision: revisionNumber(state.revision),
		lastAppliedRevision: node.last_applied_revision,
		initialized: node.initialized,
		lastError: node.last_error,
		primaryNodeId: state.primary_node_id || null,
		primarySeenOn: state.primary_seen_on || null,
		primaryHealthy: primaryFresh(state),
		nodes: nodes.map((item) => ({
			nodeId: item.node_id,
			nodeName: item.node_name,
			role: item.role,
			version: item.version,
			buildCommit: item.build_commit,
			publicUrl: item.public_url,
			lastAppliedRevision: revisionNumber(item.last_applied_revision),
			lastSeen: item.last_seen,
			lastError: item.last_error,
		})),
	};
};

const configureLocalNode = ({ role, nodeName, publicUrl } = {}) => {
	const current = readNode();
	return writeNode({
		role: role === "secondary" ? "secondary" : "primary",
		node_name: String(nodeName || current.node_name || os.hostname()).trim().slice(0, 100),
		public_url: String(publicUrl || current.public_url || "").trim().slice(0, 2048),
		initialized: false,
		last_applied_revision: 0,
		last_error: null,
	});
};

const setRole = async ({ role, force = false, confirmation = "" }) => {
	if (!isSharedDatabase()) throw new errs.ValidationError("Shared database mode is not enabled");
	if (!["primary", "secondary"].includes(role)) {
		throw new errs.ValidationError("Role must be primary or secondary");
	}
	const current = readNode();
	if (role === "primary") {
		if (force && confirmation !== "PROMOTE") {
			throw new errs.ValidationError('Type "PROMOTE" to force a shared database failover promotion');
		}
		await claimPrimary(force);
		writeNode({ role: "primary", last_error: null });
		await publishNow({ force: true });
	} else {
		writeNode({ role: "secondary", initialized: false, last_applied_revision: 0, last_error: null });
		const state = await stateRow();
		if (state.primary_node_id === current.node_id) {
			await db()("npmi_shared_state").where({ id: 1 }).update({
				primary_node_id: null,
				primary_seen_on: null,
			});
		}
		await reconcileNow();
	}
	await registerNode();
	return status();
};

const writeGuard = async (req, _res, next) => {
	try {
		if (!isSharedDatabase() || ["GET", "HEAD", "OPTIONS"].includes(req.method)) {
			next();
			return;
		}
		const node = readNode();
		const guardedPrefixes = [
			"/nginx/",
			"/settings",
			"/users",
			"/disaster-recovery",
			"/config-history",
		];
		if (!guardedPrefixes.some((prefix) => req.path.startsWith(prefix))) {
			next();
			return;
		}
		if (node.role === "secondary") {
			throw new errs.ValidationError(
				"Shared database secondary nodes are read-only. Promote this node before changing synchronized configuration.",
			);
		}
		if (!(await renewPrimaryLease())) {
			throw new errs.ValidationError(
				"This node is configured as primary but another active node currently owns the shared database lease.",
			);
		}
		next();
	} catch (err) {
		next(err);
	}
};

const changeNotifier = (req, res, next) => {
	if (
		isSharedDatabase() &&
		!["GET", "HEAD", "OPTIONS"].includes(req.method) &&
		["/nginx/", "/settings", "/users", "/disaster-recovery", "/config-history"].some((prefix) =>
			req.path.startsWith(prefix),
		)
	) {
		res.on("finish", () => {
			if (res.statusCode >= 200 && res.statusCode < 300) markChanged();
		});
	}
	next();
};

const tick = async () => {
	if (!isSharedDatabase()) return;
	const node = readNode();
	if (node.role === "secondary") {
		await reconcileNow();
	} else {
		await renewPrimaryLease();
		await registerNode();
		if (Date.now() - lastSafetyScan >= FILE_SAFETY_SCAN_MS) {
			lastSafetyScan = Date.now();
			await publishNow({ force: false });
		}
	}
};

const initTimer = () => {
	if (!isSharedDatabase()) return;
	if (timer) clearInterval(timer);
	const node = readNode();
	const start = async () => {
		try {
			if (node.role === "primary") {
				await claimPrimary(false);
				const state = await stateRow();
				if (revisionNumber(state.revision) === 0) await publishNow({ force: true });
				else await registerNode();
			} else {
				await reconcileNow();
			}
		} catch (err) {
			logger.error(`Shared database startup reconciliation failed: ${err.message}`);
			writeNode({ last_error: err.message });
		}
	};
	start();
	timer = setInterval(() => {
		tick().catch((err) => {
			logger.error(`Shared database reconciliation failed: ${err.message}`);
			writeNode({ last_error: err.message });
		});
	}, POLL_MS);
	timer.unref?.();
};

const internalSharedDatabase = {
	status,
	configureLocalNode,
	setRole,
	writeGuard,
	changeNotifier,
	markChanged,
	publishNow,
	reconcileNow,
	initTimer,
	isSecondary: () => isSharedDatabase() && readNode().role === "secondary",
};

export default internalSharedDatabase;

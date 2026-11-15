import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import db from "../db.js";
import settingModel from "../models/setting.js";
import { assertValidIdentityRecord, hasIdentityDrift } from "../lib/npmx-update-identity.js";
import { global as logger } from "../logger.js";
import authModel from "../models/auth.js";
import errs from "../lib/error.js";
import { compareReleaseVersions, parseReleaseVersion } from "../lib/release-versions.js";
import { evaluateNpmxRollingUpdate } from "../lib/rolling-update-policy.js";
import internalAuditLog from "./audit-log.js";
import internalDatabaseManager from "./database-manager.js";
import internalDisasterRecovery from "./disaster-recovery.js";
import internalInstanceSync from "./instance-sync.js";

const STATUS_FILE = "/data/update-status.json";
const AUDIT_MARKER_FILE = "/data/update-audit-marker.json";
const HOST_READY_FILE = "/data/host-updater-ready.json";
const HOST_MAINTENANCE_FILE = "/data/host-updater-maintenance.json";
const HOST_REQUEST_FILE = "/data/host-update-request.json";
const NPMX_IDENTITY_CHECKPOINT_FILE = "/data/npmx-update-identity-checkpoint.json";
const NPMX_SECRET_FILE = "/data/cluster-secret";
const OFFICIAL_IMAGE_PREFIX = "ghcr.io/gigabytegrove/npm-improved:";
const ACTIVE_STATES = new Set(["preflight", "pulling", "staging", "restarting", "verifying", "rolling_back"]);
const VALID_MODES = new Set(["sqlite", "mysql", "postgres"]);

const now = () => new Date().toISOString();

const readJsonFile = (filename, fallback = null) => {
	try {
		return JSON.parse(fs.readFileSync(filename, "utf8"));
	} catch {
		return fallback;
	}
};

const writeJsonFile = (filename, value) => {
	fs.mkdirSync(path.dirname(filename), { recursive: true });
	const temporary = `${filename}.tmp`;
	fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	fs.renameSync(temporary, filename);
};

// Persist the exact node-local pairing record BEFORE requesting an image update.
// This file is outside every NPMX replicated filesystem root.
const clusterSecretDigest = () => {
	try {
		return crypto.createHash("sha256").update(fs.readFileSync(NPMX_SECRET_FILE)).digest("hex");
	} catch (err) {
		if (err?.code === "ENOENT") return null;
		throw err;
	}
};

const recordClusterIdentityCheckpoint = async () => {
	const row = await settingModel.query().findById("instance-sync");
	const identity = assertValidIdentityRecord(row);
	writeJsonFile(NPMX_IDENTITY_CHECKPOINT_FILE, {
		format: 1,
		created_at: now(),
		secret_digest: clusterSecretDigest(),
		identity,
	});
};

const reconcileClusterIdentityCheckpoint = async () => {
	if (!fs.existsSync(NPMX_IDENTITY_CHECKPOINT_FILE)) return false;
	const saved = readJsonFile(NPMX_IDENTITY_CHECKPOINT_FILE, null);
	if (!saved || saved.format !== 1) {
		throw new Error("NPMX update identity checkpoint is corrupt; refusing to start without verifying the paired node identity");
	}
	const expected = assertValidIdentityRecord(saved.identity);
	if (saved.secret_digest !== clusterSecretDigest()) {
		throw new Error("NPMX cluster credential changed during the update; refusing to restore an identity with unverified pairing credentials");
	}
	const current = await settingModel.query().findById("instance-sync");
	const drifted = hasIdentityDrift(expected, current);
	if (drifted) {
		const instance = settingModel.fromJson(expected);
		const dbRow = typeof instance.$toDatabaseJson === "function"
			? instance.$toDatabaseJson()
			: instance.$formatDatabaseJson(expected);
		await db().transaction(async (trx) => {
			await trx("setting").where({ id: "instance-sync" }).del();
			await trx("setting").insert(dbRow);
		});
		const verified = await settingModel.query().findById("instance-sync");
		if (hasIdentityDrift(expected, verified)) {
			throw new Error("NPMX identity recovery did not pass post-write verification");
		}
		logger.warn("NPMX identity changed during the update; restored the prior node identity and cluster membership from the verified local checkpoint");
	}
	fs.rmSync(NPMX_IDENTITY_CHECKPOINT_FILE, { force: true });
	return drifted;
};

const configuredMode = () => {
	const mode = (process.env.NPM_DEPLOYMENT_MODE || "sqlite").trim().toLowerCase();
	return VALID_MODES.has(mode) ? mode : "sqlite";
};

const capabilities = () => {
	const projectDir = (process.env.NPM_HOST_PROJECT_DIR || "").trim();
	const ready = readJsonFile(HOST_READY_FILE, null);
	const hostReady = ready?.mode === "native-host-service" && ready.project_dir === projectDir && projectDir !== "";
	const maintenance = readJsonFile(HOST_MAINTENANCE_FILE, null);
	const maintained = ready?.maintenance === "automatic" && Number(ready?.protocol) >= 1;
	const prereleaseSupported = hostReady && Number(ready?.protocol) >= 2;
	const maintenanceRetry = maintenance?.status === "failed";
	const maintenanceTimeout = /timed out|timeout|time limit/i.test(String(maintenance?.error || ""));
	const maintenanceSummary = maintenanceRetry
		? maintenanceTimeout
			? "A routine host updater refresh took longer than expected. NPM Improved remains online; the scheduled maintenance task will retry."
			: "A routine host updater refresh could not complete. NPM Improved remains online; maintenance will retry automatically."
		: null;

	return {
		enabled: hostReady,
		docker_socket_available: false,
		host_project_configured: projectDir !== "",
		host_project_dir: projectDir || null,
		deployment_mode: configuredMode(),
		helper_image: null,
		handoff_source: "native-host-service",
		host_service_installed: hostReady,
		host_updater_version: hostReady ? (ready?.component_version || "legacy") : null,
		host_updater_automatic_maintenance: hostReady && maintained,
		host_updater_prerelease_support: prereleaseSupported,
		host_updater_maintenance_state: maintenanceRetry ? "retry_scheduled" : "current",
		host_updater_maintenance_summary: maintenanceSummary,
		// Keep the legacy property for older clients, but never expose command
		// arguments, temporary paths, subprocess tracebacks, or raw timeouts.
		host_updater_maintenance_error: maintenanceSummary,
		reason: projectDir === ""
			? "The installed deployment is missing NPM_HOST_PROJECT_DIR. Use the supported NPMi installer to configure native updates."
			: !hostReady
				? "This deployment was not bootstrapped by the NPMi host installer. Run the supported host installer once; routine app and host-updater updates are automatic afterward."
				: null,
	};
};

const getStatus = () => {
	const saved = readJsonFile(STATUS_FILE, null);
	return (
		saved || {
			state: "idle",
			message: "No update has been run yet.",
			action: null,
			started_at: null,
			completed_at: null,
			source_version: null,
			target_version: null,
			previous_image: null,
			target_image: null,
			error: null,
		}
	);
};

const clearFailedStatus = () => {
	const status = getStatus();
	if (status.state !== "failed") {
		return status;
	}

	try {
		fs.rmSync(STATUS_FILE, { force: true });
	} catch {
		// If removal is unavailable for any reason, replace it with a clean idle
		// state rather than making stale failure state permanent in the UI.
		writeJsonFile(STATUS_FILE, {
			state: "idle",
			message: "No update operation is currently active.",
			action: null,
			started_at: null,
			completed_at: null,
			source_version: null,
			target_version: null,
			previous_version: null,
			previous_image: null,
			target_image: null,
			target_digest: null,
			error: null,
		});
	}

	return getStatus();
};

const assertIdle = () => {
	const status = getStatus();
	if (ACTIVE_STATES.has(status.state)) {
		throw new errs.ValidationError(`An update operation is already active (${status.state}).`);
	}
};

const verifyOperationalSafety = async (access) => {
	const database = await internalDatabaseManager.status(access);
	if (database.migrationInProgress) {
		throw new errs.ValidationError("A database migration is in progress. Wait for it to finish before updating.");
	}
	if (database.mysqlSharedMode) {
		throw new errs.ValidationError(
			"Automatic single-node updates are disabled while Shared MySQL mode is active. Coordinate the same NPM Improved version across every shared-database node before updating.",
		);
	}

	const sync = await internalInstanceSync.getStatus();
	// Rolling NPMX upgrades: mixed-version snapshot application is rejected by
	// the NPMX protocol until every node is upgraded. Proxy traffic continues
	// independently while operators update peers sequentially.
	// Existing protections against migrations, restores and duplicate same-node
	// update jobs remain in place.
	let coordination;
	try {
		coordination = evaluateNpmxRollingUpdate(sync);
	} catch (err) {
		throw new errs.ValidationError(err.message);
	}

	const recovery = await internalDisasterRecovery.status(access);
	if (recovery.restoreInProgress) {
		throw new errs.ValidationError("A backup restore is in progress. Wait for it to finish before updating.");
	}

	return {
		database_engine: database.current?.engine || "unknown",
		shared_mysql: Boolean(database.mysqlSharedMode),
		instance_sync: coordination.enabled,
		instance_sync_role: coordination.role,
		requires_sequential_updates: coordination.requiresSequentialUpdates,
		restore_in_progress: Boolean(recovery.restoreInProgress),
	};
};

const verifyCurrentPassword = async (access, password) => {
	if (typeof password !== "string" || password.length < 1) {
		throw new errs.ValidationError("Current administrator password is required.");
	}

	const userId = access.token.getUserId(0);
	if (!userId) {
		throw new errs.AuthError("Unable to identify the authenticated administrator.");
	}

	const auth = await authModel
		.query()
		.where("user_id", "=", userId)
		.where("type", "=", "password")
		.first();

	if (!auth || !(await auth.verifyPassword(password))) {
		throw new errs.ValidationError("Current administrator password is incorrect.");
	}
};

/**
 * systemd.path watches this queue on the Docker host and performs Compose
 * actions directly. No helper container or Docker Hub dependency.
 */
const launchHandoff = async ({ action, targetImage, sourceVersion, targetVersion, initiatedBy, channel = "stable", reinstall = false }) => {
	const caps = capabilities();
	if (!caps.enabled) {
		throw new errs.ValidationError(caps.reason || "The native host updater is unavailable.");
	}
	if (fs.existsSync(HOST_REQUEST_FILE)) {
		throw new errs.ValidationError("A native host update request is already queued.");
	}
	const request = {
		project_dir: caps.host_project_dir,
		action,
		target_image: targetImage || "",
		mode: caps.deployment_mode,
		source_version: sourceVersion || "unknown",
		target_version: targetVersion || "unknown",
		channel,
		initiated_by: String(initiatedBy || ""),
		reinstall: Boolean(reinstall),
	};
	// The host updater must never start without a durable local identity checkpoint.
	await recordClusterIdentityCheckpoint();
	writeJsonFile(HOST_REQUEST_FILE, request);
	return { handoff_source: "native-host-service", queued: true };
};

const startReleaseOperation = async (access, release, password, { reinstall = false } = {}) => {
	await access.can("settings:update");
	await verifyCurrentPassword(access, password);
	assertIdle();
	const safety = await verifyOperationalSafety(access);

	if (!release?.latest || (!reinstall && !release.update_available)) {
		throw new errs.ValidationError(
			reinstall
				? "No published NPM Improved release is available to reinstall."
				: "No newer NPM Improved release is available on the selected channel.",
		);
	}
	if (release.platform_available !== true) {
		throw new errs.ValidationError(
			`The published ${release.latest} release has no verified Docker archive for this host architecture (${release.platform_arch || "unknown"}).`,
		);
	}
	const parsedRelease = parseReleaseVersion(release.latest);
	if (!parsedRelease || !release.latest.startsWith("v")) {
		throw new errs.ValidationError("The published release tag is not a supported NPM Improved version.");
	}
	const channel = parsedRelease.stage === "beta" ? "beta" : parsedRelease.stage ? "alpha" : "stable";
	if (channel !== (release.channel || "stable")) {
		throw new errs.ValidationError("Selected release and update channel do not match.");
	}
	const caps = capabilities();
	if (channel !== "stable" && !caps.host_updater_prerelease_support) {
		throw new errs.ValidationError("This node must first enable prerelease updates through the verified host updater installation.");
	}

	if (reinstall && release.current !== release.latest && !release.update_available) {
		throw new errs.ValidationError("Reinstall cannot downgrade this installation. Use the supported rollback process instead.");
	}

	// Older host-updater programs cannot retain an immutable rollback image or
	// safely refresh their own scripts for a reused tag. Fail closed until the
	// host's verified updater bundle matches the release being reapplied.
	if (reinstall) {
		const caps = capabilities();
		const releaseVersion = release.latest.slice(1);
		if (!caps.host_updater_automatic_maintenance || caps.host_updater_version !== releaseVersion) {
			throw new errs.ValidationError(
				`Reinstall requires the verified native host updater for ${release.latest}. Upgrade or refresh the host updater before reinstalling.`,
			);
		}
	}

	const sourceVersion = release.current;
	const targetVersion = release.latest;
	const initiatedBy = access.token.getUserId(0);
	const targetImage = `${OFFICIAL_IMAGE_PREFIX}${targetVersion}`;
	const startedAt = now();

	writeJsonFile(STATUS_FILE, {
		state: "preflight",
		action: reinstall ? "reinstall" : "update",
		message: reinstall
			? `Preparing a clean reinstallation of the published ${targetVersion} release.`
			: `Preparing update from ${sourceVersion} to ${targetVersion}.`,
		started_at: startedAt,
		completed_at: null,
		source_version: sourceVersion,
		target_version: targetVersion,
		previous_version: sourceVersion,
		previous_image: null,
		target_image: targetImage,
		target_digest: null,
		error: null,
		initiated_by: initiatedBy,
	});

	try {
		const hostService = await launchHandoff({
			action: "update",
			targetImage,
			sourceVersion,
			targetVersion,
			initiatedBy,
			channel,
			reinstall,
		});
		await internalAuditLog.add(access, {
			action: reinstall ? "reinstall_started" : "update_started",
			object_type: "system",
			meta: {
				source_version: sourceVersion,
				target_version: targetVersion,
				target_image: targetImage,
				handoff_source: hostService.handoff_source,
				preflight: safety,
				reinstall,
			},
		});
		return { ...getStatus(), host_service: hostService };
	} catch (err) {
		writeJsonFile(STATUS_FILE, {
			...getStatus(),
			state: "failed",
			message: "The update handoff could not be started.",
			completed_at: now(),
			error: err instanceof Error ? err.message : String(err),
		});
		throw err;
	}
};

// A one-time, mutually authenticated NPMX reconnect is initiated by an
// administrator on each node. Once both parties have paired, align an older
// local node through the SAME verified native host updater used by the UI.
// Untrusted peer input cannot select arbitrary images, registries or scripts.
const alignPairedNodeVersion = async (peerVersion) => {
	const current = parseReleaseVersion(process.env.NPM_BUILD_VERSION);
	const target = parseReleaseVersion(peerVersion);
	if (!current || !target) {
		return { queued: false, reason: "The NPMX peer version is not a supported official release" };
	}
	const ordering = compareReleaseVersions(current.tag, target.tag);
	if (ordering >= 0) return { queued: false, alreadyCurrent: true, version: current.tag };
	const caps = capabilities();
	if (!caps.enabled) return { queued: false, reason: caps.reason || "Native updater is unavailable" };
	const channel = target.stage === "beta" ? "beta" : target.stage ? "alpha" : "stable";
	if (channel !== "stable" && !caps.host_updater_prerelease_support) {
		return { queued: false, reason: "The node's native host updater does not support prerelease channels" };
	}
	// Fetch the EXACT public release requested by the newer paired node.
	// Never use a user-supplied image reference or a floating GitHub tag.
	const { default: remoteVersion } = await import("./remote-version.js");
	let release;
	try {
		const response = await remoteVersion.fetchUrl(
			"https://api.github.com/repos/gigabytegrove/npm-improved/releases/tags/" + encodeURIComponent(target.tag),
		);
		if (response.statusCode !== 200) throw new Error("Official release is unavailable");
		release = JSON.parse(response.rawData);
	} catch (err) {
		return { queued: false, reason: "Could not verify the target release on GitHub: " + (err.message || String(err)) };
	}
	const arch = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : null;
	const asset = arch && "npm-improved-" + target.tag + "-linux-" + arch + ".tar.gz";
	if (release.tag_name !== target.tag || release.draft ||
		Boolean(release.prerelease) !== (channel !== "stable") ||
		!asset || !Array.isArray(release.assets) ||
		!release.assets.some((item) => item?.name === asset)) {
		return { queued: false, reason: "The requested exact release has no verified image for this architecture" };
	}
	try {
		assertIdle();
		// Internal authorization was already established through the one-time
		// pairing token and both administrators' actions. Status readers
		// still enforce their usual permission checks.
		await verifyOperationalSafety({ can: async () => {} });
	} catch (err) {
		return { queued: false, reason: err.message || String(err) };
	}
	const prior = getStatus();
	const startedAt = now();
	// Only the immutable official release is authorized. launchHandoff
	// records the pre-update node identity and cluster-secret checksum.
	writeJsonFile(STATUS_FILE, {
		state: "preflight",
		action: "update",
		message: "NPMX pairing authenticated; aligning this older node to " + target.tag,
		started_at: startedAt, completed_at: null,
		source_version: current.tag, target_version: target.tag,
		previous_version: current.tag, previous_image: null,
		target_image: OFFICIAL_IMAGE_PREFIX + target.tag,
		target_digest: null, error: null, initiated_by: 0,
	});
	try {
		await launchHandoff({
			action: "update",
			targetImage: OFFICIAL_IMAGE_PREFIX + target.tag,
			sourceVersion: current.tag,
			targetVersion: target.tag,
			initiatedBy: "npmx-authenticated-pairing",
			channel,
		});
		return { queued: true, targetVersion: target.tag };
	} catch (err) {
		writeJsonFile(STATUS_FILE, prior);
		return { queued: false, reason: "Native updater refused the paired upgrade: " + (err.message || String(err)) };
	}
};

const startUpdate = (access, release, password) => startReleaseOperation(access, release, password);

const reinstallRelease = (access, release, password) =>
	startReleaseOperation(access, release, password, { reinstall: true });

const rollback = async (access, password) => {
	await access.can("settings:update");
	await verifyCurrentPassword(access, password);
	assertIdle();
	await verifyOperationalSafety(access);

	const status = getStatus();
	const initiatedBy = access.token.getUserId(0);
	if (!status.previous_image) {
		throw new errs.ValidationError("No previous image is available for rollback.");
	}

	const sourceVersion = process.env.NPM_BUILD_VERSION || status.target_version || "unknown";
	const targetVersion = status.previous_version || "previous";
	const targetImage = status.previous_image;

	writeJsonFile(STATUS_FILE, {
		...status,
		state: "preflight",
		action: "rollback",
		message: `Preparing rollback to ${targetVersion}.`,
		started_at: now(),
		completed_at: null,
		source_version: sourceVersion,
		target_version: targetVersion,
		target_image: targetImage,
		error: null,
		initiated_by: initiatedBy,
	});

	const hostService = await launchHandoff({
		action: "rollback",
		targetImage,
		sourceVersion,
		targetVersion,
		initiatedBy,
	});
	await internalAuditLog.add(access, {
		action: "rollback_started",
		object_type: "system",
		meta: {
			source_version: sourceVersion,
			target_version: targetVersion,
			target_image: targetImage,
			handoff_source: hostService.handoff_source,
		},
	});
	return { ...getStatus(), host_service: hostService };
};

const restart = async (access, password) => {
	await access.can("settings:update");
	await verifyCurrentPassword(access, password);
	assertIdle();
	await verifyOperationalSafety(access);

	const sourceVersion = process.env.NPM_BUILD_VERSION || "unknown";
	const initiatedBy = access.token.getUserId(0);
	writeJsonFile(STATUS_FILE, {
		...getStatus(),
		state: "preflight",
		action: "restart",
		message: "Preparing NPM Improved restart.",
		started_at: now(),
		completed_at: null,
		source_version: sourceVersion,
		target_version: sourceVersion,
		error: null,
		initiated_by: initiatedBy,
	});

	const hostService = await launchHandoff({
		action: "restart",
		targetImage: "",
		sourceVersion,
		targetVersion: sourceVersion,
		initiatedBy,
	});
	await internalAuditLog.add(access, {
		action: "restart_started",
		object_type: "system",
		meta: { version: sourceVersion, handoff_source: hostService.handoff_source },
	});
	return { ...getStatus(), host_service: hostService };
};

const reconcileAudit = async () => {
	const status = getStatus();
	if (!["completed", "rolled_back", "failed"].includes(status.state) || !status.completed_at) {
		return false;
	}
	const userId = Number(status.initiated_by || 0);
	if (!Number.isInteger(userId) || userId < 1) {
		return false;
	}

	const key = [status.action || "update", status.state, status.completed_at].join(":");
	const marker = readJsonFile(AUDIT_MARKER_FILE, {});
	if (marker?.key === key) {
		return false;
	}

	await internalAuditLog.add(null, {
		user_id: userId,
		action: `${status.action || "update"}_${status.state}`,
		object_type: "system",
		meta: {
			source_version: status.source_version || null,
			target_version: status.target_version || null,
			previous_version: status.previous_version || null,
			previous_image: status.previous_image || null,
			target_image: status.target_image || null,
			target_digest: status.target_digest || null,
			error: status.error || null,
			started_at: status.started_at || null,
			completed_at: status.completed_at,
		},
	});
	writeJsonFile(AUDIT_MARKER_FILE, { key, recorded_at: now() });
	return true;
};

export default {
	capabilities,
	getStatus,
	clearFailedStatus,
	startUpdate,
	reinstallRelease,
	rollback,
	restart,
	reconcileAudit,
	reconcileClusterIdentityCheckpoint,
	alignPairedNodeVersion,
};

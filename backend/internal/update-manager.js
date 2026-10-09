import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import authModel from "../models/auth.js";
import errs from "../lib/error.js";
import { evaluateNpmxRollingUpdate } from "../lib/rolling-update-policy.js";
import internalAuditLog from "./audit-log.js";
import internalDatabaseManager from "./database-manager.js";
import internalDisasterRecovery from "./disaster-recovery.js";
import internalInstanceSync from "./instance-sync.js";

const DOCKER_SOCKET = "/var/run/docker.sock";
const STATUS_FILE = "/data/update-status.json";
const AUDIT_MARKER_FILE = "/data/update-audit-marker.json";
const HELPER_IMAGE = "docker:27-cli";
const EMBEDDED_HANDOFF_SCRIPT = "/usr/local/libexec/npm-improved/update-handoff.sh";
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

const dockerRequest = (method, requestPath, body) =>
	new Promise((resolve, reject) => {
		const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
		const req = http.request(
			{
				socketPath: DOCKER_SOCKET,
				path: requestPath,
				method,
				headers: payload
					? {
							"Content-Type": "application/json",
							"Content-Length": payload.length,
						}
					: undefined,
			},
			(res) => {
				let raw = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					raw += chunk;
				});
				res.on("end", () => {
					if ((res.statusCode || 500) < 200 || (res.statusCode || 500) >= 300) {
						reject(new Error(`Docker API ${method} ${requestPath} failed with HTTP ${res.statusCode}: ${raw.slice(0, 500)}`));
						return;
					}
					resolve({ statusCode: res.statusCode || 0, raw });
				});
			},
		);
		req.on("error", reject);
		if (payload) req.write(payload);
		req.end();
	});

const ensureHelperImage = async () => {
	const result = await dockerRequest(
		"POST",
		"/images/create?fromImage=docker&tag=27-cli",
	);
	for (const line of result.raw.split(/\r?\n/)) {
		if (!line.trim()) continue;
		try {
			const event = JSON.parse(line);
			if (event.error) {
				throw new Error(event.error);
			}
		} catch (err) {
			if (err instanceof SyntaxError) continue;
			throw err;
		}
	}
};

const configuredMode = () => {
	const mode = (process.env.NPM_DEPLOYMENT_MODE || "sqlite").trim().toLowerCase();
	return VALID_MODES.has(mode) ? mode : "sqlite";
};

const capabilities = () => {
	const projectDir = (process.env.NPM_HOST_PROJECT_DIR || "").trim();
	const socketAvailable = fs.existsSync(DOCKER_SOCKET);
	const embeddedHandoffAvailable = fs.existsSync(EMBEDDED_HANDOFF_SCRIPT);

	return {
		enabled: socketAvailable && projectDir !== "" && embeddedHandoffAvailable,
		docker_socket_available: socketAvailable,
		host_project_configured: projectDir !== "",
		host_project_dir: projectDir || null,
		deployment_mode: configuredMode(),
		helper_image: HELPER_IMAGE,
		handoff_source: "embedded",
		embedded_handoff_available: embeddedHandoffAvailable,
		reason:
			!socketAvailable
				? "Docker socket is not available to this NPM Improved container."
				: projectDir === ""
					? "The host project directory is not configured. Run the current NPM Improved Docker installer once to enable UI updates."
					: !embeddedHandoffAvailable
						? "This NPM Improved image is missing its embedded update handoff."
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

const launchHandoff = async ({ action, targetImage, sourceVersion, targetVersion, initiatedBy }) => {
	const caps = capabilities();
	if (!caps.enabled) {
		throw new errs.ValidationError(caps.reason || "Automatic updates are unavailable.");
	}

	const projectDir = caps.host_project_dir;
	const helperName = `npm-improved-update-${Date.now()}`;
	const handoffScript = fs.readFileSync(EMBEDDED_HANDOFF_SCRIPT, "utf8");

	await ensureHelperImage();

	const create = await dockerRequest(
		"POST",
		`/containers/create?name=${encodeURIComponent(helperName)}`,
		{
			Image: HELPER_IMAGE,
			// Run the handoff bundled inside the currently running NPM Improved
			// image. Never execute the host checkout's scripts/update-handoff.sh:
			// UI updates replace the application image without updating that Git
			// checkout, so using the host copy can permanently pin update logic
			// to an older release.
			Cmd: [
				"sh",
				"-c",
				handoffScript,
				"npm-improved-update-handoff",
				action,
				targetImage || "",
				caps.deployment_mode,
				sourceVersion || "",
				targetVersion || "",
			],
			WorkingDir: projectDir,
			Env: [
				`NPM_UPDATE_STATUS_FILE=${path.posix.join(projectDir, "data/update-status.json")}`,
				`NPM_UPDATE_PROJECT_DIR=${projectDir}`,
				`NPM_UPDATE_INITIATED_BY=${initiatedBy || ""}`,
			],
			Labels: {
				"com.gigabytegrove.npm-improved.role": "update-handoff",
				"com.gigabytegrove.npm-improved.temporary": "true",
			},
			HostConfig: {
				AutoRemove: true,
				Binds: [
					"/var/run/docker.sock:/var/run/docker.sock",
					`${projectDir}:${projectDir}`,
				],
			},
		},
	);

	const created = JSON.parse(create.raw || "{}");
	if (!created.Id) {
		throw new Error("Docker did not return an updater handoff container ID.");
	}

	await dockerRequest("POST", `/containers/${created.Id}/start`);
	return { helper_id: created.Id, helper_name: helperName };
};

const startUpdate = async (access, release, password) => {
	await access.can("settings:update");
	await verifyCurrentPassword(access, password);
	assertIdle();
	const safety = await verifyOperationalSafety(access);

	if (!release?.latest || !release.update_available) {
		throw new errs.ValidationError("No newer stable NPM Improved release is available.");
	}
	if (!/^v\d+\.\d+\.\d+$/.test(release.latest)) {
		throw new errs.ValidationError("The published release tag is not a supported stable version.");
	}

	const sourceVersion = release.current;
	const targetVersion = release.latest;
	const initiatedBy = access.token.getUserId(0);
	const targetImage = `${OFFICIAL_IMAGE_PREFIX}${targetVersion}`;
	const startedAt = now();

	writeJsonFile(STATUS_FILE, {
		state: "preflight",
		action: "update",
		message: `Preparing update from ${sourceVersion} to ${targetVersion}.`,
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
		const helper = await launchHandoff({
			action: "update",
			targetImage,
			sourceVersion,
			targetVersion,
			initiatedBy,
		});
		await internalAuditLog.add(access, {
			action: "update_started",
			object_type: "system",
			meta: {
				source_version: sourceVersion,
				target_version: targetVersion,
				target_image: targetImage,
				helper_id: helper.helper_id,
				preflight: safety,
			},
		});
		return { ...getStatus(), helper };
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

	const helper = await launchHandoff({
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
			helper_id: helper.helper_id,
		},
	});
	return { ...getStatus(), helper };
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

	const helper = await launchHandoff({
		action: "restart",
		targetImage: "",
		sourceVersion,
		targetVersion: sourceVersion,
		initiatedBy,
	});
	await internalAuditLog.add(access, {
		action: "restart_started",
		object_type: "system",
		meta: { version: sourceVersion, helper_id: helper.helper_id },
	});
	return { ...getStatus(), helper };
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
	rollback,
	restart,
	reconcileAudit,
};

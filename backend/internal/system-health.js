import fs from "node:fs";
import db from "../db.js";
import configRevisionModel from "../models/config_revision.js";
import internalCertificate from "./certificate.js";
import internalNginx from "./nginx.js";

const ok = (extra = {}) => ({ status: "ok", ...extra });
const degraded = (extra = {}) => ({ status: "degraded", ...extra });

const checkDatabase = async () => {
	const started = Date.now();
	try {
		await db().raw("SELECT 1");
		return ok({ latency_ms: Date.now() - started });
	} catch {
		return degraded({ latency_ms: Date.now() - started });
	}
};

const checkNginx = async () => {
	let pid = null;
	let processRunning = false;
	try {
		pid = Number.parseInt(fs.readFileSync("/run/nginx/nginx.pid", "utf8").trim(), 10) || null;
		if (pid) {
			process.kill(pid, 0);
			processRunning = true;
		}
	} catch {
		processRunning = false;
	}

	let configValid = false;
	try {
		await internalNginx.test();
		configValid = true;
	} catch {
		configValid = false;
	}

	const details = {
		pid,
		process_running: processRunning,
		config_valid: configValid,
		last_reload: internalNginx.getLastReload(),
	};

	return processRunning && configValid ? ok(details) : degraded(details);
};

const checkLogs = async () => {
	try {
		fs.accessSync("/data/logs", fs.constants.R_OK | fs.constants.W_OK);
		return ok({ path: "/data/logs" });
	} catch {
		return degraded({ path: "/data/logs" });
	}
};

const checkRevisions = async () => {
	try {
		const [active, pending, failed, latest] = await Promise.all([
			configRevisionModel.query().where("status", "active").count("id as count").first(),
			configRevisionModel.query().where("status", "pending").count("id as count").first(),
			configRevisionModel.query().where("status", "failed").count("id as count").first(),
			configRevisionModel.query().where("status", "active").orderBy("id", "DESC").first(),
		]);
		const pendingCount = Number.parseInt(pending?.count, 10) || 0;
		return (pendingCount > 0 ? degraded : ok)({
			active_revisions: Number.parseInt(active?.count, 10) || 0,
			pending_revisions: pendingCount,
			failed_revisions: Number.parseInt(failed?.count, 10) || 0,
			latest_active_revision_id: latest?.id || null,
		});
	} catch {
		return degraded({
			active_revisions: 0,
			pending_revisions: 0,
			failed_revisions: 0,
			latest_active_revision_id: null,
		});
	}
};

const checkControlPlane = async () => {
	const port = Number.parseInt(process.env.NPM_ADMIN_PORT || "81", 10) || 81;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 3000);
	const started = Date.now();
	try {
		const response = await fetch(`http://127.0.0.1:${port}/__npm_improved/health`, {
			signal: controller.signal,
			headers: { Accept: "application/json" },
		});
		const payload = await response.json();
		return {
			status: response.ok ? payload.status || "degraded" : "degraded",
			latency_ms: Date.now() - started,
			checks: payload.checks || {},
		};
	} catch {
		return degraded({ latency_ms: Date.now() - started });
	} finally {
		clearTimeout(timeout);
	}
};

const checkCertificates = () => {
	const renewalTimer = Boolean(internalCertificate.interval);
	const lifecycleTimer = Boolean(internalCertificate.lifecycleInterval);
	return (renewalTimer && lifecycleTimer ? ok : degraded)({
		renewal_timer: renewalTimer,
		lifecycle_timer: lifecycleTimer,
		renewal_processing: internalCertificate.intervalProcessing,
		lifecycle_processing: internalCertificate.lifecycleProcessing,
	});
};

const internalSystemHealth = {
	get: async (access) => {
		await access.can("settings:get", "system-health");

		const [database, nginx, logs, revisions, controlPlane] = await Promise.all([
			checkDatabase(),
			checkNginx(),
			checkLogs(),
			checkRevisions(),
			checkControlPlane(),
		]);

		const checks = {
			control_plane: controlPlane,
			nginx,
			database,
			certificate_engine: checkCertificates(),
			log_engine: logs,
			revision_engine: revisions,
		};

		const status = Object.values(checks).every((check) => check.status === "ok") ? "ok" : "degraded";

		return {
			status,
			generated_at: new Date().toISOString(),
			backend_uptime_seconds: Math.floor(process.uptime()),
			checks,
		};
	},
};

export default internalSystemHealth;

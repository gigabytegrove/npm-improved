import express from "express";
import { isCI } from "../lib/config.js";
import errs from "../lib/error.js";
import logRequest from "../lib/express/log-request.js";
import pjson from "../package.json" with { type: "json" };
import { isSetup } from "../setup.js";
import internalInstanceSync from "../internal/instance-sync.js";
import auditLogRoutes from "./audit-log.js";
import ciRoutes from "./ci.js";
import clusterRoutes from "./cluster.js";
import configHistoryRoutes from "./config-history.js";
import disasterRecoveryRoutes from "./disaster-recovery.js";
import logsRoutes from "./logs.js";
import accessListsRoutes from "./nginx/access_lists.js";
import certificatesHostsRoutes from "./nginx/certificates.js";
import deadHostsRoutes from "./nginx/dead_hosts.js";
import proxyHostsRoutes from "./nginx/proxy_hosts.js";
import redirectionHostsRoutes from "./nginx/redirection_hosts.js";
import streamsRoutes from "./nginx/streams.js";
import reportsRoutes from "./reports.js";
import schemaRoutes from "./schema.js";
import settingsRoutes from "./settings.js";
import tokensRoutes from "./tokens.js";
import usersRoutes from "./users.js";
import versionRoutes from "./version.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

router.use(logRequest);

/**
 * Health Check
 * GET /api
 */
router.get("/", async (_, res /*, next*/) => {
	const displayVersion = (process.env.NPM_BUILD_VERSION || pjson.version || "0.0.0").trim();
	const normalizedVersion = displayVersion.replace(/^v/, "").split("-").shift();
	const versionParts = normalizedVersion.split(".").map((part) => Number.parseInt(part, 10) || 0);
	const setup = await isSetup();

	res.status(200).send({
		status: "OK",
		setup,
		version: {
			major: versionParts[0] || 0,
			minor: versionParts[1] || 0,
			revision: versionParts[2] || 0,
			display: displayVersion.startsWith("v") ? displayVersion : `v${displayVersion}`,
			build_commit: process.env.NPM_BUILD_COMMIT || null,
			build_date: process.env.NPM_BUILD_DATE || null,
		},
	});
});

router.use("/schema", schemaRoutes);
router.use("/cluster", clusterRoutes);
router.use(internalInstanceSync.writeGuard);
router.use("/tokens", tokensRoutes);
router.use("/users", usersRoutes);
router.use("/audit-log", auditLogRoutes);
router.use("/config-history", configHistoryRoutes);
router.use("/disaster-recovery", disasterRecoveryRoutes);
router.use("/logs", logsRoutes);
router.use("/reports", reportsRoutes);
router.use("/settings", settingsRoutes);
router.use("/version", versionRoutes);
router.use("/nginx/proxy-hosts", proxyHostsRoutes);
router.use("/nginx/redirection-hosts", redirectionHostsRoutes);
router.use("/nginx/dead-hosts", deadHostsRoutes);
router.use("/nginx/streams", streamsRoutes);
router.use("/nginx/access-lists", accessListsRoutes);
router.use("/nginx/certificates", certificatesHostsRoutes);

// Only include CI routes if we're in a CI environment
if (isCI()) {
	router.use("/ci", ciRoutes);
}

/**
 * API 404 for all other routes
 *
 * ALL /api/*
 */
router.all(/(.+)/, (req, _, next) => {
	req.params.page = req.params["0"];
	next(new errs.ItemNotFoundError(req.params.page));
});

export default router;

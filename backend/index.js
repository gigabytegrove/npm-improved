#!/usr/bin/env node

import app from "./app.js";
import internalCertificate from "./internal/certificate.js";
import { startAnalyticsCollector } from "./internal/proxy-analytics.js";
import { startStreamCollector } from "./internal/stream-analytics.js";
import internalDatabaseManager from "./internal/database-manager.js";
import internalIpRanges from "./internal/ip_ranges.js";
import internalInstanceSync from "./internal/instance-sync.js";
import internalUpdateManager from "./internal/update-manager.js";
import { global as logger } from "./logger.js";
import { migrateUp } from "./migrate.js";
import { getCompiledSchema } from "./schema/index.js";
import setup from "./setup.js";

const IP_RANGES_FETCH_ENABLED = process.env.IP_RANGES_FETCH_ENABLED !== "false";

async function appStart() {
	return migrateUp()
		.then(async () => {
			const shared = await internalDatabaseManager.initializeSharedMode();
			if (shared.restartRequired) {
				setTimeout(() => process.exit(0), 250);
				return new Promise(() => {});
			}
		})
		.then(setup)
		.then(() =>
			internalUpdateManager.reconcileAudit().catch((err) => {
				logger.warn(`Update audit reconciliation failed: ${err instanceof Error ? err.message : String(err)}`);
			}),
		)
		.then(getCompiledSchema)
		.then(() => {
			if (!IP_RANGES_FETCH_ENABLED) {
				logger.info("IP Ranges fetch is disabled by environment variable");
				return;
			}
			logger.info("IP Ranges fetch is enabled");
			return internalIpRanges.fetch().catch((err) => {
				logger.error("IP Ranges fetch failed, continuing anyway:", err.message);
			});
		})
		.then(() => {
			internalCertificate.initTimer();
			startAnalyticsCollector();
			startStreamCollector();
			internalIpRanges.initTimer();
			internalInstanceSync.initTimer();
			internalDatabaseManager.initWatcher();

			const server = app.listen(3000, () => {
				logger.info(`Backend PID ${process.pid} listening on port 3000 ...`);

				process.on("SIGTERM", () => {
					logger.info(`PID ${process.pid} received SIGTERM`);
					server.close(() => {
						logger.info("Stopping.");
						process.exit(0);
					});
				});
			});
		})
		.catch((err) => {
			logger.error(`Startup Error: ${err.message}`, err);
			setTimeout(appStart, 1000);
		});
}

try {
	appStart();
} catch (err) {
	logger.fatal(err);
	process.exit(1);
}

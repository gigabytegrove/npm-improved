#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import internalDisasterRecovery from "../internal/disaster-recovery.js";
import { migrateUp } from "../migrate.js";

const MAX_INPUT = 4096;
const backupDir = path.resolve(process.env.NPM_BACKUPS_DIR || "/data/backups");

const fail = (message, code = 1) => {
	process.stderr.write(String(message) + "\n");
	process.exit(code);
};

const filename = process.argv[2];
if (!filename) {
	fail("Backup filename argument is required");
}

const resolved = path.resolve(filename);
if (resolved !== backupDir && !resolved.startsWith(backupDir + path.sep)) {
	fail("Backup file must be located under the configured backups directory");
}
if (!resolved.endsWith(".npmibak") || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
	fail("Backup file does not exist or is invalid");
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	input += chunk;
	if (Buffer.byteLength(input, "utf8") > MAX_INPUT) {
		fail("Recovery input is too large");
	}
});

process.stdin.on("end", async () => {
	let request;
	try {
		request = JSON.parse(input);
	} catch {
		fail("Recovery input must be valid JSON");
	}

	if (typeof request.passphrase !== "string" || request.passphrase.length < 12) {
		fail("Backup passphrase must be at least 12 characters");
	}
	if (request.confirmation !== "RESTORE") {
		fail('Type "RESTORE" to confirm this destructive operation');
	}

	try {
		await migrateUp();
		const result = await internalDisasterRecovery.restoreEmergencyFile({
			filename: resolved,
			passphrase: request.passphrase,
			confirmation: request.confirmation,
		});
		process.stdout.write(JSON.stringify(result) + "\n");
		process.exit(0);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		process.stderr.write(message + "\n");
		if (err?.rollbackError) {
			process.stderr.write("Rollback error: " + (err.rollbackError.message || String(err.rollbackError)) + "\n");
		}
		process.exit(1);
	}
});

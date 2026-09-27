import assert from "node:assert/strict";
import test from "node:test";
import {
	backupFormatVersion,
	backupMagic,
	createBackupEnvelope,
	openBackupEnvelope,
} from "../lib/backup-bundle.js";

test("backup bundle round-trips encrypted payloads", () => {
	const payload = {
		scope: "configuration",
		created_at: "2026-09-27T00:00:00.000Z",
		data: {
			settings: [{ id: "default-site", value: "404" }],
		},
	};

	const file = createBackupEnvelope(payload, "correct horse battery staple");
	assert.equal(file.subarray(0, Buffer.byteLength(backupMagic())).toString("utf8"), backupMagic());

	const restored = openBackupEnvelope(file, "correct horse battery staple");
	assert.equal(restored.format_version, backupFormatVersion());
	assert.equal(restored.scope, "configuration");
	assert.deepEqual(restored.data, payload.data);
});

test("backup bundle rejects wrong passphrases", () => {
	const file = createBackupEnvelope({ scope: "configuration", data: {} }, "correct horse battery staple");
	assert.throws(
		() => openBackupEnvelope(file, "incorrect horse battery staple"),
		/could not be decrypted/,
	);
});

test("backup bundle rejects short passphrases", () => {
	assert.throws(
		() => createBackupEnvelope({ scope: "configuration", data: {} }, "short"),
		/at least 12 characters/,
	);
});

test("backup bundle rejects arbitrary files", () => {
	assert.throws(
		() => openBackupEnvelope(Buffer.from("not-a-backup"), "correct horse battery staple"),
		/Not an NPM Improved backup bundle/,
	);
});

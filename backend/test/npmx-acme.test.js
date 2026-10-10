import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readLocalAcmeToken, validAcmeToken } from "../lib/acme-challenge.js";

test("accepts only bounded base64url ACME token characters", () => {
	assert.equal(validAcmeToken("aB_012-z"), true);
	for (const token of ["", ".", "..", "../etc/passwd", "a/b", "abc.def", "z".repeat(129), 1, null]) {
		assert.equal(validAcmeToken(token), false);
	}
});

test("reads only existing, bounded challenge payloads", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "npmi-acme-"));
	try {
		fs.writeFileSync(path.join(dir, "valid_token"), "key-authorization.test");
		fs.writeFileSync(path.join(dir, "oversize"), "x".repeat(4097));
		fs.writeFileSync(path.join(dir, "empty"), "");
		assert.equal(readLocalAcmeToken("valid_token", dir), "key-authorization.test");
		assert.equal(readLocalAcmeToken("missing", dir), null);
		assert.equal(readLocalAcmeToken("oversize", dir), null);
		assert.equal(readLocalAcmeToken("empty", dir), null);
		assert.equal(readLocalAcmeToken("../../etc/passwd", dir), null);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

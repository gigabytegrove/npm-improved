import assert from "node:assert/strict";
import test from "node:test";
import { npmxVersionAlignment } from "../lib/npmx-version-alignment.js";

test("the older secondary updates to the newer primary", () => {
	assert.deepEqual(npmxVersionAlignment("1.8.0-beta.8", "1.8.0-beta.9"), {
		valid: true, older: "local", target: "v1.8.0-beta.9",
	});
});
test("the older primary updates when the secondary is newer", () => {
	assert.deepEqual(npmxVersionAlignment("v1.8.0-beta.9", "v1.8.0-beta.8"), {
		valid: true, older: "peer", target: "v1.8.0-beta.9",
	});
});
test("equal versions do not trigger a redundant upgrade", () => {
	assert.deepEqual(npmxVersionAlignment("1.8.0-beta.9", "v1.8.0-beta.9"), {
		valid: true, older: null, target: null,
	});
});
test("invalid peer versions never authorize an upgrade", () => {
	assert.deepEqual(npmxVersionAlignment("1.8.0-beta.9", "https://attacker.test/image"), {
		valid: false, older: null, target: null,
	});
});

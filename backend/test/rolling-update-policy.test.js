import assert from "node:assert/strict";
import test from "node:test";
import { evaluateNpmxRollingUpdate } from "../lib/rolling-update-policy.js";

test("standalone deployments remain updatable", () => {
	assert.deepEqual(evaluateNpmxRollingUpdate({ enabled: false }), {
		enabled: false, role: null, requiresSequentialUpdates: false,
	});
});

test("both NPMX roles allow sequential upgrades without disabling sync", () => {
	for (const role of ["primary", "secondary"]) {
		assert.deepEqual(evaluateNpmxRollingUpdate({ enabled: true, role }), {
			enabled: true, role, requiresSequentialUpdates: true,
		});
	}
});

test("an invalid enabled synchronization role does not bypass preflight", () => {
	assert.throws(() => evaluateNpmxRollingUpdate({ enabled: true, role: "unknown" }), RangeError);
	assert.throws(() => evaluateNpmxRollingUpdate({ enabled: true }), RangeError);
});

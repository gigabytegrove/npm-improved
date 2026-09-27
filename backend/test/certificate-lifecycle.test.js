import assert from "node:assert/strict";
import test from "node:test";
import {
	calculateCertificateLifecycle,
	normalizeCertificateLifecyclePolicy,
} from "../lib/certificate-lifecycle.js";

test("used certificates never enter quarantine or auto purge", () => {
	const policy = normalizeCertificateLifecyclePolicy({
		value: "enabled",
		meta: { unused_retention_days: 30, purge_custom_certificates: true },
	});
	const state = calculateCertificateLifecycle({
		certificate: { provider: "letsencrypt", meta: {} },
		usageCount: 2,
		policy,
		now: new Date("2026-09-27T00:00:00Z"),
	});

	assert.equal(state.isInUse, true);
	assert.equal(state.unusedSince, null);
	assert.equal(state.purgeEligibleOn, null);
	assert.equal(state.shouldPurge, false);
});

test("newly unused certificates start a fresh quarantine instead of purging immediately", () => {
	const policy = normalizeCertificateLifecyclePolicy({
		value: "enabled",
		meta: { unused_retention_days: 30, purge_custom_certificates: true },
	});
	const now = new Date("2026-09-27T00:00:00Z");
	const state = calculateCertificateLifecycle({
		certificate: { provider: "letsencrypt", meta: {} },
		usageCount: 0,
		policy,
		now,
	});

	assert.equal(state.unusedSince, "2026-09-27T00:00:00.000Z");
	assert.equal(state.purgeEligibleOn, "2026-10-27T00:00:00.000Z");
	assert.equal(state.shouldPurge, false);
});

test("expired quarantine becomes purgeable only when policy allows it", () => {
	const now = new Date("2026-09-27T00:00:00Z");
	const certificate = {
		provider: "letsencrypt",
		meta: { lifecycle_unused_since: "2026-08-01T00:00:00.000Z" },
	};

	const enabled = calculateCertificateLifecycle({
		certificate,
		usageCount: 0,
		policy: normalizeCertificateLifecyclePolicy({
			value: "enabled",
			meta: { unused_retention_days: 30, purge_custom_certificates: true },
		}),
		now,
	});
	assert.equal(enabled.shouldPurge, true);

	const disabled = calculateCertificateLifecycle({
		certificate,
		usageCount: 0,
		policy: normalizeCertificateLifecyclePolicy({
			value: "disabled",
			meta: { unused_retention_days: 30, purge_custom_certificates: true },
		}),
		now,
	});
	assert.equal(disabled.shouldPurge, false);
});

test("custom certificate purge eligibility respects the custom-certificate policy", () => {
	const certificate = {
		provider: "other",
		meta: { lifecycle_unused_since: "2026-08-01T00:00:00.000Z" },
	};
	const state = calculateCertificateLifecycle({
		certificate,
		usageCount: 0,
		policy: normalizeCertificateLifecyclePolicy({
			value: "enabled",
			meta: { unused_retention_days: 30, purge_custom_certificates: false },
		}),
		now: new Date("2026-09-27T00:00:00Z"),
	});

	assert.equal(state.autoPurgeEligible, false);
	assert.equal(state.shouldPurge, false);
});

test("invalid retention values fall back to 30 days", () => {
	const policy = normalizeCertificateLifecyclePolicy({
		value: "enabled",
		meta: { unused_retention_days: 0, purge_custom_certificates: true },
	});
	assert.equal(policy.unusedRetentionDays, 30);
});

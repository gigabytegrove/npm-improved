import assert from "node:assert/strict";
import test from "node:test";
import {
	normalizeHostProtectionProfile,
	normalizeProtectionSetting,
	renderProtectionPolicy,
} from "../lib/protection.js";

test("normalizes trusted IPs and CIDRs", () => {
	const result = normalizeProtectionSetting({
		value: "standard",
		meta: {
			trusted_networks: ["10.0.0.1", "192.168.0.0/24", "2001:db8::/32", "10.0.0.1/32"],
		},
	});

	assert.deepEqual(result, {
		value: "standard",
		meta: {
			trusted_networks: ["10.0.0.1/32", "192.168.0.0/24", "2001:db8::/32"],
		},
	});
});

test("rejects invalid protection settings", () => {
	assert.throws(
		() => normalizeProtectionSetting({ value: "maximum", meta: { trusted_networks: [] } }),
		/profile must be off, standard, or aggressive/,
	);
	assert.throws(
		() => normalizeProtectionSetting({ value: "standard", meta: { trusted_networks: ["10.0.0.0/99"] } }),
		/Invalid CIDR prefix/,
	);
	assert.throws(
		() => normalizeProtectionSetting({ value: "standard", meta: { trusted_networks: ["not-an-ip"] } }),
		/Invalid trusted IP or network/,
	);
});

test("renders a standard global policy with trusted-network bypass", () => {
	const config = renderProtectionPolicy({
		value: "standard",
		meta: { trusted_networks: ["10.0.0.0/8"] },
	});

	assert.match(config, /10\.0\.0\.0\/8 1;/);
	assert.match(config, /zone=npm_protection_standard burst=60 nodelay/);
	assert.match(config, /limit_conn npm_protection_conn 40/);
	assert.match(config, /limit_req_status 429/);
	assert.match(config, /client_header_timeout 15s/);
});

test("off global policy still defines zones for per-host overrides", () => {
	const config = renderProtectionPolicy({
		value: "off",
		meta: { trusted_networks: [] },
	});

	assert.match(config, /limit_req_zone .*npm_protection_standard/);
	assert.match(config, /Global HTTP protection is disabled/);
	assert.doesNotMatch(config, /limit_req zone=npm_protection_standard burst=60/);
});

test("invalid host protection profiles inherit safely", () => {
	assert.equal(normalizeHostProtectionProfile("aggressive"), "aggressive");
	assert.equal(normalizeHostProtectionProfile("anything-else"), "inherit");
	assert.equal(normalizeHostProtectionProfile(undefined), "inherit");
});

import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProxyHostPool } from "../lib/upstream-pool.js";

test("normalizes multiple upstream targets and mirrors the primary into legacy fields", () => {
	const result = normalizeProxyHostPool({
		upstream_mode: "failover",
		upstreams: [
			{ scheme: "https", host: "app-1.internal", port: 443 },
			{ scheme: "https", host: "app-2.internal", port: 443, weight: 2, max_fails: 2, fail_timeout: 15 },
		],
	});

	assert.equal(result.upstream_mode, "failover");
	assert.equal(result.forward_scheme, "https");
	assert.equal(result.forward_host, "app-1.internal");
	assert.equal(result.forward_port, 443);
	assert.deepEqual(result.upstreams[1], {
		scheme: "https",
		host: "app-2.internal",
		port: 443,
		weight: 2,
		max_fails: 2,
		fail_timeout: 15,
		enabled: true,
	});
});

test("preserves legacy single-target API clients", () => {
	const result = normalizeProxyHostPool({
		forward_scheme: "http",
		forward_host: "10.0.0.10",
		forward_port: 8080,
	});

	assert.equal(result.upstreams.length, 1);
	assert.equal(result.upstreams[0].host, "10.0.0.10");
	assert.equal(result.upstream_mode, "round-robin");
});

test("rejects mixed schemes in one enabled pool", () => {
	assert.throws(
		() =>
			normalizeProxyHostPool({
				upstreams: [
					{ scheme: "http", host: "a.internal", port: 80 },
					{ scheme: "https", host: "b.internal", port: 443 },
				],
			}),
		/all enabled upstream targets.*same scheme/i,
	);
});

test("rejects duplicate enabled endpoints", () => {
	assert.throws(
		() =>
			normalizeProxyHostPool({
				upstreams: [
					{ scheme: "http", host: "a.internal", port: 80 },
					{ scheme: "http", host: "A.INTERNAL", port: 80 },
				],
			}),
		/duplicate upstream target/i,
	);
});

test("disabled targets do not participate in active scheme validation", () => {
	const result = normalizeProxyHostPool({
		upstreams: [
			{ scheme: "http", host: "a.internal", port: 80 },
			{ scheme: "https", host: "future.internal", port: 443, enabled: false },
		],
	});
	assert.equal(result.forward_scheme, "http");
	assert.equal(result.upstreams[1].enabled, false);
});

test("legacy updates replace the primary target without discarding secondary targets", () => {
	const current = normalizeProxyHostPool({
		upstreams: [
			{ scheme: "http", host: "old-primary.internal", port: 8080 },
			{ scheme: "http", host: "secondary.internal", port: 8080 },
		],
	});

	const result = normalizeProxyHostPool(
		{
			forward_host: "new-primary.internal",
			forward_port: 8081,
		},
		current,
	);

	assert.equal(result.upstreams.length, 2);
	assert.equal(result.upstreams[0].host, "new-primary.internal");
	assert.equal(result.upstreams[0].port, 8081);
	assert.equal(result.upstreams[1].host, "secondary.internal");
});

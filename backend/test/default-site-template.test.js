import assert from "node:assert/strict";
import test from "node:test";
import {
	builtinDefaultSiteTemplate,
	renderDefaultSiteTemplate,
} from "../lib/default-site-template.js";

const context = {
	node: {
		hostname: "npmi-b",
		name: "South Proxy B",
		id: "node-b-id",
		role: "secondary",
		public_url: "https://proxy-b.example.test",
		version: "1.2.0",
		build_commit: "abc123",
		build_date: "2026-09-27T00:00:00Z",
	},
	cluster: {
		enabled: "true",
		protocol: "NPMX",
		protocol_version: "1",
	},
	system: {
		platform: "linux",
		arch: "arm64",
		generated_at: "2026-09-27T00:00:00Z",
	},
};

test("default-site variables render node-local values", () => {
	const output = renderDefaultSiteTemplate(
		"<p>{{node.name}} / {{node.hostname}} / {{node.role}} / {{cluster.protocol}}</p>",
		context,
		{ html: true },
	);
	assert.equal(output, "<p>South Proxy B / npmi-b / secondary / NPMX</p>");
});

test("default-site HTML escapes administrator-controlled node values", () => {
	const output = renderDefaultSiteTemplate("{{node.name}}", {
		...context,
		node: { ...context.node, name: '<img src=x onerror="boom">' },
	});
	assert.equal(output, "&lt;img src=x onerror=&quot;boom&quot;&gt;");
});

test("unknown default-site variables are preserved for troubleshooting", () => {
	assert.equal(
		renderDefaultSiteTemplate("{{node.hostname}} {{future.value}}", context),
		"npmi-b {{future.value}}",
	);
});

test("built-in default page identifies the node that rendered it", () => {
	const output = renderDefaultSiteTemplate(builtinDefaultSiteTemplate(), context);
	assert.match(output, /South Proxy B/);
	assert.match(output, /npmi-b/);
	assert.match(output, /secondary/);
	assert.match(output, /1\.2\.0/);
});

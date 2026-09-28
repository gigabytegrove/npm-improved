import os from "node:os";
import settingModel from "../models/setting.js";
import pjson from "../package.json" with { type: "json" };

export const DEFAULT_SITE_TEMPLATE_VARIABLES = [
	{
		name: "node.hostname",
		description: "Operating-system hostname of the NPM Improved node that served the page.",
	},
	{
		name: "node.name",
		description: "Friendly Instance Sync / NPMX node name, falling back to the system hostname.",
	},
	{
		name: "node.id",
		description: "Stable NPMX / Instance Sync node identifier.",
	},
	{
		name: "node.role",
		description: "Current cluster role: primary, secondary, or standalone.",
	},
	{
		name: "node.public_url",
		description: "Advertised URL configured for this node.",
	},
	{
		name: "node.version",
		description: "Running NPM Improved version.",
	},
	{
		name: "node.build_commit",
		description: "Build commit of the running NPM Improved image.",
	},
	{
		name: "node.build_date",
		description: "Build date of the running NPM Improved image.",
	},
	{
		name: "cluster.enabled",
		description: "Whether Instance Sync / NPMX is enabled on this node.",
	},
	{
		name: "cluster.protocol",
		description: "Cluster exchange protocol name.",
	},
	{
		name: "cluster.protocol_version",
		description: "Cluster exchange protocol version.",
	},
	{
		name: "system.platform",
		description: "Node operating-system platform reported by Node.js.",
	},
	{
		name: "system.arch",
		description: "Node CPU architecture reported by Node.js.",
	},
	{
		name: "system.generated_at",
		description: "UTC timestamp when this local default page was rendered.",
	},
];

const htmlEscape = (value) =>
	String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");

const lookup = (context, name) =>
	String(name || "")
		.split(".")
		.reduce((value, part) => (value && typeof value === "object" ? value[part] : undefined), context);

export const getDefaultSiteTemplateContext = async () => {
	const sync = await settingModel.query().findById("instance-sync").catch(() => null);
	const meta = sync?.meta && typeof sync.meta === "object" ? sync.meta : {};
	const enabled = sync?.value === "enabled";

	return {
		node: {
			hostname: os.hostname(),
			name: meta.node_name || os.hostname(),
			id: meta.node_id || "",
			role: enabled ? meta.role || "primary" : "standalone",
			public_url: meta.public_url || "",
			version: (process.env.NPM_BUILD_VERSION || pjson.version || "unknown").trim(),
			build_commit: process.env.NPM_BUILD_COMMIT || "",
			build_date: process.env.NPM_BUILD_DATE || "",
		},
		cluster: {
			enabled: enabled ? "true" : "false",
			protocol: "NPMX",
			protocol_version: "1",
		},
		system: {
			platform: process.platform,
			arch: process.arch,
			generated_at: new Date().toISOString(),
		},
	};
};

export const renderDefaultSiteTemplate = (template, context, { html = true } = {}) =>
	String(template ?? "").replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (original, name) => {
		const value = lookup(context, name);
		if (typeof value === "undefined" || value === null) return original;
		return html ? htmlEscape(value) : String(value);
	});

export const builtinDefaultSiteTemplate = () => `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>NPM Improved Default Site</title>
	<style>
		:root { color-scheme: light dark; }
		* { box-sizing: border-box; }
		body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px; }
		main { width: min(720px, 100%); background: #111827; border: 1px solid #334155; border-radius: 18px; padding: 32px; box-shadow: 0 22px 60px rgba(0,0,0,.28); }
		h1 { margin: 0 0 12px; font-size: clamp(28px, 5vw, 42px); letter-spacing: -.035em; }
		p { color: #cbd5e1; line-height: 1.6; }
		dl { display: grid; grid-template-columns: max-content 1fr; gap: 8px 18px; margin: 28px 0 0; font-size: 14px; }
		dt { color: #94a3b8; }
		dd { margin: 0; overflow-wrap: anywhere; }
		code { color: #67e8f9; }
	</style>
</head>
<body>
	<main>
		<h1>NPM Improved</h1>
		<p>This hostname is not assigned to a configured Proxy Host on this node.</p>
		<dl>
			<dt>Node</dt><dd><code>{{node.name}}</code></dd>
			<dt>Hostname</dt><dd><code>{{node.hostname}}</code></dd>
			<dt>Role</dt><dd><code>{{node.role}}</code></dd>
			<dt>Version</dt><dd><code>{{node.version}}</code></dd>
			<dt>Node ID</dt><dd><code>{{node.id}}</code></dd>
		</dl>
	</main>
</body>
</html>
`;

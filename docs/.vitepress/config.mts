import { defineConfig } from "vitepress";

export default defineConfig({
	title: "NPM Improved",
	description: "A more resilient, observable, and security-focused Nginx Proxy Manager fork",
	head: [
		["link", { rel: "icon", href: "/icon.png" }],
		[
			"meta",
			{
				name: "description",
				content:
					"NPM Improved is a compatibility-focused Nginx Proxy Manager fork with an independent management control plane, transactional Nginx configuration, certificate lifecycle management, security observability, and managed HTTP protection.",
			},
		],
		["meta", { property: "og:title", content: "NPM Improved" }],
		[
			"meta",
			{
				property: "og:description",
				content:
					"Resilient reverse-proxy management with rollback, certificate lifecycle management, logs, security events, and managed HTTP protection.",
			},
		],
		["meta", { property: "og:type", content: "website" }],
		["meta", { name: "twitter:card", content: "summary" }],
		["meta", { name: "twitter:title", content: "NPM Improved" }],
	],
	metaChunk: true,
	srcDir: "./src",
	outDir: "./dist",
	themeConfig: {
		logo: { src: "/logo.svg", width: 24, height: 24 },
		nav: [
			{ text: "Guide", link: "/guide/" },
			{ text: "Architecture", link: "/architecture/" },
			{ text: "Security", link: "/security/" },
		],
		sidebar: [
			{
				items: [
					{ text: "Guide", link: "/guide/" },
					{ text: "HTTP Protection", link: "/guide/protection" },
					{ text: "Proxy Host High Availability", link: "/guide/high-availability" },
					{ text: "Instance Synchronization", link: "/guide/instance-sync" },
					{ text: "Backup & Disaster Recovery", link: "/guide/disaster-recovery" },
					{ text: "Native Recovery Console", link: "/guide/recovery-console" },
					{ text: "Configuration History", link: "/guide/config-history" },
					{ text: "System Health", link: "/guide/system-health" },
					{ text: "Architecture", link: "/architecture/" },
					{ text: "Security", link: "/security/" },
					{ text: "Setup Instructions", link: "/setup/" },
					{ text: "Advanced Configuration", link: "/advanced-config/" },
					{ text: "Upgrading", link: "/upgrading/" },
					{ text: "Certificates / Certbot", link: "/certbot/" },
					{ text: "Screenshots", link: "/screenshots/" },
					{ text: "Frequently Asked Questions", link: "/faq/" },
					{ text: "Third Party", link: "/third-party/" },
				],
			},
		],
		socialLinks: [
			{
				icon: "github",
				link: "https://github.com/gigabytegrove/npm-improved",
			},
		],
		search: {
			provider: "local",
		},
		footer: {
			message: "Released under the MIT License. Based on Nginx Proxy Manager.",
			copyright: "NPM Improved contributors",
		},
	},
});

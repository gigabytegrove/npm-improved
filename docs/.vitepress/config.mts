import { defineConfig } from "vitepress";

export default defineConfig({
	title: "NPM Improved",
	description: "Reverse proxy management with high availability, recovery, shared MySQL, observability, and a modern Control Center",
	head: [
		["link", { rel: "icon", href: "/npm-improved-mark.webp", type: "image/webp" }],
		[
			"meta",
			{
				name: "description",
				content:
					"NPM Improved is a modernized Nginx Proxy Manager fork with safer configuration changes, backend and node high availability, shared MySQL, disaster recovery, observability, and a redesigned Control Center.",
			},
		],
		["meta", { property: "og:title", content: "NPM Improved" }],
		[
			"meta",
			{
				property: "og:description",
				content:
					"Reverse-proxy management with rollback, high availability, shared MySQL, disaster recovery, certificate lifecycle management, logs, and security visibility.",
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
		logo: { src: "/npm-improved-mark.webp", width: 32, height: 21 },
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
					{ text: "Database & Shared MySQL", link: "/guide/database" },
					{ text: "Backup & Disaster Recovery", link: "/guide/disaster-recovery" },
					{ text: "Native Recovery Console", link: "/guide/recovery-console" },
					{ text: "Configuration History", link: "/guide/config-history" },
					{ text: "System Health", link: "/guide/system-health" },
					{ text: "Update", link: "/guide/update" },
					{ text: "Architecture", link: "/architecture/" },
					{ text: "Security", link: "/security/" },
					{ text: "Setup Instructions", link: "/setup/" },
					{ text: "Advanced Configuration", link: "/advanced-config/" },
					{ text: "Upgrading", link: "/upgrading/" },
					{ text: "Certificates / Certbot", link: "/certbot/" },
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

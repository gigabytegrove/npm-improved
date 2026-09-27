import https from "node:https";
import { ProxyAgent } from "proxy-agent";
import { debug, remoteVersion as logger } from "../logger.js";
import pjson from "../package.json" with { type: "json" };

const VERSION_URL = "https://api.github.com/repos/gigabytegrove/npm-improved/releases/latest";
const BUILD_VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)/;

const getCurrentVersion = () => {
	const buildVersion = process.env.NPM_BUILD_VERSION?.trim();
	const match = buildVersion?.match(BUILD_VERSION_PATTERN);

	if (match) {
		return `v${match[1]}.${match[2]}.${match[3]}`;
	}

	const packageMatch = pjson.version.match(BUILD_VERSION_PATTERN);
	if (!packageMatch) {
		throw new Error(`Invalid NPM Improved package version: ${pjson.version}`);
	}

	return `v${packageMatch[1]}.${packageMatch[2]}.${packageMatch[3]}`;
};

const internalRemoteVersion = {
	cache_timeout: 1000 * 60 * 15,
	last_result: null,
	last_fetch_time: null,

	/**
	 * Fetch the latest NPM Improved release. A repository with no published
	 * release is a valid state and is cached as "no update available".
	 * @return {Promise<{current: string, latest: string | null, update_available: boolean}>}
	 */
	get: async (refresh = false) => {
		const currentVersion = getCurrentVersion();

		if (
			refresh ||
			!internalRemoteVersion.last_result ||
			!internalRemoteVersion.last_fetch_time ||
			Date.now() - internalRemoteVersion.last_fetch_time > internalRemoteVersion.cache_timeout
		) {
			const response = await internalRemoteVersion.fetchUrl(VERSION_URL);

			if (response.statusCode === 404) {
				internalRemoteVersion.last_result = { tag_name: null };
			} else if (response.statusCode < 200 || response.statusCode >= 300) {
				throw new Error(`GitHub release check failed with HTTP ${response.statusCode}`);
			} else {
				internalRemoteVersion.last_result = JSON.parse(response.rawData);
			}

			internalRemoteVersion.last_fetch_time = Date.now();
		} else {
			debug(logger, "Using cached NPM Improved remote version result");
		}

		const latestVersion = internalRemoteVersion.last_result?.tag_name || null;
		return {
			current: currentVersion,
			latest: latestVersion,
			update_available: latestVersion
				? internalRemoteVersion.compareVersions(currentVersion, latestVersion)
				: false,
			release_name: internalRemoteVersion.last_result?.name || null,
			release_notes: internalRemoteVersion.last_result?.body || null,
			published_at: internalRemoteVersion.last_result?.published_at || null,
			release_url: internalRemoteVersion.last_result?.html_url || null,
		};
	},

	fetchUrl: (url) => {
		const agent = new ProxyAgent();
		const headers = {
			Accept: "application/vnd.github+json",
			"User-Agent": `NPM-Improved/${pjson.version}`,
			"X-GitHub-Api-Version": "2022-11-28",
		};

		return new Promise((resolve, reject) => {
			logger.info(`Fetching NPM Improved release metadata from ${url}`);
			return https
				.get(url, { agent, headers }, (res) => {
					res.setEncoding("utf8");
					let rawData = "";
					res.on("data", (chunk) => {
						rawData += chunk;
					});
					res.on("end", () => {
						resolve({
							statusCode: res.statusCode || 0,
							rawData,
						});
					});
				})
				.on("error", (err) => {
					reject(err);
				});
		});
	},

	compareVersions: (current, latest) => {
		const cleanCurrent = current.replace(/^v/, "");
		const cleanLatest = latest.replace(/^v/, "");

		const currentParts = cleanCurrent.split(".").map(Number);
		const latestParts = cleanLatest.split(".").map(Number);

		for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
			const curr = currentParts[i] || 0;
			const lat = latestParts[i] || 0;

			if (lat > curr) return true;
			if (lat < curr) return false;
		}
		return false;
	},
};

export default internalRemoteVersion;

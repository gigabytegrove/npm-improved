import assert from "node:assert/strict";
import test from "node:test";
import internalRemoteVersion from "../internal/remote-version.js";

test("updater discovers the published 1.8.0 beta independently of stable", async (t) => {
	const originalFetch = internalRemoteVersion.fetchUrl;
	const originalBuildVersion = process.env.NPM_BUILD_VERSION;
	t.after(() => {
		internalRemoteVersion.fetchUrl = originalFetch;
		internalRemoteVersion.channel_cache.clear();
		internalRemoteVersion.channel_fetched_at.clear();
		if (originalBuildVersion === undefined) delete process.env.NPM_BUILD_VERSION;
		else process.env.NPM_BUILD_VERSION = originalBuildVersion;
	});
	process.env.NPM_BUILD_VERSION = "1.7.7";
	internalRemoteVersion.channel_cache.clear();
	internalRemoteVersion.channel_fetched_at.clear();
	const urls = [];
	internalRemoteVersion.fetchUrl = async (url) => {
		urls.push(url);
		return {
			statusCode: 200,
			rawData: JSON.stringify(
				url.endsWith("/latest")
					? { tag_name: "v1.7.7", name: "Stable", draft: false, prerelease: false }
					: [
						{ tag_name: "v1.7.7", draft: false, prerelease: false },
						{ tag_name: "v1.8.0-beta.1", name: "Beta", draft: false, prerelease: true },
					],
			),
		};
	};
	const stable = await internalRemoteVersion.get(false, "stable");
	assert.equal(stable.latest, "v1.7.7");
	assert.equal(stable.update_available, false);
	const beta = await internalRemoteVersion.get(false, "beta");
	assert.equal(beta.current, "v1.7.7");
	assert.equal(beta.latest, "v1.8.0-beta.1");
	assert.equal(beta.update_available, true);
	assert.equal(beta.channel, "beta");
	assert.equal(urls.length, 2, "A cached stable response cannot replace beta discovery");
	const cached = await internalRemoteVersion.get(false, "beta");
	assert.equal(cached.latest, "v1.8.0-beta.1");
	assert.equal(urls.length, 2);
});

test("current prerelease version is not incorrectly reduced to stable semver", async (t) => {
	const previous = process.env.NPM_BUILD_VERSION;
	const originalFetch = internalRemoteVersion.fetchUrl;
	t.after(() => {
		internalRemoteVersion.fetchUrl = originalFetch;
		internalRemoteVersion.channel_cache.clear();
		internalRemoteVersion.channel_fetched_at.clear();
		if (previous === undefined) delete process.env.NPM_BUILD_VERSION;
		else process.env.NPM_BUILD_VERSION = previous;
	});
	process.env.NPM_BUILD_VERSION = "1.8.0-beta.1";
	internalRemoteVersion.channel_cache.clear();
	internalRemoteVersion.channel_fetched_at.clear();
	internalRemoteVersion.fetchUrl = async () => ({
		statusCode: 200,
		rawData: JSON.stringify([{ tag_name: "v1.8.0-beta.1", draft: false, prerelease: true }]),
	});
	const result = await internalRemoteVersion.get(true, "beta");
	assert.equal(result.current, "v1.8.0-beta.1");
	assert.equal(result.latest, "v1.8.0-beta.1");
	assert.equal(result.update_available, false);
});

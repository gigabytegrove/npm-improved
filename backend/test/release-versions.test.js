import assert from "node:assert/strict";
import test from "node:test";
import {
	compareReleaseVersions,
	isNewerRelease,
	parseReleaseVersion,
	selectReleaseForChannel,
} from "../lib/release-versions.js";

test("recognizes the exact v1.8.0 dockeradm beta release identity", () => {
	assert.deepEqual(parseReleaseVersion("v1.8.0-beta.1"), {
		major: 1, minor: 8, patch: 0, stage: "beta", iteration: 1,
		tag: "v1.8.0-beta.1",
	});
	assert.equal(isNewerRelease("v1.7.7", "v1.8.0-beta.1"), true);
	assert.equal(isNewerRelease("v1.8.0-beta.1", "v1.7.7"), false);
});

test("retains prerelease identity for a running beta image", () => {
	assert.equal(parseReleaseVersion("v1.7.8-beta.2").tag, "v1.7.8-beta.2");
	assert.equal(isNewerRelease("v1.7.8-beta.1", "v1.7.8-beta.2"), true);
	assert.equal(isNewerRelease("v1.7.8-beta.2", "v1.7.8-beta.1"), false);
	assert.equal(isNewerRelease("v1.7.8-beta.2", "v1.7.8-beta.2"), false);
});

test("SemVer prerelease priority is alpha, beta, rc, stable", () => {
	assert.equal(compareReleaseVersions("v1.7.8-alpha.2", "v1.7.8-beta.1"), -1);
	assert.equal(compareReleaseVersions("v1.7.8-beta.2", "v1.7.8-rc.1"), -1);
	assert.equal(compareReleaseVersions("v1.7.8-rc.1", "v1.7.8"), -1);
	assert.equal(isNewerRelease("v1.7.8", "v1.7.8-beta.3"), false);
	assert.equal(isNewerRelease("v1.7.9-beta.1", "v1.7.8"), false);
});

test("selects newest beta by version, never by GitHub response order", () => {
	const releases = [
		{ tag_name: "v1.7.7", draft: false, prerelease: false },
		{ tag_name: "v1.7.8-beta.1", draft: false, prerelease: true },
		{ tag_name: "v1.7.8-beta.4", draft: true, prerelease: true },
		{ tag_name: "v1.7.8-beta.2", draft: false, prerelease: true },
		{ tag_name: "v1.7.8-rc.1", draft: false, prerelease: true },
		{ tag_name: "v1.7.8-beta.99", draft: false, prerelease: false },
		{ tag_name: "android-v0.1.0-beta.11", draft: false, prerelease: true },
	];
	assert.equal(selectReleaseForChannel(releases, "beta").tag_name, "v1.7.8-beta.2");
	assert.equal(selectReleaseForChannel(releases, "alpha").tag_name, "v1.7.8-rc.1");
});

test("never treats a missing channel as a current installed release", () => {
	assert.deepEqual(selectReleaseForChannel([], "beta"), { tag_name: null });
	assert.deepEqual(selectReleaseForChannel([{ tag_name: "v1.7.7", draft: false, prerelease: false }], "beta"), { tag_name: null });
	assert.equal(isNewerRelease("v1.7.7", "untrusted-tag"), false);
	assert.equal(parseReleaseVersion("v1.7.8-beta.foo"), null);
	assert.equal(parseReleaseVersion(null), null);
	assert.throws(() => selectReleaseForChannel([], "nightly"), /Unsupported/);
});

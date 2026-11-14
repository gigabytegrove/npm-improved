/**
 * Release channel selection and SemVer precedence, independent of GitHub's
 * publication ordering. A stable release outranks all prereleases of the same
 * base version. Invalid or unrelated tag names are never offered as updates.
 */
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)(?:[.-](\d+))?)?$/i;
const STAGES = { alpha: 0, beta: 1, rc: 2 };

export const parseReleaseVersion = (value) => {
	if (typeof value !== "string") return null;
	const match = VERSION.exec(value.trim());
	if (!match) return null;
	const major = Number(match[1]);
	const minor = Number(match[2]);
	const patch = Number(match[3]);
	const stage = match[4]?.toLowerCase() ?? null;
	const iteration = match[5] === undefined ? 0 : Number(match[5]);
	if (![major, minor, patch, iteration].every(Number.isSafeInteger)) return null;
	return {
		major, minor, patch, stage, iteration,
		tag: `v${major}.${minor}.${patch}${stage ? `-${stage}.${iteration}` : ""}`,
	};
};

export const compareReleaseVersions = (left, right) => {
	const a = parseReleaseVersion(left);
	const b = parseReleaseVersion(right);
	if (!a || !b) return null;
	for (const key of ["major", "minor", "patch"]) {
		if (a[key] !== b[key]) return Math.sign(a[key] - b[key]);
	}
	const aRank = a.stage === null ? 3 : STAGES[a.stage];
	const bRank = b.stage === null ? 3 : STAGES[b.stage];
	if (aRank !== bRank) return Math.sign(aRank - bRank);
	if (a.iteration !== b.iteration) return Math.sign(a.iteration - b.iteration);
	return 0;
};

export const isNewerRelease = (current, candidate) =>
	compareReleaseVersions(candidate, current) === 1;

export const selectReleaseForChannel = (releases, channel) => {
	if (!Array.isArray(releases)) throw new Error("Unexpected GitHub release list");
	if (!["beta", "alpha"].includes(channel)) throw new Error("Unsupported prerelease channel");
	let selected = null;
	for (const release of releases) {
		if (!release || release.draft || !release.prerelease) continue;
		const parsed = parseReleaseVersion(release.tag_name);
		if (!parsed) continue;
		if (channel === "beta" && parsed.stage !== "beta") continue;
		if (channel === "alpha" && !["alpha", "rc"].includes(parsed.stage)) continue;
		if (!selected || compareReleaseVersions(release.tag_name, selected.tag_name) === 1) {
			selected = release;
		}
	}
	return selected || { tag_name: null };
};

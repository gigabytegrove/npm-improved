import { compareReleaseVersions, parseReleaseVersion } from "./release-versions.js";

export const npmxVersionAlignment = (localVersion, peerVersion) => {
	const local = parseReleaseVersion(localVersion);
	const peer = parseReleaseVersion(peerVersion);
	if (!local || !peer) return { valid: false, older: null, target: null };
	const comparison = compareReleaseVersions(local.tag, peer.tag);
	return {
		valid: true,
		older: comparison < 0 ? "local" : comparison > 0 ? "peer" : null,
		target: comparison < 0 ? peer.tag : comparison > 0 ? local.tag : null,
	};
};

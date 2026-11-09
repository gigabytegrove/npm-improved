// A secondary can operate in pull-only mode: it knows the primary's
// address, but does not need to advertise a management URL reachable by
// the primary. Do not block primary-owned HTTP-01 issuance on that
// optional reverse connection. Report omitted probes explicitly.
export const selectAcmePreflightPeers = (node) => {
	if (node.role === "secondary") {
		return {
			peers: [{ node_id: "primary", public_url: node.primaryUrl || "" }],
			skipped: [],
		};
	}
	if (node.role !== "primary") {
		return { peers: [], skipped: [] };
	}
	const secondaryPeers = (Array.isArray(node.peers) ? node.peers : [])
		.filter((peer) => peer.role === "secondary" && peer.node_id !== node.nodeId);
	return {
		peers: secondaryPeers.filter((peer) =>
			typeof peer.public_url === "string" && peer.public_url.trim().length > 0),
		skipped: secondaryPeers
			.filter((peer) => typeof peer.public_url !== "string" || !peer.public_url.trim())
			.map((peer) => peer.node_id),
	};
};

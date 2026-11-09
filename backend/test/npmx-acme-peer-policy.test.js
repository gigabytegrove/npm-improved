import assert from "node:assert/strict";
import test from "node:test";
import { selectAcmePreflightPeers } from "../lib/npmx-acme-peer-policy.js";

test("primary does not block issuance for pull-only secondary without a public URL", () => {
	const result = selectAcmePreflightPeers({
		role: "primary",
		nodeId: "primary-id",
		peers: [
			{ node_id: "bb1a3d98-e2a7-4d52-bf1e-aaed210bbb37", role: "secondary", public_url: "" },
			{ node_id: "primary-id", role: "primary", public_url: "https://example.org" },
		],
	});
	assert.deepEqual(result.peers, []);
	assert.deepEqual(result.skipped, ["bb1a3d98-e2a7-4d52-bf1e-aaed210bbb37"]);
});

test("primary still probes secondaries that advertise a reachable NPMX URL", () => {
	const peer = { node_id: "secondary-id", role: "secondary", public_url: "http://192.0.2.5:81" };
	const result = selectAcmePreflightPeers({
		role: "primary", nodeId: "primary-id",
		peers: [peer, { node_id: "pull-only", role: "secondary", public_url: "  " }],
	});
	assert.deepEqual(result.peers, [peer]);
	assert.deepEqual(result.skipped, ["pull-only"]);
});

test("secondary must continue checking its primary even when the primary URL is absent", () => {
	const result = selectAcmePreflightPeers({
		role: "secondary", nodeId: "secondary-id", primaryUrl: "",
	});
	assert.deepEqual(result, {
		peers: [{ node_id: "primary", public_url: "" }],
		skipped: [],
	});
});

test("unknown roles do not acquire implicit peer access", () => {
	assert.deepEqual(selectAcmePreflightPeers({ role: "observer" }), {
		peers: [], skipped: [],
	});
});

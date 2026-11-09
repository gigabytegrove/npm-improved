import assert from "node:assert/strict";
import test from "node:test";
import {
	acknowledgeAcmeGate,
	createAcmeGate,
	listAcmeGates,
} from "../lib/npmx-acme-gates.js";

test("an NPMX readiness gate requires acknowledgements from every paired node", async () => {
	const gate = createAcmeGate({
		hostId: 41,
		domains: ["demo.example.com"],
		peerIds: ["node-2", "node-4"],
		token: "test-token", value: "proof", timeoutMs: 3000,
	});
	try {
		const active = listAcmeGates().find((item) => item.id === gate.id);
		assert.equal(active.host_id, 41);
		assert.equal(active.token, "test-token");
		assert.equal(active.value, "proof");
		assert.deepEqual(active.domain_names, ["demo.example.com"]);
		assert.equal(acknowledgeAcmeGate({
			gateId: gate.id, nodeId: "node-2", hostId: 41,
			domains: ["demo.example.com"], phase: "host",
		}), true);
		assert.equal(acknowledgeAcmeGate({
			gateId: gate.id, nodeId: "unknown", hostId: 41,
			domains: ["demo.example.com"], phase: "host",
		}), false);
		assert.equal(acknowledgeAcmeGate({
			gateId: gate.id, nodeId: "node-4", hostId: 42,
			domains: ["demo.example.com"], phase: "host",
		}), false);
		assert.equal(acknowledgeAcmeGate({
			gateId: gate.id, nodeId: "node-4", hostId: 41,
			domains: ["different.example.com"], phase: "host",
		}), false);
		assert.equal(acknowledgeAcmeGate({
			gateId: gate.id, nodeId: "node-4", hostId: 41,
			domains: ["demo.example.com"], phase: "host",
		}), true);
		await gate.wait();
	} finally {
		gate.close();
	}
	assert.equal(listAcmeGates().some((item) => item.id === gate.id), false);
});

test("certificate deployment acknowledgements cannot satisfy a host-phase gate", async () => {
	const gate = createAcmeGate({
		hostId: 7, domains: ["demo.example.com"],
		peerIds: ["node-4"], phase: "certificate", certificateId: 55, timeoutMs: 3000,
	});
	try {
		assert.equal(acknowledgeAcmeGate({
			gateId: gate.id, nodeId: "node-4", hostId: 7,
			domains: ["demo.example.com"], phase: "host",
		}), false);
		assert.equal(acknowledgeAcmeGate({
			gateId: gate.id, nodeId: "node-4", hostId: 7,
			domains: ["demo.example.com"], phase: "certificate",
		}), true);
		await gate.wait();
	} finally {
		gate.close();
	}
});

test("unacknowledged gates time out, fail closed and can be cleaned up", async () => {
	const gate = createAcmeGate({
		hostId: 18, domains: ["demo.example.com"],
		peerIds: ["offline-node"], timeoutMs: 25,
	});
	try {
		await assert.rejects(gate.wait(), /offline-node/);
		assert.equal(acknowledgeAcmeGate({
			gateId: gate.id, nodeId: "offline-node", hostId: 18,
			domains: ["demo.example.com"], phase: "host",
		}), false);
	} finally {
		gate.close();
	}
});

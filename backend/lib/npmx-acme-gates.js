import crypto from "node:crypto";

const gates = new Map();
const MAX_GATE_AGE_MS = 180_000;

const identicalDomains = (a, b) =>
	Array.isArray(a) && Array.isArray(b) &&
	a.length === b.length && a.every((value, index) => value === b[index]);

export const listAcmeGates = () => {
	const now = Date.now();
	return [...gates.values()].filter((gate) => gate.expiresAt > now).map((gate) => ({
		id: gate.id,
		host_id: gate.hostId,
		domain_names: [...gate.domains],
		phase: gate.phase,
		certificate_id: gate.certificateId,
		...(gate.token ? { token: gate.token, value: gate.value } : {}),
	}));
};

export const createAcmeGate = ({ hostId, domains, peerIds, phase = "host", certificateId = null, token = "", value = "", timeoutMs = MAX_GATE_AGE_MS }) => {
	if (!Number.isInteger(hostId) || hostId < 1 || !Array.isArray(domains) || !domains.length ||
		!["host", "certificate"].includes(phase)) {
		throw new TypeError("Invalid NPMX ACME gate configuration");
	}
	const id = crypto.randomUUID();
	const peers = new Set(peerIds);
	const gate = {
		id, hostId, domains: [...domains], phase, certificateId, token, value,
		peers, acknowledged: new Set(), expiresAt: Date.now() + timeoutMs,
	};
	gates.set(id, gate);
	return {
		id,
		wait: async () => {
			while (Date.now() < gate.expiresAt) {
				if ([...gate.peers].every((peer) => gate.acknowledged.has(peer))) return;
				await new Promise((resolve) => setTimeout(resolve, 750));
			}
			const missing = [...gate.peers].filter((peer) => !gate.acknowledged.has(peer));
			throw new Error(`NPMX ACME ${phase} readiness timed out; nodes did not acknowledge: ${missing.join(", ")}`);
		},
		close: () => gates.delete(id),
	};
};

export const acknowledgeAcmeGate = ({ gateId, nodeId, hostId, domains, phase }) => {
	const gate = gates.get(gateId);
	if (!gate || Date.now() >= gate.expiresAt || !gate.peers.has(nodeId) ||
		gate.hostId !== hostId || gate.phase !== phase || !identicalDomains(gate.domains, domains)) {
		return false;
	}
	gate.acknowledged.add(nodeId);
	return true;
};

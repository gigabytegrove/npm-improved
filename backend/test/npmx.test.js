import assert from "node:assert/strict";
import test from "node:test";
import {
	createNpmxHeaders,
	createNpmxPairingCode,
	createNpmxPairingProof,
	createNpmxPairingResponseProof,
	decryptNpmxPairingSecret,
	deriveNpmxPairingKey,
	encryptNpmxPairingSecret,
	generateNpmxEphemeralKeyPair,
	generateNpmxSecret,
	generateNpmxTokenId,
	hashNpmxSecret,
	parseNpmxPairingCode,
	verifyNpmxPairingProof,
	verifyNpmxPairingResponseProof,
	verifyNpmxRequestSignature,
} from "../lib/npmx.js";

test("NPMX pairing codes round-trip and expire", () => {
	const expiresAt = new Date(Date.now() + 60_000).toISOString();
	const tokenSecret = generateNpmxSecret();
	const tokenId = generateNpmxTokenId();
	const code = createNpmxPairingCode({
		primaryUrl: "https://primary.example.test",
		tokenId,
		tokenSecret,
		expiresAt,
	});
	const parsed = parseNpmxPairingCode(code);
	assert.equal(parsed.url, "https://primary.example.test");
	assert.equal(parsed.id, tokenId);
	assert.equal(parsed.token, tokenSecret);
	assert.equal(parsed.exp, expiresAt);
	assert.throws(
		() =>
			parseNpmxPairingCode(
				createNpmxPairingCode({
					primaryUrl: "https://primary.example.test",
					tokenId,
					tokenSecret,
					expiresAt: new Date(Date.now() - 1000).toISOString(),
				}),
			),
		/expired/,
	);
});

test("NPMX pairing proofs authenticate one-time join requests", () => {
	const token = generateNpmxSecret();
	const details = {
		tokenId: generateNpmxTokenId(),
		nodeId: "node-a",
		nodePublicKey: "public-key",
		timestamp: new Date().toISOString(),
		nonce: "nonce-123456789",
	};
	const proof = createNpmxPairingProof(token, details);
	assert.equal(verifyNpmxPairingProof(hashNpmxSecret(token), details, proof), true);
	assert.equal(
		verifyNpmxPairingProof(hashNpmxSecret(generateNpmxSecret()), details, proof),
		false,
	);
});

test("NPMX pairing encrypts the persistent cluster secret with ephemeral X25519 keys", () => {
	const token = generateNpmxSecret();
	const client = generateNpmxEphemeralKeyPair();
	const server = generateNpmxEphemeralKeyPair();
	const clientKey = deriveNpmxPairingKey({
		privateKey: client.privateKey,
		peerPublicKey: server.publicKey,
		tokenSecret: token,
	});
	const serverKey = deriveNpmxPairingKey({
		privateKey: server.privateKey,
		peerPublicKey: client.publicKey,
		tokenSecretHash: hashNpmxSecret(token),
	});
	assert.deepEqual(clientKey, serverKey);

	const clusterSecret = generateNpmxSecret();
	const encrypted = encryptNpmxPairingSecret(clusterSecret, serverKey, "pair:node");
	assert.equal(decryptNpmxPairingSecret(encrypted, clientKey, "pair:node"), clusterSecret);

	const responseDetails = {
		tokenId: "pair",
		nodeId: "node",
		serverPublicKey: server.publicKey,
		...encrypted,
		timestamp: new Date().toISOString(),
		nonce: "response-nonce",
	};
	const proof = createNpmxPairingResponseProof(hashNpmxSecret(token), responseDetails);
	assert.equal(verifyNpmxPairingResponseProof(token, responseDetails, proof), true);
});

test("NPMX request signatures cover method, path, node, nonce, timestamp, and body", () => {
	const secret = generateNpmxSecret();
	const body = { node_id: "node-b", nested: { z: 2, a: 1 } };
	const headers = createNpmxHeaders({
		secret,
		nodeId: "node-b",
		method: "POST",
		path: "/cluster/npmx/heartbeat",
		body,
	});
	const valid = verifyNpmxRequestSignature(
		secret,
		{
			method: "POST",
			path: "/cluster/npmx/heartbeat",
			nodeId: headers["X-NPMX-Node"],
			timestamp: headers["X-NPMX-Timestamp"],
			nonce: headers["X-NPMX-Nonce"],
			body,
		},
		headers["X-NPMX-Signature"],
	);
	assert.equal(valid, true);
	assert.equal(
		verifyNpmxRequestSignature(
			secret,
			{
				method: "POST",
				path: "/cluster/npmx/heartbeat",
				nodeId: headers["X-NPMX-Node"],
				timestamp: headers["X-NPMX-Timestamp"],
				nonce: headers["X-NPMX-Nonce"],
				body: { ...body, changed: true },
			},
			headers["X-NPMX-Signature"],
		),
		false,
	);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  createLegacyPrepareProof,
  verifyLegacyPrepareProof,
  createLegacyPrepareResponseProof,
  verifyLegacyPrepareResponseProof,
  connectionCodeType,
} from "../lib/npmx-legacy-bridge.js";
import {
  createNpmxPairingCode, generateNpmxSecret, generateNpmxTokenId,
  hashNpmxSecret, parseNpmxPairingCode,
  generateNpmxEphemeralKeyPair, deriveNpmxPairingKey,
  encryptNpmxPairingSecret, decryptNpmxPairingSecret,
} from "../lib/npmx.js";

test("valid original npmx1 pairing code is recognized and parsed for compatibility", () => {
  const code = createNpmxPairingCode({
    primaryUrl: "http://192.168.0.18:81",
    tokenId: generateNpmxTokenId(), tokenSecret: generateNpmxSecret(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(connectionCodeType(code), "legacy");
  assert.equal(parseNpmxPairingCode(code).url, "http://192.168.0.18:81");
  assert.equal(connectionCodeType("npmxr1.encoded"), "current");
  assert.equal(connectionCodeType("unexpected"), "unknown");
});

test("legacy token authorizes a peer-bound upgrade handshake and protects the primary URL", () => {
  const tokenHash = hashNpmxSecret(generateNpmxSecret());
  const primaryKeys = generateNpmxEphemeralKeyPair();
  const secondaryKeys = generateNpmxEphemeralKeyPair();
  const prepared = {
    token_id: generateNpmxTokenId(),
    node_id: "original-secondary-id",
    primary_url: "http://192.168.0.17:81",
    server_public_key: primaryKeys.publicKey,
    timestamp: new Date().toISOString(),
    nonce: "nonce-proof-0123456789",
  };
  prepared.proof = createLegacyPrepareProof(tokenHash, prepared);
  assert.equal(verifyLegacyPrepareProof(tokenHash, prepared), true);
  assert.equal(verifyLegacyPrepareProof(tokenHash, { ...prepared, node_id: "forged" }), false);
  assert.equal(verifyLegacyPrepareProof(tokenHash, { ...prepared, primary_url: "http://evil.example" }), false);

  const response = {
    ...prepared,
    client_public_key: secondaryKeys.publicKey,
    version: "1.8.0-beta.9",
    timestamp: new Date().toISOString(),
  };
  response.proof = createLegacyPrepareResponseProof(tokenHash, response);
  assert.equal(verifyLegacyPrepareResponseProof(tokenHash, response), true);
  assert.equal(verifyLegacyPrepareResponseProof(tokenHash, {
    ...response, client_public_key: primaryKeys.publicKey,
  }), false);
  assert.equal(verifyLegacyPrepareResponseProof(tokenHash, {
    ...response, version: "1.7.0",
  }), false);
});

test("legacy code upgrades to encrypted primary secret bound to original peer ID", () => {
  const token = generateNpmxSecret();
  const tokenHash = hashNpmxSecret(token);
  const primary = generateNpmxEphemeralKeyPair();
  const secondary = generateNpmxEphemeralKeyPair();
  const originalClusterSecret = generateNpmxSecret();
  const tokenId = generateNpmxTokenId();
  const peerId = "original-secondary-id";
  const primaryKey = deriveNpmxPairingKey({
    privateKey: primary.privateKey, peerPublicKey: secondary.publicKey,
    tokenSecretHash: tokenHash,
  });
  const encrypted = encryptNpmxPairingSecret(originalClusterSecret, primaryKey,
    tokenId + ":" + peerId);
  const secondaryKey = deriveNpmxPairingKey({
    privateKey: secondary.privateKey, peerPublicKey: primary.publicKey,
    tokenSecretHash: tokenHash,
  });
  assert.equal(decryptNpmxPairingSecret(encrypted, secondaryKey, tokenId + ":" + peerId),
    originalClusterSecret);
  assert.throws(() =>
    decryptNpmxPairingSecret(encrypted, secondaryKey, tokenId + ":another-node"));
  assert.throws(() =>
    decryptNpmxPairingSecret(encrypted,
      deriveNpmxPairingKey({ privateKey: secondary.privateKey, peerPublicKey: primary.publicKey,
        tokenSecretHash: hashNpmxSecret(generateNpmxSecret()) }),
      tokenId + ":" + peerId));
});

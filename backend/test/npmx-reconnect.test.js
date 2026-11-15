import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createNpmxReconnectCode, parseNpmxReconnectCode,
  reconnectPayloadSignature, verifyReconnectPayload,
} from "../lib/npmx-reconnect.js";
import {
  decryptNpmxPairingSecret, deriveNpmxPairingKey, encryptNpmxPairingSecret,
  generateNpmxEphemeralKeyPair, generateNpmxSecret, generateNpmxTokenId,
  hashNpmxSecret,
} from "../lib/npmx.js";

const invite = () => {
  const secondary = generateNpmxEphemeralKeyPair();
  const tokenId = generateNpmxTokenId();
  const tokenSecret = generateNpmxSecret();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const code = createNpmxReconnectCode({
    secondaryUrl: "http://192.168.0.18:81",
    tokenId, tokenSecret, publicKey: secondary.publicKey, expiresAt,
    nodeName: "proxy2",
  });
  return { secondary, tokenId, tokenSecret, expiresAt, code };
};

test("the SECONDARY issues a short-lived reconnect code with no cluster credential", () => {
  const value = invite();
  const payload = parseNpmxReconnectCode(value.code);
  assert.equal(payload.url, "http://192.168.0.18:81");
  assert.equal(payload.name, "proxy2");
  assert.equal(payload.id, value.tokenId);
  assert.equal(payload.key, value.secondary.publicKey);
  assert.equal(payload.token, value.tokenSecret);
  assert.ok(value.code.startsWith("npmxr1."));
  assert.ok(!value.code.includes("cluster-secret"));
});

test("primary sends original secret only encrypted under the secondary's ephemeral key", () => {
  const value = invite();
  const parsed = parseNpmxReconnectCode(value.code);
  const primary = generateNpmxEphemeralKeyPair();
  const originalClusterSecret = generateNpmxSecret();
  const expectedPeerId = "bb1a3d98-e2a7-4d52-bf1e-aaed210bbb37";
  const tokenHash = hashNpmxSecret(parsed.token);
  const keyAtPrimary = deriveNpmxPairingKey({
    privateKey: primary.privateKey, peerPublicKey: parsed.key, tokenSecretHash: tokenHash,
  });
  const encrypted = encryptNpmxPairingSecret(originalClusterSecret, keyAtPrimary,
    parsed.id + ":" + expectedPeerId);
  const data = {
    token_id: parsed.id, node_id: expectedPeerId,
    primary_url: "http://192.168.0.17:81",
    server_public_key: primary.publicKey, ...encrypted,
    timestamp: new Date().toISOString(), nonce: "noncetest0123456789",
    version: "1.8.0-beta.7",
  };
  data.proof = reconnectPayloadSignature(tokenHash, data);
  assert.equal(verifyReconnectPayload(tokenHash, data), true);

  const keyAtSecondary = deriveNpmxPairingKey({
    privateKey: value.secondary.privateKey, peerPublicKey: data.server_public_key,
    tokenSecretHash: hashNpmxSecret(value.tokenSecret),
  });
  assert.equal(
    decryptNpmxPairingSecret(data, keyAtSecondary, parsed.id + ":" + expectedPeerId),
    originalClusterSecret,
  );
  assert.throws(
    () => decryptNpmxPairingSecret(data, keyAtSecondary, parsed.id + ":wrong-peer"),
  );
  assert.equal(verifyReconnectPayload(tokenHash, { ...data, node_id: "wrong-peer" }), false);
  assert.equal(verifyReconnectPayload(tokenHash, { ...data, primary_url: "http://evil.test" }), false);
  assert.equal(verifyReconnectPayload(tokenHash, { ...data, ciphertext: "tampered" }), false);
});

test("expired and forged reconnect invitations are rejected", () => {
  const value = invite();
  const expired = createNpmxReconnectCode({
    secondaryUrl: "http://192.168.0.18:81",
    tokenId: value.tokenId, tokenSecret: value.tokenSecret,
    publicKey: value.secondary.publicKey, nodeName: "proxy2",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  assert.throws(() => parseNpmxReconnectCode(expired), /expired/);
  assert.throws(() => parseNpmxReconnectCode("not-a-code"), /Invalid/);
  assert.throws(() => createNpmxReconnectCode({
    secondaryUrl: "http://user:password@192.168.0.18:81",
    tokenId: value.tokenId, tokenSecret: value.tokenSecret,
    publicKey: value.secondary.publicKey, nodeName: "proxy2",
    expiresAt: value.expiresAt,
  }), /origin/);
});

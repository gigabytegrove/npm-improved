import crypto from "node:crypto";

export const NPMX_RECONNECT_PREFIX = "npmxr1";
/**
 * Upgrades can leave a former secondary reporting "primary" with no peers.
 * Such a node may initiate a secondary reconnect without altering settings.
 * A primary which actually owns enrolled peers must not be converted.
 */
export const canInitiateSecondaryReconnect = (meta = {}) =>
  meta.role !== "primary" || !(Array.isArray(meta.peers) && meta.peers.length > 0);


// The code is a short-lived, operator-carried invitation from the secondary.
// It contains an ephemeral PUBLIC key and a one-time token, never the cluster secret.
export const createNpmxReconnectCode = ({
  secondaryUrl, tokenId, tokenSecret, publicKey, expiresAt, nodeName,
}) => {
  const url = new URL(secondaryUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/") {
    throw new Error("Secondary URL must be an http(s) origin without credentials or a path");
  }
  if (!tokenId || !tokenSecret || !publicKey || !expiresAt || !nodeName) {
    throw new Error("Incomplete NPMX reconnect invitation");
  }
  if (String(nodeName).length > 100) {
    throw new Error("NPMX node name is too long");
  }
  return NPMX_RECONNECT_PREFIX + "." + Buffer.from(JSON.stringify({
    v: 1,
    url: url.origin,
    id: String(tokenId),
    token: String(tokenSecret),
    key: String(publicKey),
    exp: String(expiresAt),
    name: String(nodeName),
  })).toString("base64url");
};

export const parseNpmxReconnectCode = (code) => {
  const value = String(code || "").trim();
  if (value.startsWith("npmx1.")) {
    throw new Error("This is an old primary-generated NPMX code (npmx1). Generate a new reconnect code on the secondary, then paste its npmxr1 code into the primary.");
  }
  if (value.length > 8192 || !value.startsWith(NPMX_RECONNECT_PREFIX + ".")) {
    throw new Error("Invalid NPMX reconnect code. Generate a new npmxr1 code on the secondary and paste it into the primary.");
  }
  let payload;
  try {
    const [, encoded, extra] = value.split(".");
    if (!encoded || extra !== undefined) throw new Error("invalid");
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid secondary-generated NPMX reconnect code");
  }
  if (payload?.v !== 1 ||
      typeof payload.url !== "string" ||
      typeof payload.id !== "string" || !/^[a-zA-Z0-9_-]{10,128}$/.test(payload.id) ||
      typeof payload.token !== "string" || !/^[a-zA-Z0-9_-]{32,256}$/.test(payload.token) ||
      typeof payload.key !== "string" || payload.key.length < 32 || payload.key.length > 512 ||
      typeof payload.name !== "string" || !payload.name || payload.name.length > 100 ||
      typeof payload.exp !== "string" ||
      !Number.isFinite(Date.parse(payload.exp)) ||
      Date.parse(payload.exp) <= Date.now()) {
    throw new Error("Invalid or expired NPMX reconnect code");
  }
  let url;
  try { url = new URL(payload.url); } catch { throw new Error("Invalid NPMX secondary address"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash || url.origin !== payload.url) {
    throw new Error("Invalid NPMX secondary address");
  }
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(payload.key, "base64url"),
      format: "der",
      type: "spki",
    });
    if (key.asymmetricKeyType !== "x25519") throw new Error("key type");
  } catch {
    throw new Error("NPMX reconnect code has an invalid ephemeral key");
  }
  return payload;
};


export const reconnectPayloadSignature = (tokenHash, payload) => {
  const fields = ["token_id", "node_id", "primary_url", "server_public_key",
    "iv", "tag", "ciphertext", "timestamp", "nonce", "version"];
  const message = ["NPMX-RECONNECT-1", ...fields.map((name) => String(payload?.[name] || ""))].join("\n");
  return crypto.createHmac("sha256", String(tokenHash)).update(message, "utf8").digest("base64url");
};

export const verifyReconnectPayload = (tokenHash, payload) => {
  const expected = Buffer.from(reconnectPayloadSignature(tokenHash, payload), "utf8");
  const supplied = Buffer.from(String(payload?.proof || ""), "utf8");
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
};

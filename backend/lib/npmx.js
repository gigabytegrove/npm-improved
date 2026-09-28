import crypto from "node:crypto";

export const NPMX_PROTOCOL = "npmx";
export const NPMX_VERSION = 1;
export const NPMX_PAIRING_PREFIX = "npmx1";
export const NPMX_PAIRING_TTL_SECONDS = 10 * 60;
export const NPMX_AUTH_WINDOW_SECONDS = 5 * 60;

const b64url = (value) => Buffer.from(value).toString("base64url");

const safeEqualText = (left, right) => {
	const a = Buffer.from(String(left || ""), "utf8");
	const b = Buffer.from(String(right || ""), "utf8");
	if (a.length !== b.length) return false;
	return crypto.timingSafeEqual(a, b);
};

export const generateNpmxSecret = () => crypto.randomBytes(32).toString("base64url");
export const generateNpmxTokenId = () => crypto.randomBytes(12).toString("base64url");
export const generateNpmxNonce = () => crypto.randomBytes(18).toString("base64url");
export const hashNpmxSecret = (secret) =>
	crypto.createHash("sha256").update(String(secret || ""), "utf8").digest("base64url");

export const canonicalJson = (value) => {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	return `{${Object.keys(value)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
		.join(",")}}`;
};

const bodyDigest = (body) =>
	crypto.createHash("sha256").update(canonicalJson(body ?? null), "utf8").digest("base64url");

const requestCanonical = ({ method, path, nodeId, timestamp, nonce, body }) =>
	[
		"NPMX-AUTH-1",
		String(method || "").toUpperCase(),
		String(path || ""),
		String(nodeId || ""),
		String(timestamp || ""),
		String(nonce || ""),
		bodyDigest(body),
	].join("\n");

export const createNpmxRequestSignature = (secret, details) =>
	crypto
		.createHmac("sha256", hashNpmxSecret(secret))
		.update(requestCanonical(details), "utf8")
		.digest("base64url");

export const verifyNpmxRequestSignature = (secret, details, supplied) =>
	safeEqualText(createNpmxRequestSignature(secret, details), supplied);

export const createNpmxHeaders = ({ secret, nodeId, method, path, body }) => {
	const timestamp = new Date().toISOString();
	const nonce = generateNpmxNonce();
	return {
		"X-NPMX-Protocol": NPMX_PROTOCOL,
		"X-NPMX-Version": String(NPMX_VERSION),
		"X-NPMX-Node": String(nodeId || ""),
		"X-NPMX-Timestamp": timestamp,
		"X-NPMX-Nonce": nonce,
		"X-NPMX-Signature": createNpmxRequestSignature(secret, {
			method,
			path,
			nodeId,
			timestamp,
			nonce,
			body,
		}),
	};
};

export const createNpmxPairingCode = ({ primaryUrl, tokenId, tokenSecret, expiresAt }) => {
	const payload = {
		v: NPMX_VERSION,
		url: String(primaryUrl || "").replace(/\/$/, ""),
		id: String(tokenId || ""),
		token: String(tokenSecret || ""),
		exp: String(expiresAt || ""),
	};
	if (!payload.url || !payload.id || !payload.token || !payload.exp) {
		throw new Error("NPMX pairing code payload is incomplete");
	}
	return `${NPMX_PAIRING_PREFIX}.${b64url(JSON.stringify(payload))}`;
};

export const parseNpmxPairingCode = (code) => {
	const value = String(code || "").trim();
	const [prefix, encoded, ...extra] = value.split(".");
	if (prefix !== NPMX_PAIRING_PREFIX || !encoded || extra.length) {
		throw new Error("Invalid NPMX pairing code");
	}

	let payload;
	try {
		payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
	} catch {
		throw new Error("Invalid NPMX pairing code");
	}

	if (
		payload?.v !== NPMX_VERSION ||
		typeof payload.url !== "string" ||
		typeof payload.id !== "string" ||
		typeof payload.token !== "string" ||
		typeof payload.exp !== "string" ||
		!payload.url ||
		!payload.id ||
		payload.token.length < 32
	) {
		throw new Error("Unsupported or incomplete NPMX pairing code");
	}

	if (!Number.isFinite(Date.parse(payload.exp)) || Date.parse(payload.exp) <= Date.now()) {
		throw new Error("NPMX pairing code has expired");
	}

	return payload;
};

export const generateNpmxEphemeralKeyPair = () => {
	const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
	return {
		privateKey,
		publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
	};
};

const importNpmxPublicKey = (encoded) =>
	crypto.createPublicKey({
		key: Buffer.from(String(encoded || ""), "base64url"),
		format: "der",
		type: "spki",
	});

export const deriveNpmxPairingKey = ({
	privateKey,
	peerPublicKey,
	tokenSecret,
	tokenSecretHash,
}) => {
	const shared = crypto.diffieHellman({
		privateKey,
		publicKey: importNpmxPublicKey(peerPublicKey),
	});
	const salt = tokenSecretHash
		? Buffer.from(String(tokenSecretHash), "base64url")
		: crypto.createHash("sha256").update(String(tokenSecret || ""), "utf8").digest();
	return Buffer.from(
		crypto.hkdfSync(
			"sha256",
			shared,
			salt,
			Buffer.from("NPMX v1 pairing", "utf8"),
			32,
		),
	);
};

export const encryptNpmxPairingSecret = (secret, key, aad = "") => {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
	if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
	const ciphertext = Buffer.concat([
		cipher.update(String(secret || ""), "utf8"),
		cipher.final(),
	]);
	return {
		iv: iv.toString("base64url"),
		tag: cipher.getAuthTag().toString("base64url"),
		ciphertext: ciphertext.toString("base64url"),
	};
};

export const decryptNpmxPairingSecret = (payload, key, aad = "") => {
	const decipher = crypto.createDecipheriv(
		"aes-256-gcm",
		key,
		Buffer.from(String(payload?.iv || ""), "base64url"),
	);
	if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
	decipher.setAuthTag(Buffer.from(String(payload?.tag || ""), "base64url"));
	return Buffer.concat([
		decipher.update(Buffer.from(String(payload?.ciphertext || ""), "base64url")),
		decipher.final(),
	]).toString("utf8");
};

const pairingRequestCanonical = ({ tokenId, nodeId, nodePublicKey, timestamp, nonce }) =>
	[
		"NPMX-PAIR-REQUEST-1",
		String(tokenId || ""),
		String(nodeId || ""),
		String(nodePublicKey || ""),
		String(timestamp || ""),
		String(nonce || ""),
	].join("\n");

export const createNpmxPairingProof = (tokenSecret, details) =>
	crypto
		.createHmac("sha256", hashNpmxSecret(tokenSecret))
		.update(pairingRequestCanonical(details), "utf8")
		.digest("base64url");

export const verifyNpmxPairingProof = (tokenSecretHash, details, supplied) => {
	const expected = crypto
		.createHmac("sha256", String(tokenSecretHash || ""))
		.update(pairingRequestCanonical(details), "utf8")
		.digest("base64url");
	return safeEqualText(expected, supplied);
};

const pairingResponseCanonical = ({
	tokenId,
	nodeId,
	serverPublicKey,
	iv,
	tag,
	ciphertext,
	timestamp,
	nonce,
}) =>
	[
		"NPMX-PAIR-RESPONSE-1",
		String(tokenId || ""),
		String(nodeId || ""),
		String(serverPublicKey || ""),
		String(iv || ""),
		String(tag || ""),
		String(ciphertext || ""),
		String(timestamp || ""),
		String(nonce || ""),
	].join("\n");

export const createNpmxPairingResponseProof = (tokenSecretHash, details) =>
	crypto
		.createHmac("sha256", String(tokenSecretHash || ""))
		.update(pairingResponseCanonical(details), "utf8")
		.digest("base64url");

export const verifyNpmxPairingResponseProof = (tokenSecret, details, supplied) => {
	const expected = crypto
		.createHmac("sha256", hashNpmxSecret(tokenSecret))
		.update(pairingResponseCanonical(details), "utf8")
		.digest("base64url");
	return safeEqualText(expected, supplied);
};

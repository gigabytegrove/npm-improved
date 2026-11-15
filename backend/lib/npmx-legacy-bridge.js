import crypto from "node:crypto";

const sign = (tokenHash, marker, payload, fields) =>
	crypto.createHmac("sha256", String(tokenHash))
		.update([marker, ...fields.map((key) => String(payload?.[key] ?? ""))].join("\n"), "utf8")
		.digest("base64url");
const verify = (expected, supplied) => {
	const left = Buffer.from(String(expected), "utf8");
	const right = Buffer.from(String(supplied || ""), "utf8");
	return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const PREPARE_FIELDS = Object.freeze([
	"token_id", "node_id", "primary_url", "server_public_key", "timestamp", "nonce",
]);
const RESPONSE_FIELDS = Object.freeze([
	"token_id", "node_id", "primary_url", "server_public_key",
	"client_public_key", "version", "timestamp", "nonce",
]);

export const createLegacyPrepareProof = (tokenHash, message) =>
	sign(tokenHash, "NPMX-LEGACY-PREPARE-1", message, PREPARE_FIELDS);
export const verifyLegacyPrepareProof = (tokenHash, message) =>
	verify(createLegacyPrepareProof(tokenHash, message), message?.proof);

export const createLegacyPrepareResponseProof = (tokenHash, message) =>
	sign(tokenHash, "NPMX-LEGACY-PREPARE-RESPONSE-1", message, RESPONSE_FIELDS);
export const verifyLegacyPrepareResponseProof = (tokenHash, message) =>
	verify(createLegacyPrepareResponseProof(tokenHash, message), message?.proof);

export const isLegacyPairingCode = (code) => String(code || "").trim().startsWith("npmx1.");
export const connectionCodeType = (code) =>
	isLegacyPairingCode(code) ? "legacy" : String(code || "").trim().startsWith("npmxr1.") ? "current" : "unknown";

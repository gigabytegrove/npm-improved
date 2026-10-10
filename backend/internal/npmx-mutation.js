import authModel from "../models/auth.js";
import Token from "../models/token.js";
import userModel from "../models/user.js";
import errs from "../lib/error.js";
import { describeNpmxWrite, recordFingerprint, validPrecondition } from "../lib/npmx-write-policy.js";
import db from "../db.js";

const MUTATION_TIMEOUT = 120_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REQUEST_BYTES = 96 * 1024;

// A primary-side lock serializes managed configuration writes, including
// direct writes and relayed writes. Baseline checking and the mutation cannot
// race because the lock is held until the HTTP response is completed.
let outstanding = 0;
let queue = Promise.resolve();

export async function lockConfigurationWrite(res) {
	if (outstanding >= 128) throw new errs.ValidationError("Configuration update queue is full");
	outstanding++;
	let unlock;
	const hold = new Promise((resolve) => { unlock = resolve; });
	const before = queue;
	queue = queue.then(() => hold);
	await before;
	let done = false;
	const release = () => {
		if (done) return;
		done = true;
		outstanding--;
		unlock();
	};
	res.once("finish", release);
	res.once("close", release);
	return release;
}

export async function checkWriteBaseline(req, res, descriptor) {
	const expected = req.get("X-NPMX-Expected-Fingerprint");
	if (expected === undefined) return true;
	if (!validPrecondition(expected)) throw new errs.ValidationError("Invalid NPMX precondition");
	if (descriptor.key === null || expected !== await recordFingerprint(db(), descriptor)) {
		res.status(409).send({
			error: { code: 409,
				message: "This configuration changed on the primary since the last node sync. Refresh and retry; your edit was not applied." },
		});
		return false;
	}
	return true;
}

export async function validateLocalActor(token) {
	const claim = await Token().load(token);
	const userId = Number(claim?.attrs?.id);
	if (!Number.isSafeInteger(userId) || userId < 1 ||
		!Array.isArray(claim?.scope) || !claim.scope.includes("user")) {
		throw new errs.PermissionError("A signed user session is required to modify cluster configuration.");
	}
	const user = await userModel.query().findById(userId);
	if (!user || user.is_deleted || user.is_disabled) {
		throw new errs.PermissionError("The authenticated user is not active.");
	}
	const auth = await authModel.query().where("user_id", userId).where("type", "password").first();
	if (auth?.meta?.password_changed_at && Number.isFinite(claim.iat) &&
		claim.iat < auth.meta.password_changed_at) {
		throw new errs.TokenRevokedError("The user session was revoked.");
	}
	return { id: userId, issuedAt: claim.iat };
}

export function validateMutationPayload(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new errs.ValidationError("Invalid NPMX write");
	const method = String(value.method || "").toUpperCase();
	const path = String(value.path || "");
	const descriptor = describeNpmxWrite(method, path);
	if (!descriptor) throw new errs.ValidationError("This operation cannot be relayed through NPMX");
	if (!validPrecondition(value.expected_fingerprint ?? null)) {
		throw new errs.ValidationError("Invalid NPMX write baseline");
	}
	if (descriptor.key !== null && value.expected_fingerprint === undefined) {
		throw new errs.ValidationError("NPMX updates must include a synchronization baseline");
	}
	const actor = Number(value.actor_id);
	if (!Number.isSafeInteger(actor) || actor < 1) throw new errs.ValidationError("Invalid NPMX actor");
	const issuedAt = Number(value.actor_iat);
	if (!Number.isSafeInteger(issuedAt) || issuedAt < 1 || issuedAt > Math.ceil(Date.now()/1000)+60)
		throw new errs.ValidationError("Invalid initiating session timestamp");
	const query = String(value.query || "");
	if (query && (!query.startsWith("?") || query.length > 2048 || /[#\r\n]/.test(query))) {
		throw new errs.ValidationError("Invalid NPMX query");
	}
	const body = value.body ?? {};
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new errs.ValidationError("NPMX writes must contain a JSON object");
	}
	if (Buffer.byteLength(JSON.stringify(body)) > MAX_REQUEST_BYTES) {
		throw new errs.ValidationError("NPMX write exceeds the safe size limit");
	}
	return { method, path, query, body, descriptor, actor, issuedAt, baseline: value.expected_fingerprint };
}

export async function applyAuthorizedWrite(value) {
	const checked = validateMutationPayload(value);
	const user = await userModel.query().findById(checked.actor);
	if (!user || user.is_deleted || user.is_disabled) {
		throw new errs.PermissionError("The user no longer exists on the primary.");
	}
	// The primary reissues a short-lived credential for the authenticated
	// actor. Standard primary-side handlers enforce access and ownership.
	const password = await authModel.query().where("user_id", checked.actor).where("type", "password").first();
	if (password?.meta?.password_changed_at && checked.issuedAt < password.meta.password_changed_at) {
		throw new errs.TokenRevokedError("The initiating user session was revoked on the primary.");
	}
	const credential = await Token().create({
		attrs: { id: checked.actor },
		scope: ["user"],
		expiresIn: "2m",
	});
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), MUTATION_TIMEOUT);
	try {
		const headers = {
			Authorization: "Bearer " + credential.token,
			"Content-Type": "application/json",
		};
		if (checked.baseline !== null && checked.baseline !== undefined)
			headers["X-NPMX-Expected-Fingerprint"] = checked.baseline;
		const response = await fetch(
			"http://127.0.0.1:3000" + checked.path + checked.query,
			{ method: checked.method, headers, body: JSON.stringify(checked.body), signal: controller.signal },
		);
		const length = Number(response.headers.get("content-length") || 0);
		if (length > MAX_RESPONSE_BYTES) throw new Error("Primary response exceeded safety limit");
		const data = await response.arrayBuffer();
		if (data.byteLength > MAX_RESPONSE_BYTES) throw new Error("Primary response exceeded safety limit");
		return { status: response.status,
			content_type: response.headers.get("content-type") || "application/json",
			body: Buffer.from(data).toString("utf8") };
	} finally {
		clearTimeout(timeout);
	}
}

export function applyForwardedResponse(res, payload) {
	if (!payload || !Number.isInteger(payload.status) || payload.status < 200 || payload.status > 599 ||
		typeof payload.body !== "string" || payload.body.length > MAX_RESPONSE_BYTES) {
		throw new Error("Primary returned an invalid NPMX response");
	}
	res.set("X-NPMX-Write-Authority", "primary");
	res.status(payload.status);
	if (payload.status === 204) return res.end();
	if ((payload.content_type || "").includes("application/json")) {
		res.set("Content-Type", "application/json; charset=utf-8");
		return res.send(payload.body);
	}
	throw new Error("Primary returned unsupported NPMX write response format");
}

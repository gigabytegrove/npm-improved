import crypto from "node:crypto";
import { canonicalJson } from "./npmx.js";

/**
 * NPMX primary-arbitrated mutations. Never choose an independent DB ID or a
 * client-supplied timestamp as the order of two conflicting writes.
 *
 * Each mutating HTTP request on a secondary is forwarded to the primary,
 * which allocates IDs and serializes writes. Existing-row mutations carry a
 * hash of the secondary's last received snapshot for stale-edit detection.
 */
const TABLES = Object.freeze({
	"proxy-hosts": "proxy_host",
	"redirection-hosts": "redirection_host",
	"dead-hosts": "dead_host",
	streams: "stream",
	"access-lists": "access_list",
	certificates: "certificate",
});

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function describeNpmxWrite(method, urlPath) {
	if (!MUTATION_METHODS.has(String(method).toUpperCase())) return null;
	const path = String(urlPath || "");
	if (!path.startsWith("/") || path.includes("//") || path.includes("..") || path.includes("?")) return null;
	const segments = path.split("/").filter(Boolean);
	if (segments[0] === "nginx" && TABLES[segments[1]]) {
		if (segments.length > 4 || (segments.length > 2 && !/^[1-9]\d*$/.test(segments[2]))) return null;
		if (segments.length === 4 && !["enable", "disable", "renew", "test", "toggle"].includes(segments[3]))
			return null;
		return { table: TABLES[segments[1]], key: segments[2] ? Number(segments[2]) : null };
	}
	if (segments[0] === "settings" && segments.length === 2 && /^[A-Za-z0-9_-]{1,128}$/.test(segments[1])) {
		// Cluster settings are node-specific and are handled by /cluster directly.
		if (segments[1] === "instance-sync") return null;
		return { table: "setting", key: segments[1] };
	}
	if (segments[0] === "users" && segments.length >= 1 && segments.length <= 3) {
		if (segments.length >= 2 && !/^[1-9]\d*$/.test(segments[1])) return null;
		if (segments.length === 3 && !["enable", "disable"].includes(segments[2])) return null;
		return { table: "user", key: segments[1] ? Number(segments[1]) : null };
	}
	return null;
}

export function snapshotFingerprint(row) {
	if (row == null) return "missing";
	return crypto.createHash("sha256").update(canonicalJson(row)).digest("hex");
}

export async function recordFingerprint(knex, descriptor) {
	if (descriptor.key == null) return null;
	const row = await knex(descriptor.table).where("id", descriptor.key).first();
	return snapshotFingerprint(row);
}

export function validPrecondition(value) {
	return value === null || value === "missing" || /^[a-f0-9]{64}$/.test(String(value));
}

export function pathIsMutableOnSecondary(method, path) {
	return describeNpmxWrite(method, path) !== null;
}

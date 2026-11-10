import fs from "node:fs";
import path from "node:path";

const ACCESS_ROOT = "/data/access";
const SECURITY_FIELDS = Object.freeze({
	access_list: ["name", "owner_user_id", "satisfy_any", "pass_auth", "is_deleted"],
	access_list_auth: ["access_list_id", "username", "password"],
	access_list_client: ["access_list_id", "address", "directive"],
});

const scalar = (value) => value === null || value === undefined ? "" :
	typeof value === "boolean" ? (value ? "1" : "0") : String(value);
const deleted = (row) => scalar(row.is_deleted) === "1";

export function assertAccessListSnapshot(database, filesystem) {
	const lists = database?.access_list;
	const users = database?.access_list_auth;
	const clients = database?.access_list_client;
	const entries = filesystem?.roots?.access;
	if (![lists, users, clients, entries].every(Array.isArray)) {
		throw new Error("NPMX access-list synchronization requires access lists, credentials, clients, and /data/access assets");
	}
	const files = new Map(entries.filter((entry) => entry.type === "file").map((entry) => [entry.path, entry]));
	const knownIds = new Set(lists.map((list) => scalar(list.id)));
	for (const record of [...users, ...clients]) {
		if (!knownIds.has(scalar(record.access_list_id))) {
			throw new Error(`NPMX access-list record ${scalar(record.access_list_id)} has no parent list`);
		}
	}
	for (const list of lists) {
		if (deleted(list)) continue;
		const id = scalar(list.id);
		if (!/^[1-9]\d*$/.test(id)) throw new Error("NPMX access-list ID is invalid");
		const file = files.get(id);
		if (!file || typeof file.data !== "string") {
			throw new Error(`NPMX access list #${id} is missing its /data/access/${id} authorization file`);
		}
		const contents = Buffer.from(file.data, "base64").toString("utf8");
		const lines = new Set(contents.split(/\r?\n/).filter(Boolean).map((line) => line.split(":", 1)[0]));
		for (const item of users.filter((item) => scalar(item.access_list_id) === id)) {
			if (!lines.has(scalar(item.username))) {
				throw new Error(`NPMX access list #${id} is missing a configured authentication user in its authorization file`);
			}
		}
	}
}

export function assertAppliedClusterDatabase(expected, actual) {
	if (!expected || !actual) throw new Error("NPMX database verification payload is missing");
	for (const [table, sourceRows] of Object.entries(expected)) {
		const targetRows = actual[table];
		if (!Array.isArray(sourceRows) || !Array.isArray(targetRows) || sourceRows.length !== targetRows.length) {
			throw new Error(`NPMX database synchronization mismatch for ${table}: row counts differ`);
		}
		const sourceById = new Map(sourceRows.map((row) => [scalar(row.id), row]));
		const targetById = new Map(targetRows.map((row) => [scalar(row.id), row]));
		if (sourceById.size !== sourceRows.length || targetById.size !== targetRows.length) {
			throw new Error(`NPMX database synchronization mismatch for ${table}: duplicate row IDs`);
		}
		for (const [id, source] of sourceById) {
			const target = targetById.get(id);
			if (!target) throw new Error(`NPMX database synchronization mismatch for ${table}: record ${id} missing`);
			for (const field of SECURITY_FIELDS[table] || []) {
				if (scalar(source[field]) !== scalar(target[field])) {
					throw new Error(`NPMX database synchronization mismatch for ${table}: record ${id} field ${field}`);
				}
			}
		}
	}
}

export function assertAppliedClusterFiles(filesystem, roots, fileSystem = fs) {
	for (const [name, entries] of Object.entries(filesystem.roots)) {
		if (name === "default_www") continue; // The default site is rendered per-node.
		const root = roots[name];
		if (!root || !Array.isArray(entries)) throw new Error(`NPMX filesystem root ${name} is invalid`);
		for (const entry of entries) {
			const target = path.join(root, entry.path);
			let stat;
			try {
				stat = fileSystem.lstatSync(target);
			} catch {
				throw new Error(`NPMX filesystem synchronization mismatch in ${name}: missing ${entry.path}`);
			}
			if (entry.type === "directory") {
				if (!stat.isDirectory()) throw new Error(`NPMX filesystem synchronization mismatch in ${name}: ${entry.path} is not a directory`);
			} else if (entry.type === "symlink") {
				if (!stat.isSymbolicLink() || fileSystem.readlinkSync(target) !== entry.target) {
					throw new Error(`NPMX filesystem synchronization mismatch in ${name}: ${entry.path} link changed`);
				}
			} else if (entry.type === "file") {
				if (!stat.isFile() || !Buffer.from(entry.data, "base64").equals(fileSystem.readFileSync(target))) {
					throw new Error(`NPMX filesystem synchronization mismatch in ${name}: ${entry.path} content changed`);
				}
			} else {
				throw new Error(`NPMX filesystem synchronization mismatch in ${name}: unsupported entry`);
			}
		}
	}
}

export const NPMX_ACCESS_ROOT = ACCESS_ROOT;

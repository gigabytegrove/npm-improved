import assert from "node:assert/strict";
import { test } from "node:test";
import {
	assertAccessListSnapshot,
	assertAppliedClusterDatabase,
	assertAppliedClusterFiles,
} from "../lib/npmx-snapshot-audit.js";

const database = () => ({
	access_list: [{ id: 12, name: "LAN only", owner_user_id: 1, satisfy_any: false, pass_auth: true, is_deleted: false }],
	access_list_auth: [{ id: 6, access_list_id: 12, username: "alice", password: "secret" }],
	access_list_client: [{ id: 7, access_list_id: 12, address: "192.168.0.0/24", directive: "allow" }],
	proxy_host: [{ id: 44, access_list_id: 12 }],
	setting: [{ id: "default-site", value: "default" }],
});
const filesystem = () => ({ roots: { access: [{ path: "12", type: "file", data: Buffer.from("alice:$apr1$hash\n").toString("base64") }] } });

test("accepts complete access-list snapshots and records", () => {
	assert.doesNotThrow(() => assertAccessListSnapshot(database(), filesystem()));
	assert.doesNotThrow(() => assertAppliedClusterDatabase(database(), structuredClone(database())));
});

test("fails closed when access assets were omitted by the publisher", () => {
	assert.throws(() => assertAccessListSnapshot(database(), { roots: {} }), /requires access lists/);
	assert.throws(() => assertAccessListSnapshot(database(), { roots: { access: [] } }), /missing its/);
});

test("fails closed when credentials were not compiled into authorization assets", () => {
	const snapshot = filesystem();
	snapshot.roots.access[0].data = Buffer.from("bob:$apr1$hash\n").toString("base64");
	assert.throws(() => assertAccessListSnapshot(database(), snapshot), /missing a configured authentication user/);
});

test("fails closed on missing and mismatched replicated database records", () => {
	const missing = database();
	missing.access_list_client = [];
	assert.throws(() => assertAppliedClusterDatabase(database(), missing), /row counts differ/);
	const modified = database();
	modified.access_list_auth[0].password = "wrong";
	assert.throws(() => assertAppliedClusterDatabase(database(), modified), /field password/);
	const hostMissing = database();
	hostMissing.proxy_host[0].id = 99;
	assert.throws(() => assertAppliedClusterDatabase(database(), hostMissing), /record 44 missing/);
});

test("checks all replicated filesystem roots and their bytes", () => {
	const source = filesystem();
	source.roots.custom_nginx = [{ path: "default.conf", type: "file", data: Buffer.from("allow all;\n").toString("base64") }];
	const roots = { access: "/data/access", custom_nginx: "/data/nginx/custom" };
	const files = new Map([
		["/data/access/12", Buffer.from("alice:$apr1$hash\n")],
		["/data/nginx/custom/default.conf", Buffer.from("allow all;\n")],
	]);
	const fakeFs = {
		lstatSync(file) { if (!files.has(file)) throw new Error("missing"); return { isFile: () => true }; },
		readFileSync(file) { return files.get(file); },
	};
	assert.doesNotThrow(() => assertAppliedClusterFiles(source, roots, fakeFs));
	files.set("/data/nginx/custom/default.conf", Buffer.from("deny all;\n"));
	assert.throws(() => assertAppliedClusterFiles(source, roots, fakeFs), /content changed/);
	files.delete("/data/access/12");
	assert.throws(() => assertAppliedClusterFiles(source, roots, fakeFs), /missing 12/);
});

test("rejects orphaned access-list child records", () => {
	const bad = database();
	bad.access_list_client[0].access_list_id = 1000;
	assert.throws(() => assertAccessListSnapshot(bad, filesystem()), /no parent list/);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
	describeNpmxWrite,
	snapshotFingerprint,
	recordFingerprint,
	validPrecondition,
} from "../lib/npmx-write-policy.js";

test("NPMX forwards only supported synchronized configuration mutations", () => {
	assert.deepEqual(describeNpmxWrite("PUT", "/nginx/proxy-hosts/51"), {table:"proxy_host",key:51});
	assert.deepEqual(describeNpmxWrite("POST", "/nginx/proxy-hosts"), {table:"proxy_host",key:null});
	assert.deepEqual(describeNpmxWrite("DELETE", "/nginx/proxy-hosts/51"), {table:"proxy_host",key:51});
	assert.deepEqual(describeNpmxWrite("PUT", "/nginx/proxy-hosts/51/enable"), {table:"proxy_host",key:51});
	assert.deepEqual(describeNpmxWrite("PUT", "/nginx/redirection-hosts/2"), {table:"redirection_host",key:2});
	assert.deepEqual(describeNpmxWrite("PUT", "/nginx/dead-hosts/3"), {table:"dead_host",key:3});
	assert.deepEqual(describeNpmxWrite("PUT", "/nginx/streams/7"), {table:"stream",key:7});
	assert.deepEqual(describeNpmxWrite("PUT", "/nginx/access-lists/8"), {table:"access_list",key:8});
	assert.deepEqual(describeNpmxWrite("PUT", "/settings/default-site"), {table:"setting",key:"default-site"});
	assert.deepEqual(describeNpmxWrite("PUT", "/users/2"), {table:"user",key:2});
	for (const [method,path] of [
		["GET","/nginx/proxy-hosts/51"],["POST","/database/migrate"],
		["POST","/disaster-recovery/restore"],["PUT","/settings/instance-sync"],
		["POST","/analytics/node/rules"],["PUT","/nginx/proxy-hosts/../../users/1"],
		["PUT","/nginx/proxy-hosts/0"],["PUT","/nginx/proxy-hosts/1/forbidden"],
		["PUT","/settings"],["PATCH","/nginx/proxy-hosts/1?notAllowed=1"],
	]) assert.equal(describeNpmxWrite(method,path),null,method+" "+path);
});

test("snapshot fingerprint is canonical, detects edits, and preserves deletions", async () => {
	const original={id:9,domain_names:'["example.com"]',enabled:1};
	const same={enabled:1,id:9,domain_names:'["example.com"]'};
	const changed={...same,enabled:0};
	assert.equal(snapshotFingerprint(original),snapshotFingerprint(same));
	assert.notEqual(snapshotFingerprint(original),snapshotFingerprint(changed));
	assert.equal(snapshotFingerprint(null),"missing");
	assert.equal(validPrecondition("missing"),true);
	assert.equal(validPrecondition(snapshotFingerprint(original)),true);
	assert.equal(validPrecondition("invalid"),false);
	assert.equal(validPrecondition(undefined),false);

	const mockDb=(table)=>({
		where(field,value) {
			assert.equal(table,"proxy_host");
			assert.equal(field,"id");
			assert.equal(value,9);
			return {first:async()=>original};
		},
	});
	const descriptor=describeNpmxWrite("PUT","/nginx/proxy-hosts/9");
	assert.equal(await recordFingerprint(mockDb,descriptor),snapshotFingerprint(original));
	assert.equal(await recordFingerprint(mockDb,{table:"proxy_host",key:null}),null);
});

test("concurrent unrelated creations never trust secondary independent row IDs",()=>{
	assert.equal(describeNpmxWrite("POST","/nginx/proxy-hosts").key,null);
	assert.equal(describeNpmxWrite("POST","/nginx/streams").key,null);
});

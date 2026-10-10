import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { explainCertbotFailure, readNewCertbotLog, snapshotCertbotLog } from "../lib/certbot-diagnostics.js";

const domain = "osc.gigabytegrove.net";
const failure = (status) => JSON.stringify({
	error: {
		type: "urn:ietf:params:acme:error:unauthorized",
		detail: "76.250.238.65: Invalid response from http://" + domain + "/.well-known/acme-challenge/private-token-" + status + ": " + status,
		status: Number(status),
	},
});

test("reports the actual forbidden NPMX node without exposing challenge tokens", () => {
	const message = explainCertbotFailure(failure("403"), [domain]);
	assert.match(message, /76\.250\.238\.65/);
	assert.match(message, /403/);
	assert.match(message, /access lists/i);
	assert.doesNotMatch(message, /private-token/);
});

test("explains missing token on a secondary node", () => {
	const message = explainCertbotFailure(failure("404"), [domain]);
	assert.match(message, /404/);
	assert.match(message, /NPMX challenge forwarding/i);
});

test("never reflects an unrelated domain, token, or arbitrary raw log", () => {
	const text = JSON.stringify({ detail: "76.250.238.65: Invalid response from http://other.example.com/.well-known/acme-challenge/secret-token: 403" });
	const message = explainCertbotFailure(text, [domain]);
	assert.match(message, /could not complete the certificate challenge/i);
	assert.doesNotMatch(message, /other\.example\.com|secret-token/i);
});

test("explains Let's Encrypt DNS and timeout problems", () => {
	assert.match(explainCertbotFailure(JSON.stringify({ detail: "DNS problem: NXDOMAIN looking up A for osc.gigabytegrove.net" }), [domain]), /DNS/i);
	assert.match(explainCertbotFailure(JSON.stringify({ detail: "Connection refused when connecting to proxy" }), [domain]), /port 80/i);
});

test("only reads log entries appended during this Certbot invocation", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "npmi-certbot-"));
	const filename = path.join(dir, "letsencrypt.log");
	try {
		fs.writeFileSync(filename, failure("403") + "\n");
		const snapshot = snapshotCertbotLog(filename);
		fs.appendFileSync(filename, failure("404") + "\n");
		const latest = readNewCertbotLog(snapshot);
		assert.match(latest, /404/);
		assert.doesNotMatch(latest, /403/);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

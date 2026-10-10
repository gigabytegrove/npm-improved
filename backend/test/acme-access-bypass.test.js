import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("ACME is isolated from GG Private-style access rules in proxy templates", () => {
	const proxy = read("backend/templates/proxy_host.conf");
	const auth = read("backend/templates/_access.conf");
	const cert = read("backend/templates/_certificates.conf");
	const acme = read("docker/rootfs/etc/nginx/conf.d/include/letsencrypt-acme-challenge.conf");
	assert.match(proxy, /location \/ \{\s*\{% include "_access\.conf" %\}/);
	assert.match(auth, /deny all;/);
	assert.match(cert, /include conf\.d\/include\/letsencrypt-acme-challenge\.conf;/);
	assert.ok(cert.indexOf("letsencrypt-acme-challenge.conf") < cert.indexOf("{% if certificate"));
	assert.match(acme, /location \^~ \/\.well-known\/acme-challenge\//);
	assert.match(acme, /auth_basic off;/);
	assert.match(acme, /auth_request off;/);
	assert.match(acme, /allow all;/);
	assert.match(acme, /proxy_pass http:\/\/127\.0\.0\.1:3000\/api\/cluster\/acme\//);
});

test("forced HTTPS exempts any HTTP-01 challenge token, not just a test file", () => {
	const forcedSsl = read("docker/rootfs/etc/nginx/conf.d/include/force-ssl.conf");
	assert.match(forcedSsl, /if \(\$uri ~ "\^\/\\\.well-known\/acme-challenge\/\[A-Za-z0-9_-\]\{1,128\}\$"\)/);
	assert.doesNotMatch(forcedSsl, /request_uri = \/\.well-known\/acme-challenge\/test-challenge/);
	assert.match(forcedSsl, /if \(\$test = H\)/);
});

test("production Docker build includes the forced-HTTPS exception", () => {
	const dockerfile = read("docker/Dockerfile");
	assert.match(dockerfile, /COPY docker\/rootfs\/etc\/nginx\/conf\.d\/include\/force-ssl\.conf \/etc\/nginx\/conf\.d\/include\/force-ssl\.conf/);
});

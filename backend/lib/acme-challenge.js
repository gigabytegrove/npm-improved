import fs from "node:fs";
import path from "node:path";

export const ACME_WEBROOT = "/data/letsencrypt-acme-challenge/.well-known/acme-challenge";
export const validAcmeToken = (token) => typeof token === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(token);

export const readLocalAcmeToken = (token, webroot = ACME_WEBROOT) => {
	if (!validAcmeToken(token)) return null;
	try {
		const value = fs.readFileSync(path.join(webroot, token));
		return value.length > 0 && value.length <= 4096 ? value.toString("utf8") : null;
	} catch (err) {
		if (err?.code === "ENOENT") return null;
		throw err;
	}
};

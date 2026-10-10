import fs from "node:fs";

const LOG_PATH = "/data/logs/letsencrypt.log";
const MAX_LOG_BYTES = 256 * 1024;
const SAFE_DOMAIN = /^[a-z0-9*-]+(?:\.[a-z0-9-]+)+$/i;

export const snapshotCertbotLog = (filename = LOG_PATH) => {
	try {
		const stat = fs.statSync(filename);
		return { filename, ino: stat.ino, size: stat.size };
	} catch {
		return { filename, ino: null, size: 0 };
	}
};

export const readNewCertbotLog = (snapshot) => {
	let fd;
	try {
		fd = fs.openSync(snapshot.filename, "r");
		const stat = fs.fstatSync(fd);
		const offset = stat.ino === snapshot.ino && stat.size >= snapshot.size ? snapshot.size : 0;
		const start = Math.max(offset, stat.size - MAX_LOG_BYTES);
		const length = stat.size - start;
		if (length <= 0) return "";
		const data = Buffer.alloc(length);
		const read = fs.readSync(fd, data, 0, length, start);
		return data.subarray(0, read).toString("utf8");
	} catch {
		return "";
	} finally {
		if (fd !== undefined) fs.closeSync(fd);
	}
};

const safeDomainName = (name) => {
	const domain = String(name || "").trim().toLowerCase();
	return SAFE_DOMAIN.test(domain) && domain.length <= 253 ? domain : "";
};

const isNamedHost = (hostname, domainNames) => {
	const normalized = safeDomainName(hostname);
	return normalized && domainNames.some((domain) => safeDomainName(domain) === normalized);
};

const parseAcmeDetails = (text) => {
	const details = [];
	const jsonDetail = /"detail"\s*:\s*("(?:[^"\\]|\\.)*")/g;
	for (const match of String(text || "").matchAll(jsonDetail)) {
		try {
			const value = JSON.parse(match[1]);
			if (typeof value === "string") details.push(value);
		} catch {
			// Ignore malformed diagnostic log lines.
		}
	}
	for (const match of String(text || "").matchAll(/^\s*Detail:\s*(.+)$/gm)) {
		details.push(match[1].trim());
	}
	return details;
};

export const explainCertbotFailure = (logText, domainNames = []) => {
	const names = (Array.isArray(domainNames) ? domainNames : []).map(safeDomainName).filter(Boolean);
	const target = names.length === 1 ? names[0] : "One or more domains";
	const details = parseAcmeDetails(logText).reverse();

	for (const detail of details) {
		// The challenge token itself is deliberately not included in error messages.
		const response = detail.match(/(?:^|\s)([0-9a-f:.]+): Invalid response from https?:\/\/([^/\s]+)\/\.well-known\/acme-challenge\/[A-Za-z0-9_-]+:\s*(\d{3})/i);
		if (!response || !isNamedHost(response[2], names)) continue;
		const [, address, domain, status] = response;
		const label = domain.toLowerCase() + ": Let's Encrypt reached proxy node " + address + " but received HTTP " + status + ". ";
		if (status === "403") return label + "The verification request was forbidden. The ACME challenge must bypass host access lists, IP/user-agent blocking, and authentication on every NPMX node.";
		if (status === "404") return label + "The challenge token was not found on that node. Check that NPMX challenge forwarding is working and the node has the latest NPMi version.";
		if (status === "401") return label + "The verification request required authentication. ACME challenges must bypass the host access list.";
		if (["500", "502", "503", "504"].includes(status)) return label + "The ACME responder or an NPMX peer was unavailable. Check cluster connectivity and node health.";
		if (status.startsWith("3")) return label + "The ACME request was redirected. HTTP-01 validation must reach the challenge responder on port 80.";
		return label + "The challenge URL did not return the expected token.";
	}

	const full = details.join("\n");
	if (/\b(?:connection refused|connection timed out|timeout during connect|i\/o timeout)\b/i.test(full)) {
		return target + ": Let's Encrypt could not connect to the HTTP-01 challenge responder. Check public port 80, routing, and NPMX node availability.";
	}
	if (/\b(?:NXDOMAIN|DNS problem|no valid (?:a|aaaa) records|SERVFAIL)\b/i.test(full)) {
		return target + ": Let's Encrypt could not resolve the hostname. Check its public DNS A/AAAA records.";
	}
	if (/\b(?:rateLimited|rate limit|too many failed authorizations)\b/i.test(full)) {
		return target + ": Let's Encrypt is rate-limiting certificate requests. Resolve the validation issue before retrying.";
	}
	if (/\b(?:CAA record|caa)\b/i.test(full)) {
		return target + ": Certificate issuance is restricted by the domain's DNS CAA policy.";
	}
	return target + ": Let's Encrypt could not complete the certificate challenge. Check that the ACME HTTP-01 endpoint is reachable on every public NPMX node; review the server log for further details.";
};

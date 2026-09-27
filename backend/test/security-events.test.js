import assert from "node:assert/strict";
import test from "node:test";
import {
	classifyAccessRecord,
	parseAccessLogLine,
	summarizeSecurityRecords,
} from "../lib/security-events.js";

const line = (uri, status = 404, ip = "198.51.100.20") =>
	`[26/Sep/2026:23:15:04 -0400] - - ${status} - GET https example.com "${uri}" [Client ${ip}] [Length 123] [Gzip -] [Sent-to 10.0.0.4] "scanner/1.0" "-"`;

test("parses NPM proxy access log records", () => {
	const record = parseAccessLogLine(line("/.env", 404));
	assert.ok(record);
	assert.equal(record.status, 404);
	assert.equal(record.host, "example.com");
	assert.equal(record.clientIp, "198.51.100.20");
	assert.equal(record.uri, "/.env");
	assert.equal(record.timestamp, "2026-09-27T03:15:04.000Z");
});

test("parses standard access log records without upstream fields", () => {
	const record = parseAccessLogLine(
		'[26/Sep/2026:23:15:04 -0400] 200 - GET http example.com "/" [Client 203.0.113.8] [Length 12] [Gzip -] "Mozilla/5.0" "-"',
	);
	assert.ok(record);
	assert.equal(record.status, 200);
	assert.equal(record.upstreamStatus, null);
});

test("classifies concrete sensitive-file and traversal probes", () => {
	const envEvents = classifyAccessRecord(parseAccessLogLine(line("/.env")));
	assert.ok(envEvents.some((event) => event.category === "secret-probe"));

	const traversalEvents = classifyAccessRecord(parseAccessLogLine(line("/download?file=%2e%2e%2fetc%2fpasswd")));
	assert.ok(traversalEvents.some((event) => event.category === "path-traversal"));
});

test("classifies SQLi and XSS-shaped requests as heuristic security events", () => {
	const sql = classifyAccessRecord(parseAccessLogLine(line("/search?q=%27%20or%201=1")));
	assert.ok(sql.some((event) => event.category === "sql-injection"));

	const xss = classifyAccessRecord(parseAccessLogLine(line("/?q=%3Cscript%3Ealert(1)%3C/script%3E")));
	assert.ok(xss.some((event) => event.category === "xss-probe"));
});

test("normal application traffic does not create security events", () => {
	const events = classifyAccessRecord(parseAccessLogLine(line("/api/users?page=2", 200)));
	assert.deepEqual(events, []);
});

test("summarizes events, sources, hosts and blocked responses", () => {
	const records = [
		parseAccessLogLine(line("/.env", 403, "198.51.100.20")),
		parseAccessLogLine(line("/wp-login.php", 404, "198.51.100.20")),
		parseAccessLogLine(line("/", 200, "203.0.113.5")),
	].filter(Boolean);

	const summary = summarizeSecurityRecords(records);
	assert.equal(summary.requestsAnalyzed, 3);
	assert.equal(summary.eventsDetected, 2);
	assert.equal(summary.blockedResponses, 1);
	assert.equal(summary.uniqueIps, 2);
	assert.deepEqual(summary.topSources[0], { key: "198.51.100.20", count: 2 });
});

test("reports HTTP 429 as an enforced rate-limit security event", () => {
	const events = classifyAccessRecord(parseAccessLogLine(line("/api/search", 429, "203.0.113.55")));
	const event = events.find((item) => item.category === "rate-limit");
	assert.ok(event);
	assert.equal(event.label, "Rate limit enforced");
	assert.equal(event.confidence, "strong");
	assert.equal(event.status, 429);
});

test("rate-limit responses participate in blocked and category summaries", () => {
	const records = [parseAccessLogLine(line("/api/search", 429, "203.0.113.55"))].filter(Boolean);
	const summary = summarizeSecurityRecords(records);
	assert.equal(summary.blockedResponses, 1);
	assert.equal(summary.eventsDetected, 1);
	assert.deepEqual(summary.categories[0], { key: "rate-limit", count: 1 });
});

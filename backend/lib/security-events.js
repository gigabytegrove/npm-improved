const ACCESS_LOG_PATTERN =
	/^\[(?<time>[^\]]+)\]\s+(?:(?<cache>\S+)\s+(?<upstream>\S+)\s+)?(?<status>\d{3})\s+-\s+(?<method>\S+)\s+(?<scheme>\S+)\s+(?<host>\S+)\s+"(?<uri>[^"]*)"\s+\[Client\s+(?<client>[^\]]+)\](?:\s+\[Length\s+(?<length>[^\]]+)\])?(?:\s+\[Gzip\s+(?<gzip>[^\]]+)\])?(?:\s+\[Sent-to\s+(?<sentTo>[^\]]+)\])?\s+"(?<userAgent>[^"]*)"\s+"(?<referer>[^"]*)"$/;

const CATEGORY_RULES = [
	{
		category: "secret-probe",
		label: "Sensitive file probe",
		severity: "high",
		confidence: "strong",
		test: (ctx) =>
			/(?:^|\/)(?:\.env(?:\.|\/|$)|\.git(?:\/|$)|\.svn(?:\/|$)|\.hg(?:\/|$)|id_rsa(?:$|[?/])|credentials(?:$|[?\/])|\.aws(?:\/|$)|\.docker(?:\/|$)|wp-config\.php(?:$|[?\/])|config\.json(?:$|[?\/])|composer\.(?:json|lock)(?:$|[?\/]))/i.test(ctx.decodedPath),
	},
	{
		category: "path-traversal",
		label: "Path traversal probe",
		severity: "high",
		confidence: "strong",
		test: (ctx) =>
			/(?:\.\.\/|\.\.\\|%2e%2e(?:%2f|\/|%5c)|%252e%252e|%c0%ae|%c1%9c)/i.test(ctx.rawUri),
	},
	{
		category: "sql-injection",
		label: "SQL injection-shaped request",
		severity: "high",
		confidence: "heuristic",
		test: (ctx) =>
			/(?:\bunion(?:\s|%20|\+)+select\b|(?:'|%27)(?:\s|%20|\+)*(?:or|and)(?:\s|%20|\+)+(?:1=1|'[^']*'='[^']*')|\b(?:sleep|benchmark)\s*\(|(?:%3b|;)\s*(?:drop|select|insert|update|delete)\b)/i.test(
				ctx.decodedUri,
			),
	},
	{
		category: "xss-probe",
		label: "XSS-shaped request",
		severity: "high",
		confidence: "heuristic",
		test: (ctx) =>
			/(?:<\s*script\b|%3c\s*script\b|javascript\s*:|on(?:error|load|click)\s*=|%3c\s*(?:img|svg)\b)/i.test(
				ctx.decodedUri,
			),
	},
	{
		category: "exploit-probe",
		label: "Known exploit endpoint probe",
		severity: "high",
		confidence: "strong",
		test: (ctx) =>
			/(?:\/vendor\/phpunit\/|\/cgi-bin\/|\/boaform\/|\/HNAP1(?:\/|$)|\/actuator\/(?:env|heapdump|gateway|mappings)|\/jmx-console(?:\/|$)|\/console\/|\/solr\/admin|\/\.well-known\/acme-challenge\/\.\.)/i.test(
				ctx.decodedPath,
			),
	},
	{
		category: "admin-scan",
		label: "Admin/CMS scanner",
		severity: "medium",
		confidence: "heuristic",
		test: (ctx) =>
			/(?:\/wp-login\.php|\/wp-admin(?:\/|$)|\/xmlrpc\.php|\/phpmyadmin(?:\/|$)|\/pma(?:\/|$)|\/adminer(?:\.php)?(?:\/|$)|\/manager\/html|\/jenkins(?:\/|$)|\/grafana(?:\/|$))/i.test(
				ctx.decodedPath,
			),
	},
	{
		category: "shell-probe",
		label: "Web shell probe",
		severity: "high",
		confidence: "heuristic",
		test: (ctx) =>
			/(?:^|\/)(?:shell|cmd|upload|wso|alfa|mini|priv8|b374k|r57|c99)(?:\d+)?\.php(?:$|[?/])/i.test(ctx.decodedPath),
	},
	{
		category: "source-disclosure",
		label: "Source/config disclosure probe",
		severity: "medium",
		confidence: "strong",
		test: (ctx) =>
			/(?:\/server-status(?:$|[?/])|\/server-info(?:$|[?/])|\/\.DS_Store(?:$|[?/])|\/WEB-INF(?:\/|$)|\/META-INF(?:\/|$)|\/\.idea(?:\/|$)|\/\.vscode(?:\/|$))/i.test(
				ctx.decodedPath,
			),
	},
];

const safeDecode = (value) => {
	try {
		return decodeURIComponent(value.replace(/\+/g, " "));
	} catch {
		return value;
	}
};

const parseTimestamp = (value) => {
	const match = value.match(/^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s+([+-]\d{4})$/);
	if (!match) return null;

	const months = {
		Jan: 0,
		Feb: 1,
		Mar: 2,
		Apr: 3,
		May: 4,
		Jun: 5,
		Jul: 6,
		Aug: 7,
		Sep: 8,
		Oct: 9,
		Nov: 10,
		Dec: 11,
	};
	const month = months[match[2]];
	if (typeof month === "undefined") return null;

	const offsetRaw = match[7];
	const offsetSign = offsetRaw.startsWith("-") ? -1 : 1;
	const offsetMinutes =
		offsetSign *
		(Number.parseInt(offsetRaw.slice(1, 3), 10) * 60 + Number.parseInt(offsetRaw.slice(3, 5), 10));

	const utc = Date.UTC(
		Number.parseInt(match[3], 10),
		month,
		Number.parseInt(match[1], 10),
		Number.parseInt(match[4], 10),
		Number.parseInt(match[5], 10),
		Number.parseInt(match[6], 10),
	);
	return new Date(utc - offsetMinutes * 60 * 1000);
};

export const parseAccessLogLine = (line) => {
	const match = line.match(ACCESS_LOG_PATTERN);
	if (!match?.groups) return null;

	const timestamp = parseTimestamp(match.groups.time);
	return {
		timestamp: timestamp ? timestamp.toISOString() : null,
		timestampRaw: match.groups.time,
		status: Number.parseInt(match.groups.status, 10),
		method: match.groups.method,
		scheme: match.groups.scheme,
		host: match.groups.host,
		uri: match.groups.uri,
		clientIp: match.groups.client,
		userAgent: match.groups.userAgent,
		referer: match.groups.referer,
		upstreamStatus: match.groups.upstream || null,
	};
};

export const classifyAccessRecord = (record) => {
	if (!record) return [];

	const rawUri = record.uri || "";
	const decodedUri = safeDecode(rawUri);
	const decodedPath = decodedUri.split("?")[0];
	const ctx = { rawUri, decodedUri, decodedPath };

	const matched = CATEGORY_RULES.filter((rule) => rule.test(ctx)).map((rule) => ({
		category: rule.category,
		label: rule.label,
		severity: rule.severity,
		confidence: rule.confidence,
		timestamp: record.timestamp,
		status: record.status,
		method: record.method,
		host: record.host,
		uri: record.uri,
		clientIp: record.clientIp,
		userAgent: record.userAgent,
		sourceHostType: record.sourceHostType || null,
		sourceHostId: record.sourceHostId || null,
	}));

	if (record.status === 429) {
		matched.push({
			category: "rate-limit",
			label: "Rate limit enforced",
			severity: "medium",
			confidence: "strong",
			timestamp: record.timestamp,
			status: record.status,
			method: record.method,
			host: record.host,
			uri: record.uri,
			clientIp: record.clientIp,
			userAgent: record.userAgent,
			sourceHostType: record.sourceHostType || null,
			sourceHostId: record.sourceHostId || null,
		});
	}

	return matched;
};

const increment = (map, key, amount = 1) => {
	if (!key) return;
	map.set(key, (map.get(key) || 0) + amount);
};

const mapToTop = (map, limit = 10) =>
	[...map.entries()]
		.sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
		.slice(0, limit)
		.map(([key, count]) => ({ key, count }));

export const summarizeSecurityRecords = (records, { eventLimit = 100 } = {}) => {
	const events = [];
	const sourceCounts = new Map();
	const hostCounts = new Map();
	const categoryCounts = new Map();
	const statusCounts = new Map();
	let blockedResponses = 0;

	for (const record of records) {
		if ([401, 403, 429, 444].includes(record.status)) {
			blockedResponses++;
		}
		increment(statusCounts, String(record.status));

		const classified = classifyAccessRecord(record);
		for (const event of classified) {
			events.push(event);
			increment(sourceCounts, event.clientIp);
			increment(hostCounts, event.host);
			increment(categoryCounts, event.category);
		}
	}

	const severityWeight = { critical: 4, high: 3, medium: 2, low: 1 };
	events.sort((a, b) => {
		const timeDiff = Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0);
		if (timeDiff !== 0) return timeDiff;
		return (severityWeight[b.severity] || 0) - (severityWeight[a.severity] || 0);
	});

	const uniqueIps = new Set(records.map((record) => record.clientIp).filter(Boolean));

	return {
		requestsAnalyzed: records.length,
		eventsDetected: events.length,
		blockedResponses,
		uniqueIps: uniqueIps.size,
		topSources: mapToTop(sourceCounts),
		topHosts: mapToTop(hostCounts),
		categories: mapToTop(categoryCounts, 20),
		statuses: mapToTop(statusCounts, 20),
		events: events.slice(0, eventLimit),
	};
};

export default {
	parseAccessLogLine,
	classifyAccessRecord,
	summarizeSecurityRecords,
};

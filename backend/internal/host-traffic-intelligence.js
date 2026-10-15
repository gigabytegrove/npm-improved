/**
 * Short-window HTTP traffic intelligence for a single routing source.
 *
 * Reporting is local to the node and uses only already-ingested, sanitized
 * access-log events. Candidate signals are heuristics, not proof of an attack.
 * This endpoint never changes Nginx policy.
 */
import { getAnalyticsDatabase } from "./proxy-analytics.js";

export const LIVE_MINUTES = Object.freeze([5, 15, 60]);

const probeExpression = [
  "path IN ('/.env','/.git/config','/wp-login.php','/xmlrpc.php','/actuator/env')",
  "path LIKE '/.git/%'",
  "path LIKE '/vendor/phpunit/%'",
  "path LIKE '/cgi-bin/%'",
  "path LIKE '/.well-known/security.txt/../%'",
].join(" OR ");

export function classifyBrowserFamily(value) {
  if (!value || typeof value !== "string") return "Unknown";
  const ua = value.toLowerCase();
  if (/bot|crawler|spider|slurp|headless/.test(ua)) return "Claimed bot / crawler";
  if (ua.includes("edg/") || ua.includes("edgios/") || ua.includes("edga/")) return "Edge (claimed)";
  if (ua.includes("opr/") || ua.includes("opera/")) return "Opera (claimed)";
  if (ua.includes("samsungbrowser/")) return "Samsung Internet (claimed)";
  if (ua.includes("firefox/") || ua.includes("fxios/")) return "Firefox (claimed)";
  if (ua.includes("chrome/") || ua.includes("crios/")) return "Chrome (claimed)";
  if (ua.includes("safari/")) return "Safari (claimed)";
  if (ua.includes("trident/") || ua.includes("msie ")) return "Internet Explorer (claimed)";
  if (/curl\/|wget\/|python-requests|go-http-client|scrapy|httpclient/.test(ua)) return "Script / API client (claimed)";
  return "Other / unknown";
}

export function evaluateClientSignals(row, minutes) {
  const requests = Number(row.requests || 0);
  const probeRequests = Number(row.probe_requests || 0);
  const notFound = Number(row.not_found || 0);
  const blocked = Number(row.blocked || 0);
  const signals = [];
  if (probeRequests) signals.push("Sensitive-path probing (" + probeRequests + ")");
  if (notFound >= 10 && requests > 0 && notFound / requests >= 0.5)
    signals.push("High 404 proportion (" + notFound + "/" + requests + ")");
  if (requests >= 60 && requests / minutes >= 12)
    signals.push("Elevated request rate (" + (requests / minutes).toFixed(1) + "/min)");
  if (blocked) signals.push("Previously denied (" + blocked + ")");
  return {
    ...row,
    requests, probe_requests: probeRequests, not_found: notFound,
    client_errors: Number(row.client_errors || 0),
    server_errors: Number(row.server_errors || 0), blocked,
    bytes_out: Number(row.bytes_out || 0),
    signals,
    priority: probeRequests >= 5 || (notFound >= 25 && notFound / Math.max(1, requests) >= 0.7)
      ? "high" : signals.length ? "review" : "none",
  };
}

function readCandidates(db, field, hostId, since, minutes) {
  // field is a constant from the internal allowlist, never request input.
  if (!["client_ip", "user_agent"].includes(field)) throw new RangeError("Unsupported client dimension");
  const rows = db.prepare(
    "SELECT " + field + " AS value, COUNT(*) AS requests, " +
    "SUM(CASE WHEN (" + probeExpression + ") THEN 1 ELSE 0 END) AS probe_requests, " +
    "SUM(CASE WHEN status = 404 THEN 1 ELSE 0 END) AS not_found, " +
    "SUM(CASE WHEN status >= 400 AND status < 500 THEN 1 ELSE 0 END) AS client_errors, " +
    "SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS server_errors, " +
    "SUM(CASE WHEN block_reason IS NOT NULL THEN 1 ELSE 0 END) AS blocked, " +
    "SUM(bytes_out) AS bytes_out, MIN(occurred_at) AS first_seen, MAX(occurred_at) AS last_seen " +
    "FROM analytics_event WHERE host_id=? AND occurred_at>=? AND " +
    field + " IS NOT NULL AND " + field + " <> '' " +
    "GROUP BY " + field + " " +
    "ORDER BY probe_requests DESC, not_found DESC, requests DESC LIMIT 100"
  ).all(hostId, since);
  return rows.map((row) => evaluateClientSignals(row, minutes))
    .filter((row) => row.signals.length)
    .sort((a, b) => {
      const weight = (row) => row.probe_requests * 20 + row.blocked * 10 +
        row.not_found + row.requests / Math.max(1, minutes);
      return weight(b) - weight(a);
    })
    .slice(0, 20);
}

export function getHostTrafficIntelligence(hostId, minutes = 15) {
  if (!Number.isSafeInteger(hostId) || hostId === 0 ||
    (hostId < 0 && (hostId > -1000001 || hostId < -3000001)) ||
    (hostId > 0 && hostId >= 1000000)) throw new RangeError("Invalid analytics source ID");
  if (!LIVE_MINUTES.includes(minutes)) throw new RangeError("Choose 5, 15 or 60 minutes");
  const db = getAnalyticsDatabase();
  const now = Math.floor(Date.now() / 1000);
  const startMinute = Math.floor(now / 60) * 60 - (minutes - 1) * 60;
  const args = [hostId, startMinute];
  const totals = db.prepare(
    "SELECT COUNT(*) AS requests, COALESCE(SUM(bytes_out), 0) AS bytes_out, " +
    "SUM(CASE WHEN status>=400 AND status<500 THEN 1 ELSE 0 END) AS client_errors, " +
    "SUM(CASE WHEN status>=500 THEN 1 ELSE 0 END) AS server_errors, " +
    "SUM(CASE WHEN block_reason IS NOT NULL THEN 1 ELSE 0 END) AS blocked, " +
    "COUNT(DISTINCT client_ip) AS unique_ips, MAX(occurred_at_ms) AS latest_ms, " +
    "MAX(occurred_at) AS latest " +
    "FROM analytics_event WHERE host_id=? AND occurred_at>=?"
  ).get(...args);
  const timelineRows = db.prepare(
    "SELECT CAST(occurred_at/60 AS INTEGER)*60 AS bucket, COUNT(*) AS requests, " +
    "SUM(bytes_out) AS bytes_out, SUM(CASE WHEN status>=400 THEN 1 ELSE 0 END) AS errors " +
    "FROM analytics_event WHERE host_id=? AND occurred_at>=? GROUP BY bucket ORDER BY bucket"
  ).all(...args);
  const known = new Map(timelineRows.map((r) => [r.bucket, r]));
  const timeline = Array.from({ length: minutes }, (_, i) => {
    const bucket = startMinute + i * 60;
    const row = known.get(bucket);
    return { at: new Date(bucket * 1000).toISOString(), requests: Number(row?.requests || 0),
      bytes_out: Number(row?.bytes_out || 0), errors: Number(row?.errors || 0) };
  });
  const paths = db.prepare(
    "SELECT path AS label, COUNT(*) AS requests, " +
    "SUM(CASE WHEN status>=400 THEN 1 ELSE 0 END) AS errors, " +
    "SUM(CASE WHEN (" + probeExpression + ") THEN 1 ELSE 0 END) AS probes " +
    "FROM analytics_event WHERE host_id=? AND occurred_at>=? " +
    "GROUP BY path ORDER BY requests DESC LIMIT 30"
  ).all(...args).map((row) => ({
    label: row.label, requests: Number(row.requests),
    errors: Number(row.errors), probes: Number(row.probes),
  }));
  // Classify every retained event in SQLite rather than grouping only the
  // 1,000 most common full UA strings (which would undercount noisy clients).
  const browserCase = [
    "CASE WHEN user_agent IS NULL OR trim(user_agent) = '' THEN 'Unknown'",
    "WHEN lower(user_agent) LIKE '%bot%' OR lower(user_agent) LIKE '%crawler%' OR lower(user_agent) LIKE '%spider%' OR lower(user_agent) LIKE '%slurp%' OR lower(user_agent) LIKE '%headless%' THEN 'Claimed bot / crawler'",
    "WHEN lower(user_agent) LIKE '%edg/%' OR lower(user_agent) LIKE '%edgios/%' OR lower(user_agent) LIKE '%edga/%' THEN 'Edge (claimed)'",
    "WHEN lower(user_agent) LIKE '%opr/%' OR lower(user_agent) LIKE '%opera/%' THEN 'Opera (claimed)'",
    "WHEN lower(user_agent) LIKE '%samsungbrowser/%' THEN 'Samsung Internet (claimed)'",
    "WHEN lower(user_agent) LIKE '%firefox/%' OR lower(user_agent) LIKE '%fxios/%' THEN 'Firefox (claimed)'",
    "WHEN lower(user_agent) LIKE '%chrome/%' OR lower(user_agent) LIKE '%crios/%' THEN 'Chrome (claimed)'",
    "WHEN lower(user_agent) LIKE '%safari/%' THEN 'Safari (claimed)'",
    "WHEN lower(user_agent) LIKE '%trident/%' OR lower(user_agent) LIKE '%msie %' THEN 'Internet Explorer (claimed)'",
    "WHEN lower(user_agent) LIKE '%curl/%' OR lower(user_agent) LIKE '%wget/%' OR lower(user_agent) LIKE '%python-requests%' OR lower(user_agent) LIKE '%go-http-client%' OR lower(user_agent) LIKE '%scrapy%' OR lower(user_agent) LIKE '%httpclient%' THEN 'Script / API client (claimed)'",
    "ELSE 'Other / unknown' END",
  ].join(" ");
  const browsers = db.prepare(
    "SELECT " + browserCase + " AS label, COUNT(*) AS requests " +
    "FROM analytics_event WHERE host_id=? AND occurred_at>=? " +
    "GROUP BY label ORDER BY requests DESC"
  ).all(...args).map((row) => ({ label: row.label, requests: Number(row.requests) }));
  const recent = db.prepare(
    "SELECT id,occurred_at,occurred_at_ms,method,path,status,client_ip,user_agent,bot_class," +
    "block_reason,bytes_out,request_id,connection_id FROM analytics_event " +
    "WHERE host_id=? AND occurred_at>=? ORDER BY occurred_at DESC,id DESC LIMIT 30"
  ).all(...args).map((row) => ({
    ...row, at: new Date(row.occurred_at_ms || row.occurred_at * 1000).toISOString(),
  }));
  const checkpoint = db.prepare("SELECT MAX(modified_at) AS modified FROM analytics_cursor").get();
  return {
    scope: "local-node", host_id: hostId, minutes, sampled_at: new Date().toISOString(),
    latest_request_at: totals.latest === null ? null :
      new Date(totals.latest_ms || totals.latest * 1000).toISOString(),
    last_ingested_at: checkpoint.modified === null ? null : new Date(checkpoint.modified).toISOString(),
    collector_interval_seconds: 10, accuracy: "ingested-completed-requests",
    requests: Number(totals.requests), bytes_out: Number(totals.bytes_out),
    client_errors: Number(totals.client_errors || 0),
    server_errors: Number(totals.server_errors || 0),
    blocked: Number(totals.blocked || 0), unique_ips: Number(totals.unique_ips || 0),
    timeline, paths, browsers, suspicious_ips: readCandidates(db, "client_ip", hostId, startMinute, minutes),
    suspicious_agents: readCandidates(db, "user_agent", hostId, startMinute, minutes),
    recent,
    geography: { available: false, reason: "Geographic enrichment is not yet implemented. Country, region, city and ASN cannot be inferred reliably from the recorded request fields." },
    limitations: {
      attribution: "Source IP addresses may represent shared networks, VPNs, or gateways. Browser and crawler names are unverified user-agent claims.",
      detection: "The signals below are investigative indicators, not proof of malicious intent. No action is automated.",
      enforcement: "Existing IP and user-agent deny rules apply to this node's HTTP traffic, not solely this host.",
    },
  };
}

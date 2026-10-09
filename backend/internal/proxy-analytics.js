import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import Database from "better-sqlite3";
import { parseAnalyticsEvent } from "../lib/proxy-analytics.js";
import { global as logger } from "../logger.js";

// Metrics are node-local. NPMX must not replicate raw events or this database.
const ANALYTICS_DIR = process.env.NPM_ANALYTICS_LOG_DIR || "/data/logs";
const DATABASE_PATH = process.env.NPM_ANALYTICS_DB || "/data/analytics.sqlite";
const MAX_CHUNK = 512 * 1024;
const RAW_DAYS = Math.min(30, Math.max(1, Number.parseInt(process.env.NPM_ANALYTICS_RAW_DAYS || "7", 10) || 7));
const ROLLUP_DAYS = Math.min(365, Math.max(30, Number.parseInt(process.env.NPM_ANALYTICS_ROLLUP_DAYS || "90", 10) || 90));
const LOG_PATTERN = /^(?:(proxy-host|redirection-host|dead-host)-(\d+)|default-host|fallback-http)_analytics\.log(?:\.1)?$/;
const NODE_ROUTE_OFFSETS = { "redirection-host": 1000000, "dead-host": 2000000 };
export function analyticsSourceId(filename) {
  const match = LOG_PATTERN.exec(filename);
  if (!match) return null;
  if (filename.startsWith("default-host_")) return -3000000;
  if (filename.startsWith("fallback-http_")) return -3000001;
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id) || id < 1 || id >= 1000000) return null;
  return match[1] === "proxy-host" ? id : -(NODE_ROUTE_OFFSETS[match[1]] + id);
}
let database = null;
let timer = null;
let busy = false;
let cleanupAt = 0;

const numberOrNull = (value) => {
  if (value === undefined || value === null || value === "" || value === "-") return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (!/^(?:\d+)(?:\.\d+)?$/.test(String(value))) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export function sanitizeAnalyticsPath(value) {
  if (typeof value !== "string") return "/";
  const withoutQuery = value.split(/[?#]/, 1)[0];
  return (withoutQuery.startsWith("/") ? withoutQuery : "/")
    .slice(0, 512)
    .split("/")
    .map((segment) => {
      if (/^[0-9a-f]{16,}$/i.test(segment) || /^[\w-]{28,}$/.test(segment) ||
        /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) ||
        /@/.test(segment) || /^(?:token|key|secret|password|session|auth)$/i.test(segment)) {
        return "[redacted]";
      }
      return segment.replace(/[^a-zA-Z0-9._~%-]/g, "_");
    })
    .join("/") || "/";
}

export function classifyAnalyticsDevice(value) {
  if (typeof value !== "string") return "unknown";
  if (/bot|crawler|spider|slurp/i.test(value)) return "crawler";
  if (/tablet|ipad/i.test(value)) return "tablet";
  if (/mobile|android|iphone/i.test(value)) return "mobile";
  if (/mozilla|chrome|safari|edge|firefox/i.test(value)) return "desktop";
  return "other";
}

function getDb() {
  if (database) return database;
  fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
  const db = new Database(DATABASE_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_cursor (
      inode_key TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      position INTEGER NOT NULL,
      modified_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS analytics_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL,
      occurred_at INTEGER NOT NULL,
      domain TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      protocol TEXT NOT NULL,
      status INTEGER NOT NULL,
      bytes_out INTEGER NOT NULL,
      bytes_in INTEGER,
      duration_ms REAL,
      upstream_ms REAL,
      upstream_status TEXT NOT NULL,
      device TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS analytics_event_host_time ON analytics_event(host_id, occurred_at);
    CREATE INDEX IF NOT EXISTS analytics_event_host_status_time ON analytics_event(host_id, status, occurred_at);
    CREATE TABLE IF NOT EXISTS analytics_hour (
      host_id INTEGER NOT NULL,
      bucket INTEGER NOT NULL,
      status_band TEXT NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0,
      bytes_out INTEGER NOT NULL DEFAULT 0,
      bytes_in INTEGER NOT NULL DEFAULT 0,
      total_duration_ms REAL NOT NULL DEFAULT 0,
      duration_samples INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (host_id, bucket, status_band)
    );
    CREATE INDEX IF NOT EXISTS analytics_hour_time ON analytics_hour(bucket);
  `);
  database = db;
  return database;
}

// Consumers share the collector's connection to the node-local database.
export const getAnalyticsDatabase = () => getDb();
export const getAnalyticsRetention = () => ({ rawDays: RAW_DAYS, rollupDays: ROLLUP_DAYS });

function processFile(fileName, hostId, deadline) {
  const filename = path.join(ANALYTICS_DIR, fileName);
  const stat = fs.statSync(filename);
  if (!stat.isFile()) return 0;
  const inodeKey = `${stat.dev}:${stat.ino}`;
  const db = getDb();
  const prior = db.prepare("SELECT position FROM analytics_cursor WHERE inode_key=?").get(inodeKey);
  let start = prior?.position || 0;
  if (stat.size < start) start = 0; // copytruncate
  if (start >= stat.size || Date.now() > deadline) return 0;
  const length = Math.min(MAX_CHUNK, stat.size - start);
  const buffer = Buffer.allocUnsafe(length);
  const fd = fs.openSync(filename, "r");
  let bytesRead;
  try {
    bytesRead = fs.readSync(fd, buffer, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }
  if (!bytesRead) return 0;
  const tail = buffer.subarray(0, bytesRead);
  const lastNewline = tail.lastIndexOf(10);
  if (lastNewline < 0) {
    // Do not let a malformed/oversized record prevent all later ingestion.
    if (bytesRead === MAX_CHUNK) {
      db.prepare(`INSERT INTO analytics_cursor(inode_key,file_name,position,modified_at)
        VALUES(?,?,?,?) ON CONFLICT(inode_key) DO UPDATE SET
        file_name=excluded.file_name, position=excluded.position, modified_at=excluded.modified_at`)
        .run(inodeKey, fileName, start + bytesRead, Date.now());
    }
    return 0;
  }
  const chunk = tail.subarray(0, lastNewline + 1).toString("utf8");
  const lines = chunk.split("\n");
  const insert = db.prepare(`INSERT INTO analytics_event
    (host_id,occurred_at,domain,method,path,protocol,status,bytes_out,bytes_in,
     duration_ms,upstream_ms,upstream_status,device)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const hour = db.prepare(`INSERT INTO analytics_hour
    (host_id,bucket,status_band,requests,bytes_out,bytes_in,total_duration_ms,duration_samples)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(host_id,bucket,status_band) DO UPDATE SET
      requests=requests+excluded.requests,
      bytes_out=bytes_out+excluded.bytes_out,
      bytes_in=bytes_in+excluded.bytes_in,
      total_duration_ms=total_duration_ms+excluded.total_duration_ms,
      duration_samples=duration_samples+excluded.duration_samples`);
  const checkpoint = db.prepare(`INSERT INTO analytics_cursor(inode_key,file_name,position,modified_at)
    VALUES (?,?,?,?) ON CONFLICT(inode_key) DO UPDATE SET
    file_name=excluded.file_name,position=excluded.position,modified_at=excluded.modified_at`);
  const cutoff = Date.now() - RAW_DAYS * 86400000;
  let accepted = 0;
  const ingest = db.transaction(() => {
    for (const line of lines) {
      if (!line || line.length > 65536) continue;
      const base = parseAnalyticsEvent(line, hostId);
      if (!base || base.time < cutoff || base.time > Date.now() + 60000) continue;
      let raw;
      try { raw = JSON.parse(line); } catch { continue; }
      const domain = typeof raw.domain === "string" ? raw.domain.slice(0, 253).toLowerCase() : "";
      const method = typeof raw.method === "string" && /^[A-Z]{1,16}$/.test(raw.method) ? raw.method : "OTHER";
      const protocol = typeof raw.protocol === "string" ? raw.protocol.slice(0, 12) : "";
      const upstream = typeof raw.upstream_status === "string" ? raw.upstream_status.slice(0, 50) : "";
      const duration = base.duration === null ? null : base.duration * 1000;
      const upstreamSeconds = numberOrNull(raw.upstream_time);
      const bucket = Math.floor(base.time / 3600000) * 3600;
      const band = Math.floor(base.status / 100) + "xx";
      const bytesIn = numberOrNull(raw.request_length);
      insert.run(hostId, Math.floor(base.time / 1000), domain, method,
        sanitizeAnalyticsPath(raw.path), protocol, base.status, base.bytes,
        bytesIn === null ? null : Math.floor(bytesIn), duration,
        upstreamSeconds === null ? null : upstreamSeconds * 1000,
        upstream, classifyAnalyticsDevice(raw.user_agent));
      hour.run(hostId, bucket, band, 1, base.bytes, bytesIn === null ? 0 : Math.floor(bytesIn),
        duration || 0, duration === null ? 0 : 1);
      accepted++;
    }
    checkpoint.run(inodeKey, fileName, start + lastNewline + 1, Date.now());
  });
  ingest();
  return accepted;
}

export function ingestAnalyticsLogs() {
  if (busy || process.env.NPM_ANALYTICS_ENABLED === "false") return 0;
  busy = true;
  try {
    if (!fs.existsSync(ANALYTICS_DIR)) return 0;
    let processed = 0;
    const deadline = Date.now() + 1500;
    // Process rotated uncompressed logs before active logs; deduplicate by inode.
    const names = fs.readdirSync(ANALYTICS_DIR).filter((name) => LOG_PATTERN.test(name))
      .sort((a, b) => Number(b.endsWith(".1")) - Number(a.endsWith(".1")));
    for (const name of names) {
      if (Date.now() > deadline) break;
      const hostId = analyticsSourceId(name);
      if (hostId === null) continue;
      try { processed += processFile(name, hostId, deadline); }
      catch (error) { logger.warn(`Analytics ingestion skipped ${name}: ${error.message}`); }
    }
    if (Date.now() - cleanupAt > 3600000) {
      const db = getDb();
      db.prepare("DELETE FROM analytics_event WHERE occurred_at < ?")
        .run(Math.floor(Date.now() / 1000) - RAW_DAYS * 86400);
      db.prepare("DELETE FROM analytics_hour WHERE bucket < ?")
        .run(Math.floor(Date.now() / 1000) - ROLLUP_DAYS * 86400);
      cleanupAt = Date.now();
    }
    return processed;
  } finally {
    busy = false;
  }
}


export function injectAnalyticsLog(existing, hostId) {
  if (typeof existing !== "string" || !Number.isSafeInteger(hostId) || hostId < 1) return existing;
  const currentLog = `access_log /data/logs/proxy-host-${hostId}_access.log proxy;`;
  const nextLog = `access_log /data/logs/proxy-host-${hostId}_analytics.log proxy_analytics;`;
  if (existing.includes(nextLog)) return existing;
  return existing.split("\n").map((line) => {
    if (line.trim() !== currentLog) return line;
    const indentation = line.slice(0, line.indexOf("access_log"));
    return `${line}\n${indentation}${nextLog}`;
  }).join("\n");
}

export function injectNonProxyAnalyticsLog(existing, source, id = null) {
  if (typeof existing !== "string") return existing;
  const stem = id === null ? source : `${source}-${id}`;
  const oldFormat = source === "default-host" ? "combined" : source === "stream" ? "stream" : "standard";
  const oldLine = `access_log /data/logs/${stem}_access.log ${oldFormat};`;
  const newLine = `access_log /data/logs/${stem}_analytics.log ${source === "stream" ? "stream_analytics" : "proxy_analytics"};`;
  if (existing.includes(newLine)) return existing;
  return existing.split("\n").map((line) => {
    if (line.trim() !== oldLine) return line;
    const indent = line.slice(0, line.indexOf("access_log"));
    return `${line}\n${indent}${newLine}`;
  }).join("\n");
}

export function upgradeExistingAnalyticsHostConfigs() {
  // Persistent generated routes are kept across image updates, so refresh
  // analytics access logs for every existing enabled HTTP routing category.
  const sources = [
    { folder: "proxy_host", kind: "proxy-host" },
    { folder: "redirection_host", kind: "redirection-host" },
    { folder: "dead_host", kind: "dead-host" },
    { folder: "default_host", kind: "default-host" },
    { folder: "stream", kind: "stream" },
  ];
  const changes = [];
  for (const source of sources) {
    const directory = path.join("/data/nginx", source.folder);
    if (!fs.existsSync(directory)) continue;
    for (const filename of fs.readdirSync(directory)) {
      if (!filename.endsWith(".conf")) continue;
      const numeric = /^[1-9]\d*\.conf$/.exec(filename);
      if (source.kind !== "default-host" && !numeric) continue;
      const id = numeric ? Number(filename.slice(0, -5)) : null;
      const fullPath = path.join(directory, filename);
      const current = fs.readFileSync(fullPath, "utf8");
      const updated = source.kind === "proxy-host"
        ? injectAnalyticsLog(current, id)
        : injectNonProxyAnalyticsLog(current, source.kind, id);
      if (updated !== current) changes.push({ fullPath, current, updated, mode: fs.statSync(fullPath).mode });
    }
  }
  if (!changes.length) return 0;
  const applied = [];
  try {
    for (const change of changes) {
      const temporary = `${change.fullPath}.analytics-${process.pid}.tmp`;
      fs.writeFileSync(temporary, change.updated, { mode: change.mode });
      fs.renameSync(temporary, change.fullPath);
      applied.push(change);
    }
    execFileSync("/usr/sbin/nginx", ["-t"], { stdio: "pipe" });
    execFileSync("/usr/sbin/nginx", ["-s", "reload"], { stdio: "pipe" });
    logger.info(`Activated host analytics logging on ${applied.length} existing hosts`);
    return applied.length;
  } catch (error) {
    for (const change of applied.reverse()) {
      const temporary = `${change.fullPath}.analytics-rollback-${process.pid}.tmp`;
      try {
        fs.writeFileSync(temporary, change.current, { mode: change.mode });
        fs.renameSync(temporary, change.fullPath);
      } catch (rollbackError) {
        logger.error(`Analytics configuration rollback failed for ${change.fullPath}: ${rollbackError.message}`);
      }
    }
    throw new Error(`Existing host analytics activation failed; originals restored: ${error.message}`);
  }
}

export function startAnalyticsCollector() {
  if (timer || process.env.NPM_ANALYTICS_ENABLED === "false") return;
  try { getDb(); upgradeExistingAnalyticsHostConfigs(); ingestAnalyticsLogs(); }
  catch (error) { logger.warn(`Analytics storage unavailable: ${error.message}`); }
  timer = setInterval(() => {
    try { ingestAnalyticsLogs(); }
    catch (error) { logger.warn(`Analytics collection error: ${error.message}`); }
  }, 10000);
  timer.unref();
  logger.info("Proxy Host Analytics collector initialized");
}

const aggregateRows = (rows) => {
  const response = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 };
  let requests = 0;
  let bytesOut = 0;
  let bytesIn = 0;
  for (const row of rows) {
    const bucket = Object.hasOwn(response, row.band) ? row.band : "other";
    const count = Number(row.requests || 0);
    response[bucket] += count;
    requests += count;
    bytesOut += Number(row.bytes_out || 0);
    bytesIn += Number(row.bytes_in || 0);
  }
  return { requests, bytes_out: bytesOut, bytes_in: bytesIn, status: response };
};

function breakdown(db, hostId, since, column) {
  // column is a constant from our own whitelist, not user input.
  if (!["domain", "method", "path", "device", "upstream_status"].includes(column))
    throw new Error("Invalid breakdown");
  return db.prepare(`SELECT ${column} AS label, COUNT(*) AS requests,
    SUM(bytes_out) AS bytes_out FROM analytics_event
    WHERE host_id=? AND occurred_at>=? GROUP BY ${column}
    ORDER BY requests DESC LIMIT 12`).all(hostId, since);
}

function exactPercentile(db, hostId, since, count, percentile) {
  if (!count) return null;
  const index = Math.max(0, Math.ceil(count * percentile) - 1);
  return db.prepare(`SELECT duration_ms FROM analytics_event WHERE host_id=?
    AND occurred_at>=? AND duration_ms IS NOT NULL
    ORDER BY duration_ms LIMIT 1 OFFSET ?`).get(hostId, since, index)?.duration_ms ?? null;
}

export function getHostAnalytics(hostId, hours = 24) {
  if (!Number.isSafeInteger(hostId) || hostId < 1 || ![1, 24, 168, 720, 2160].includes(hours))
    throw new RangeError("Invalid host or time window");
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const since = now - hours * 3600;
  const useRollup = hours > RAW_DAYS * 24;
  let breakdownRows;
  let timelineRows;
  if (useRollup) {
    breakdownRows = db.prepare(`SELECT status_band AS band, SUM(requests) AS requests,
      SUM(bytes_out) AS bytes_out, SUM(bytes_in) AS bytes_in
      FROM analytics_hour WHERE host_id=? AND bucket>=?
      GROUP BY status_band`).all(hostId, since);
    const stride = hours > 168 ? 86400 : 3600;
    timelineRows = db.prepare(`SELECT CAST(bucket / ? AS INTEGER) * ? AS bucket,
      SUM(requests) AS requests, SUM(bytes_out) AS bytes_out
      FROM analytics_hour WHERE host_id=? AND bucket>=?
      GROUP BY CAST(bucket / ? AS INTEGER) ORDER BY bucket`).all(stride, stride, hostId, since, stride);
  } else {
    breakdownRows = db.prepare(`SELECT CAST(status / 100 AS TEXT) || 'xx' AS band,
      COUNT(*) AS requests, SUM(bytes_out) AS bytes_out, SUM(COALESCE(bytes_in,0)) AS bytes_in
      FROM analytics_event WHERE host_id=? AND occurred_at>=?
      GROUP BY CAST(status / 100 AS INTEGER)`).all(hostId, since);
    const stride = hours === 1 ? 60 : hours === 24 ? 3600 : 86400;
    timelineRows = db.prepare(`SELECT CAST(occurred_at / ? AS INTEGER) * ? AS bucket,
      COUNT(*) AS requests,SUM(bytes_out) AS bytes_out
      FROM analytics_event WHERE host_id=? AND occurred_at>=?
      GROUP BY CAST(occurred_at / ? AS INTEGER) ORDER BY bucket`).all(stride, stride, hostId, since, stride);
  }
  const totals = aggregateRows(breakdownRows);
  const samples = useRollup ? 0 : db.prepare(`SELECT COUNT(*) AS n FROM analytics_event
    WHERE host_id=? AND occurred_at>=? AND duration_ms IS NOT NULL`).get(hostId, since).n;
  const latency = {
    samples,
    p50: useRollup ? null : exactPercentile(db, hostId, since, samples, 0.5),
    p95: useRollup ? null : exactPercentile(db, hostId, since, samples, 0.95),
    p99: useRollup ? null : exactPercentile(db, hostId, since, samples, 0.99),
  };
  const grouped = useRollup ? { domains: [], methods: [], paths: [], devices: [], upstreams: [] } : {
    domains: breakdown(db, hostId, since, "domain"),
    methods: breakdown(db, hostId, since, "method"),
    paths: breakdown(db, hostId, since, "path"),
    devices: breakdown(db, hostId, since, "device"),
    upstreams: breakdown(db, hostId, since, "upstream_status"),
  };
  return {
    host_id: hostId,
    hours,
    granularity: hours === 1 ? "minute" : hours <= 24 ? "hour" : "day",
    accuracy: useRollup ? "hourly-rollup" : "raw-events",
    retained_raw_days: RAW_DAYS,
    retained_rollup_days: ROLLUP_DAYS,
    ...totals,
    latency_ms: latency,
    timeline: timelineRows.map((row) => ({
      at: new Date(Number(row.bucket) * 1000).toISOString(),
      requests: Number(row.requests),
      bytes_out: Number(row.bytes_out || 0),
    })),
    ...grouped,
    limitations: {
      unique_visitors: "Not collected; proxy logs do not establish unique people.",
      countries: "GeoIP enrichment is not enabled.",
      percentiles: useRollup ? "Raw events have expired; historical latency percentiles unavailable." : null,
      history: "Analytics begin with deployment of the structured analytics log format.",
      scope: "This NPM Improved node only; NPMX never replicates traffic observations.",
    },
  };
}

export function getHostRequests(hostId, hours = 24, limit = 50, offset = 0, status = null) {
  if (!Number.isSafeInteger(hostId) || hostId < 1 || ![1, 24, 168].includes(hours) ||
      !Number.isInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isInteger(offset) || offset < 0 || offset > 10000 ||
      (status !== null && ![200, 301, 302, 400, 401, 403, 404, 429, 500, 502, 503, 504].includes(status)))
    throw new RangeError("Invalid analytics request filter");
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const db = getDb();
  const filter = status === null ? "" : " AND status=?";
  const args = status === null ? [hostId, since] : [hostId, since, status];
  const total = db.prepare(`SELECT COUNT(*) AS n FROM analytics_event
    WHERE host_id=? AND occurred_at>=?${filter}`).get(...args).n;
  const entries = db.prepare(`SELECT id, occurred_at,domain,method,path,protocol,status,
    bytes_out,bytes_in,duration_ms,upstream_ms,upstream_status,device
    FROM analytics_event WHERE host_id=? AND occurred_at>=?${filter}
    ORDER BY occurred_at DESC,id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  return { total, limit, offset, entries: entries.map((entry) => ({
    ...entry, at: new Date(entry.occurred_at * 1000).toISOString(),
  })) };
}

/**
 * Bounded, sanitized, host-specific event export. No client IPs, cookies,
 * authorization headers, query strings or full user agents are exported.
 */
export function exportHostAnalyticsCsv(hostId, hours = 24) {
  if (!Number.isSafeInteger(hostId) || hostId < 1 || ![1, 24, 168].includes(hours))
    throw new RangeError("Invalid analytics export window");
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const rows = getDb().prepare(`SELECT occurred_at,domain,method,path,protocol,status,
    bytes_out,bytes_in,duration_ms,upstream_ms,upstream_status,device
    FROM analytics_event WHERE host_id=? AND occurred_at>=?
    ORDER BY occurred_at DESC,id DESC LIMIT 10001`).all(hostId, since);
  const headings = ["timestamp_utc","domain","method","path","protocol","status","bytes_out",
    "bytes_in","duration_ms","upstream_ms","upstream_status","device"];
  const safe = (value) => {
    let str = String(value ?? "");
    // Prevent spreadsheet CSV formula execution.
    if (/^[=+@\t\r-]/.test(str)) str = "'" + str;
    return '"' + str.replaceAll('"', '""') + '"';
  };
  const body = rows.slice(0, 10000).map((row) => [
    new Date(row.occurred_at * 1000).toISOString(), row.domain, row.method,
    row.path, row.protocol, row.status, row.bytes_out, row.bytes_in,
    row.duration_ms, row.upstream_ms, row.upstream_status, row.device,
  ].map(safe).join(","));
  return { csv: [headings.join(","), ...body].join("\n") + "\n",
    truncated: rows.length > 10000 };
}

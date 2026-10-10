/**
 * Node Analytics Center. All queries use the node-local analytics.sqlite.
 * NPMX exchanges configuration, not analytics, preventing phantom traffic
 * from being counted across proxy nodes with identical host definitions.
 *
 * Route access is limited to settings:get (administrator) because this API
 * deliberately aggregates ALL hosts, including hosts owned by other users.
 */
import { getAnalyticsDatabase, getAnalyticsRetention } from "./proxy-analytics.js";

export const NODE_WINDOWS = [1, 24, 168, 720, 2160];
export const NODE_STATUS_CLASSES = ["2xx", "3xx", "4xx", "5xx"];

export function parseNodeFilters(query = {}) {
  const hours = query.hours === undefined ? 24 : Number(query.hours);
  const hostValue = query.hostId ?? query.host_id;
  const hostId = hostValue === undefined || hostValue === ""
    ? null : Number(hostValue);
  const statusValue = query.statusClass ?? query.status_class;
  const statusClass = statusValue === undefined || statusValue === ""
    ? null : String(statusValue);
  if (!NODE_WINDOWS.includes(hours)) throw new RangeError("Invalid reporting window");
  if (hostId !== null && (!Number.isSafeInteger(hostId) || (hostId < 1 && hostId > -1000000)))
    throw new RangeError("Invalid proxy host identifier");
  if (statusClass !== null && !NODE_STATUS_CLASSES.includes(statusClass))
    throw new RangeError("Invalid HTTP response class");
  return { hours, hostId, statusClass };
}

export function getNodeAnalytics(filters) {
  const { hours, hostId, statusClass } = parseNodeFilters(filters);
  const db = getAnalyticsDatabase();
  const retention = getAnalyticsRetention();
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const rollup = hours > retention.rawDays * 24;
  const conditions = rollup ? ["bucket >= ?"] : ["occurred_at >= ?"];
  const args = [since];
  if (hostId !== null) {
    conditions.push("host_id = ?");
    args.push(hostId);
  }
  if (statusClass !== null) {
    if (rollup) {
      conditions.push("status_band = ?");
      args.push(statusClass);
    } else {
      conditions.push("status >= ? AND status < ?");
      const min = Number(statusClass.charAt(0)) * 100;
      args.push(min, min + 100);
    }
  }
  const where = conditions.join(" AND ");
  const totalsSql = rollup
    ? `SELECT status_band AS band, SUM(requests) AS requests,
       SUM(bytes_out) AS bytes_out, SUM(bytes_in) AS bytes_in
       FROM analytics_hour WHERE ${where} GROUP BY status_band`
    : `SELECT CAST(status / 100 AS INTEGER) || 'xx' AS band, COUNT(*) AS requests,
       SUM(bytes_out) AS bytes_out, SUM(COALESCE(bytes_in,0)) AS bytes_in
       FROM analytics_event WHERE ${where} GROUP BY CAST(status / 100 AS INTEGER)`;
  const rows = db.prepare(totalsSql).all(...args);
  const status = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 };
  let requests = 0;
  let bytesOut = 0;
  let bytesIn = 0;
  for (const row of rows) {
    const count = Number(row.requests || 0);
    requests += count;
    bytesOut += Number(row.bytes_out || 0);
    bytesIn += Number(row.bytes_in || 0);
    if (Object.hasOwn(status, row.band)) status[row.band] += count;
    else status.other += count;
  }
  const stride = hours === 1 && !rollup ? 60 : hours <= 24 ? 3600 : 86400;
  const bucketField = rollup ? "bucket" : "occurred_at";
  const timelineSql = rollup
    ? `SELECT CAST(${bucketField} / ? AS INTEGER) * ? AS bucket,
       SUM(requests) AS requests, SUM(bytes_out) AS bytes_out,
       SUM(CASE WHEN status_band = '5xx' THEN requests ELSE 0 END) AS errors
       FROM analytics_hour WHERE ${where}
       GROUP BY CAST(${bucketField} / ? AS INTEGER) ORDER BY bucket`
    : `SELECT CAST(${bucketField} / ? AS INTEGER) * ? AS bucket,
       COUNT(*) AS requests, SUM(bytes_out) AS bytes_out,
       SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS errors
       FROM analytics_event WHERE ${where}
       GROUP BY CAST(${bucketField} / ? AS INTEGER) ORDER BY bucket`;
  const timeline = db.prepare(timelineSql).all(stride, stride, ...args, stride).map((row) => ({
    at: new Date(row.bucket * 1000).toISOString(),
    requests: Number(row.requests || 0),
    bytes_out: Number(row.bytes_out || 0),
    errors: Number(row.errors || 0),
  }));
  const ips = rollup ? [] : db.prepare(`SELECT client_ip AS ip, COUNT(*) AS requests,
    SUM(bytes_out) AS bytes_out, MIN(occurred_at) AS first_seen,
    MAX(occurred_at) AS last_seen, SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors
    FROM analytics_event WHERE ${where} AND client_ip IS NOT NULL
    GROUP BY client_ip ORDER BY requests DESC LIMIT 100`).all(...args);
  const hosts = rollup
    ? db.prepare(`SELECT host_id, SUM(requests) AS requests,
        SUM(bytes_out) AS bytes_out, SUM(bytes_in) AS bytes_in,
        SUM(CASE WHEN status_band = '5xx' THEN requests ELSE 0 END) AS errors
        FROM analytics_hour WHERE ${where}
        GROUP BY host_id ORDER BY requests DESC`).all(...args)
    : db.prepare(`SELECT host_id, COUNT(*) AS requests,
        SUM(bytes_out) AS bytes_out, SUM(COALESCE(bytes_in,0)) AS bytes_in,
        SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS errors
        FROM analytics_event WHERE ${where}
        GROUP BY host_id ORDER BY requests DESC`).all(...args);

  const rawConditions = ["occurred_at >= ?"];
  const rawArgs = [since];
  if (hostId !== null) { rawConditions.push("host_id = ?"); rawArgs.push(hostId); }
  if (statusClass !== null) {
    const min = Number(statusClass[0]) * 100;
    rawConditions.push("status >= ? AND status < ?");
    rawArgs.push(min, min + 100);
  }
  const rawWhere = rawConditions.join(" AND ");
  const breakdown = (field, limit = 15) => {
    if (rollup) return [];
    const permitted = ["domain", "method", "path", "device", "protocol", "upstream_status", "status"];
    if (!permitted.includes(field)) throw new RangeError("Invalid breakdown dimension");
    return db.prepare(`SELECT ${field} AS label, COUNT(*) AS requests,
      SUM(bytes_out) AS bytes_out FROM analytics_event
      WHERE ${rawWhere} GROUP BY ${field}
      ORDER BY requests DESC LIMIT ?`).all(...rawArgs, limit).map((row) => ({
      label: String(row.label ?? "unknown"),
      requests: Number(row.requests),
      bytes_out: Number(row.bytes_out || 0),
    }));
  };
  const latencySamples = rollup ? 0 : db.prepare(`SELECT COUNT(*) AS n FROM analytics_event
    WHERE ${rawWhere} AND duration_ms IS NOT NULL`).get(...rawArgs).n;
  const percentile = (percentage) => {
    if (rollup || latencySamples === 0) return null;
    const offset = Math.max(0, Math.ceil(latencySamples * percentage) - 1);
    return db.prepare(`SELECT duration_ms FROM analytics_event
      WHERE ${rawWhere} AND duration_ms IS NOT NULL
      ORDER BY duration_ms LIMIT 1 OFFSET ?`).get(...rawArgs, offset)?.duration_ms ?? null;
  };
  const userAgents = rollup ? [] : db.prepare(`SELECT user_agent AS label, COUNT(*) AS requests,
    SUM(bytes_out) AS bytes_out FROM analytics_event WHERE ${rawWhere}
    AND user_agent IS NOT NULL GROUP BY user_agent ORDER BY requests DESC LIMIT 60`).all(...rawArgs)
    .map((row) => ({ label: row.label, requests: Number(row.requests), bytes_out: Number(row.bytes_out || 0) }));
  const bots = rollup ? [] : db.prepare(`SELECT bot_class AS label, COUNT(*) AS requests,
    SUM(bytes_out) AS bytes_out FROM analytics_event WHERE ${rawWhere}
    GROUP BY bot_class ORDER BY requests DESC`).all(...rawArgs)
    .map((row) => ({ label: row.label || "not recorded", requests: Number(row.requests), bytes_out: Number(row.bytes_out || 0) }));
  const uniqueIps = rollup ? null : db.prepare(`SELECT COUNT(DISTINCT client_ip) AS n
    FROM analytics_event WHERE ${rawWhere} AND client_ip IS NOT NULL`).get(...rawArgs).n;
  const denied = rollup ? null : db.prepare(`SELECT COUNT(*) AS n FROM analytics_event
    WHERE ${rawWhere} AND block_reason IS NOT NULL`).get(...rawArgs).n;
  const slowPaths = rollup ? [] : db.prepare(`SELECT host_id, path, COUNT(*) AS requests,
    ROUND(AVG(duration_ms),1) AS average_ms, ROUND(MAX(duration_ms),1) AS max_ms
    FROM analytics_event WHERE ${rawWhere} AND duration_ms IS NOT NULL
    GROUP BY host_id, path ORDER BY average_ms DESC LIMIT 25`).all(...rawArgs);
  const errorPaths = rollup ? [] : db.prepare(`SELECT host_id, path, COUNT(*) AS requests,
    SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS server_errors
    FROM analytics_event WHERE ${rawWhere} AND status >= 400
    GROUP BY host_id,path ORDER BY requests DESC LIMIT 25`).all(...rawArgs);
  const firstLast = rollup
    ? db.prepare(`SELECT MIN(bucket) AS first_seen, MAX(bucket) AS last_seen
      FROM analytics_hour WHERE ${where}`).get(...args)
    : db.prepare(`SELECT MIN(occurred_at) AS first_seen, MAX(occurred_at) AS last_seen
      FROM analytics_event WHERE ${where}`).get(...args);
  const lastIngestion = db.prepare("SELECT MAX(modified_at) AS last_checkpoint FROM analytics_cursor").get().last_checkpoint;
  const totalHosts = db.prepare(rollup
    ? `SELECT COUNT(DISTINCT host_id) AS n FROM analytics_hour WHERE ${where}`
    : `SELECT COUNT(DISTINCT host_id) AS n FROM analytics_event WHERE ${where}`).get(...args).n;

  return {
    scope: "local-node",
    hours,
    filters: { host_id: hostId, status_class: statusClass },
    accuracy: rollup ? "hourly-rollup" : "raw-events",
    granularity: stride === 60 ? "minute" : stride === 3600 ? "hour" : "day",
    retained_raw_days: retention.rawDays,
    retained_rollup_days: retention.rollupDays,
    requests, bytes_out: bytesOut, bytes_in: bytesIn, status,
    active_hosts: totalHosts,
    server_error_rate: requests ? status["5xx"] / requests : 0,
    latency_ms: { samples: latencySamples, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) },
    first_seen: firstLast.first_seen === null ? null : new Date(firstLast.first_seen * 1000).toISOString(),
    last_seen: firstLast.last_seen === null ? null : new Date(firstLast.last_seen * 1000).toISOString(),
    last_ingested_at: lastIngestion === null ? null : new Date(lastIngestion).toISOString(),
    timeline,
    hosts: hosts.map((host) => ({
      host_id: host.host_id,
      requests: Number(host.requests),
      bytes_out: Number(host.bytes_out || 0),
      bytes_in: Number(host.bytes_in || 0),
      errors: Number(host.errors || 0),
    })),
    unique_ips: uniqueIps, blocked_requests: denied,
    ips: ips.map((row) => ({
      ip: row.ip, requests: Number(row.requests), bytes_out: Number(row.bytes_out || 0),
      errors: Number(row.errors), first_seen: new Date(row.first_seen * 1000).toISOString(),
      last_seen: new Date(row.last_seen * 1000).toISOString(),
    })),
    user_agents: userAgents, bots,
    domains: breakdown("domain"), methods: breakdown("method"),
    paths: breakdown("path", 25), protocols: breakdown("protocol"),
    devices: breakdown("device"), upstreams: breakdown("upstream_status"),
    status_codes: breakdown("status"),
    slow_paths: slowPaths, error_paths: errorPaths,
    limitations: {
      node: "Only traffic recorded by this server is included; NPMX does not copy metrics.",
      history: "Older requests cannot be reconstructed before analytics logging was enabled.",
      extended: rollup ? "Path, device, method, hostname, protocol and latency details require retained raw events." : null,
      visitors: "Unique IPs are network endpoints, not unique people. User agents and bot names are unverified claims; no GeoIP database is bundled.",
      coverage: "Instrumented proxy, redirect, 404, default-site and fallback HTTP requests are counted here. TCP/UDP connections are counted separately in the Streams tab as completed sessions.",
    },
  };
}

export function getNodeAnalyticsRequests(filters, limit = 50, offset = 0) {
  const { hours, hostId, statusClass } = parseNodeFilters(filters);
  const ip = filters.ip || null;
  const userAgent = filters.userAgent || filters.user_agent || null;
  const bot = filters.bot || null;
  const connectionId = filters.connectionId || filters.connection_id || null;
  if (![1,24,168,720,2160].includes(hours) || !Number.isInteger(limit) || limit < 1 || limit > 100 ||
    !Number.isInteger(offset) || offset < 0 || offset > 10000)
    throw new RangeError("Invalid request history window or pagination");
  if (ip !== null && (typeof ip !== "string" || ip.length > 45))
    throw new RangeError("Invalid IP filter");
  if (userAgent !== null && (typeof userAgent !== "string" || userAgent.length > 1024))
    throw new RangeError("Invalid user-agent filter");
  if (bot !== null && (typeof bot !== "string" || bot.length > 50))
    throw new RangeError("Invalid bot filter");
  if (connectionId !== null && (typeof connectionId !== "string" || !/^\d{1,18}$/.test(connectionId)))
    throw new RangeError("Invalid connection identifier");
  const db = getAnalyticsDatabase();
  const retention = getAnalyticsRetention();
  if (hours > retention.rawDays * 24) throw new RangeError("Request details have expired outside raw retention");
  const conditions = ["occurred_at >= ?"];
  const args = [Math.floor(Date.now() / 1000) - hours * 3600];
  if (hostId !== null) { conditions.push("host_id = ?"); args.push(hostId); }
  if (statusClass !== null) {
    const min = Number(statusClass[0]) * 100;
    conditions.push("status >= ? AND status < ?"); args.push(min, min + 100);
  }
  if (ip !== null) { conditions.push("client_ip = ?"); args.push(ip); }
  if (userAgent !== null) { conditions.push("user_agent = ?"); args.push(userAgent); }
  if (bot !== null) { conditions.push("bot_class = ?"); args.push(bot); }
  if (connectionId !== null) { conditions.push("connection_id = ?"); args.push(connectionId); }
  const where = conditions.join(" AND ");
  const total = db.prepare(`SELECT COUNT(*) AS n FROM analytics_event WHERE ${where}`).get(...args).n;
  const entries = db.prepare(`SELECT id,host_id,occurred_at,occurred_at_ms,domain,method,path,protocol,
    status,bytes_out,bytes_in,duration_ms,upstream_ms,upstream_status,device,
    client_ip,peer_ip,user_agent,request_id,connection_id,connection_requests,scheme,tls,bot_class,block_reason
    FROM analytics_event WHERE ${where}
    ORDER BY occurred_at DESC,id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  return { total, limit, offset, entries: entries.map((row) => ({
    ...row, at: new Date(row.occurred_at_ms || row.occurred_at * 1000).toISOString(),
  })) };
}

export function exportNodeAnalyticsCsv(filters) {
  const { hours, hostId, statusClass } = parseNodeFilters(filters);
  if (![1, 24, 168, 720, 2160].includes(hours) || hours > getAnalyticsRetention().rawDays * 24)
    throw new RangeError("Exports require retained raw request events");
  // Full export uses a bounded indexed query instead of the paged 100-row API.
  const conditions = ["occurred_at >= ?"];
  const args = [Math.floor(Date.now()/1000) - hours * 3600];
  if (hostId !== null) { conditions.push("host_id=?"); args.push(hostId); }
  if (statusClass !== null) { const min = Number(statusClass[0])*100; conditions.push("status>=? AND status<?"); args.push(min,min+100); }
  const ip = filters.ip || null;
  const userAgent = filters.userAgent || filters.user_agent || null;
  const bot = filters.bot || null;
  const connectionId = filters.connectionId || filters.connection_id || null;
  if (ip !== null) { conditions.push("client_ip=?"); args.push(ip); }
  if (userAgent !== null) { conditions.push("user_agent=?"); args.push(userAgent); }
  if (bot !== null) { conditions.push("bot_class=?"); args.push(bot); }
  if (connectionId !== null) { conditions.push("connection_id=?"); args.push(connectionId); }
  // Match exactly the validated explorer filters; do not accept arbitrary SQL.
  getNodeAnalyticsRequests(filters, 1, 0);
  const db = getAnalyticsDatabase();
  const rows = db.prepare(`SELECT host_id,occurred_at,occurred_at_ms,client_ip,user_agent,bot_class,request_id,connection_id,domain,method,path,protocol,status,bytes_out,bytes_in,
    duration_ms,upstream_ms,upstream_status,device FROM analytics_event WHERE ${conditions.join(" AND ")}
    ORDER BY occurred_at DESC,id DESC LIMIT 10001`).all(...args);
  const headers = ["route_id","timestamp_utc","source_ip","user_agent","bot_class","request_id","connection_id","hostname","method","path","protocol","status","bytes_out","bytes_in","duration_ms","upstream_ms","upstream_status","device"];
  const safe = (val) => {
    let value = String(val ?? "");
    if (/^[=+@\t\r-]/.test(value)) value = "'" + value;
    return '"' + value.replaceAll('"', '""') + '"';
  };
  const csv = rows.slice(0,10000).map((row)=>[
    row.host_id,new Date(row.occurred_at_ms || row.occurred_at*1000).toISOString(),row.client_ip,row.user_agent,row.bot_class,row.request_id,row.connection_id,row.domain,row.method,row.path,row.protocol,
    row.status,row.bytes_out,row.bytes_in,row.duration_ms,row.upstream_ms,row.upstream_status,row.device,
  ].map(safe).join(","));
  return { csv: [headers.join(","),...csv].join("\n")+"\n", truncated: rows.length > 10000 };
}


/**
 * Complete paginated investigative dimensions. Overview top-N caps never
 * limit this endpoint: users can page through all retained IPs/agents.
 */
export function getNodeDimension(kind, filters = {}, options = {}) {
  const columns = { ips: "client_ip", "user-agents": "user_agent", bots: "bot_class" };
  const column = columns[kind];
  if (!column) throw new RangeError("Unsupported analytics dimension");
  const { hours, hostId, statusClass } = parseNodeFilters(filters);
  const limit = options.limit === undefined ? 50 : Number(options.limit);
  const offset = options.offset === undefined ? 0 : Number(options.offset);
  const search = options.search === undefined ? "" : options.search;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000 ||
      typeof search !== "string" || search.length > 256)
    throw new RangeError("Invalid dimension pagination or search");
  if (hours > getAnalyticsRetention().rawDays * 24) {
    return { kind, hours, limit, offset, search, total: 0, entries: [],
      raw_unavailable: true };
  }
  const conditions = ["occurred_at >= ?", `${column} IS NOT NULL`, `${column} <> ''`];
  const args = [Math.floor(Date.now() / 1000) - hours * 3600];
  if (hostId !== null) { conditions.push("host_id = ?"); args.push(hostId); }
  if (statusClass !== null) {
    const min = Number(statusClass[0]) * 100;
    conditions.push("status >= ? AND status < ?");
    args.push(min, min + 100);
  }
  if (search.trim()) {
    const escaped = search.trim().replace(/[\\%_]/g, (char) => "\\" + char);
    conditions.push(`${column} LIKE ? ESCAPE '\\'`);
    args.push(`%${escaped}%`);
  }
  const db = getAnalyticsDatabase();
  const where = conditions.join(" AND ");
  const total = db.prepare(`SELECT COUNT(DISTINCT ${column}) AS n
    FROM analytics_event WHERE ${where}`).get(...args).n;
  const rows = db.prepare(`SELECT ${column} AS value, COUNT(*) AS requests,
    SUM(bytes_out) AS bytes_out, SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors,
    SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS server_errors,
    SUM(CASE WHEN block_reason IS NOT NULL THEN 1 ELSE 0 END) AS blocked,
    COUNT(DISTINCT host_id) AS routes,
    MIN(occurred_at) AS first_seen, MAX(occurred_at) AS last_seen
    FROM analytics_event WHERE ${where}
    GROUP BY ${column} ORDER BY requests DESC, value ASC
    LIMIT ? OFFSET ?`).all(...args, limit, offset);
  return {
    kind, hours, search, total: Number(total), limit, offset, raw_unavailable: false,
    entries: rows.map((row) => ({
      value: row.value,
      requests: Number(row.requests),
      bytes_out: Number(row.bytes_out || 0),
      errors: Number(row.errors || 0),
      server_errors: Number(row.server_errors || 0),
      blocked: Number(row.blocked || 0),
      routes: Number(row.routes || 0),
      first_seen: new Date(row.first_seen * 1000).toISOString(),
      last_seen: new Date(row.last_seen * 1000).toISOString(),
    })),
  };
}

import { getAnalyticsDatabase, getAnalyticsRetention } from "./proxy-analytics.js";
import { parseNodeFilters } from "./node-analytics.js";
import { isIP } from "node:net";

/**
 * Exact-value drill-down, not a filtered first page of the IP / UA directory.
 * Uses local raw events and does not modify cluster configuration.
 */
export function getNodeProfile(kind, value, filters = {}) {
  const { hours, hostId, statusClass } = parseNodeFilters(filters);
  const field = kind === "ips" ? "client_ip" : kind === "user-agents" ? "user_agent" : null;
  if (!field) throw new RangeError("Unknown profile type");
  if (typeof value !== "string" || !value || value.length > (field === "client_ip" ? 45 : 1024))
    throw new RangeError("Invalid profile identifier");
  if (field === "client_ip" && !isIP(value))
    throw new RangeError("Invalid IPv4 or IPv6 address");
  if (hours > getAnalyticsRetention().rawDays * 24)
    return { kind, value, raw_unavailable: true, hours };
  const db = getAnalyticsDatabase();
  const conditions = ["occurred_at >= ?", `${field} = ?`];
  const args = [Math.floor(Date.now() / 1000) - hours * 3600, value];
  if (hostId !== null) { conditions.push("host_id = ?"); args.push(hostId); }
  if (statusClass !== null) {
    const lower = Number(statusClass[0]) * 100;
    conditions.push("status >= ? AND status < ?");
    args.push(lower, lower + 100);
  }
  const where = conditions.join(" AND ");
  const row = db.prepare(`SELECT COUNT(*) AS requests,
    SUM(bytes_out) AS bytes_out,
    SUM(bytes_in) AS bytes_in,
    SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors,
    SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS server_errors,
    SUM(CASE WHEN block_reason IS NOT NULL THEN 1 ELSE 0 END) AS blocked,
    COUNT(DISTINCT host_id) AS route_count,
    COUNT(DISTINCT client_ip) AS ip_count,
    COUNT(DISTINCT user_agent) AS agent_count,
    COUNT(DISTINCT connection_id) AS connections,
    MIN(occurred_at) AS first_seen, MAX(occurred_at) AS last_seen,
    ROUND(AVG(duration_ms), 1) AS average_ms
    FROM analytics_event WHERE ${where}`).get(...args);
  const breakdown = (column, limit=20) => {
    const allowed = ["host_id","domain","method","status","bot_class","user_agent","client_ip","path","connection_id"];
    if (!allowed.includes(column)) throw new RangeError("Invalid profile dimension");
    return db.prepare(`SELECT ${column} AS label, COUNT(*) AS requests,
      SUM(bytes_out) AS bytes_out, MIN(occurred_at) AS first_seen,
      MAX(occurred_at) AS last_seen
      FROM analytics_event WHERE ${where} AND ${column} IS NOT NULL
      GROUP BY ${column} ORDER BY requests DESC LIMIT ?`).all(...args,limit)
      .map(x=>({
        label:String(x.label), requests:Number(x.requests),
        bytes_out:Number(x.bytes_out || 0),
        first_seen:new Date(x.first_seen*1000).toISOString(),
        last_seen:new Date(x.last_seen*1000).toISOString(),
      }));
  };
  const timeline=db.prepare(`SELECT (occurred_at / 3600) * 3600 AS bucket,
    COUNT(*) AS requests,
    SUM(bytes_out) AS bytes_out,
    SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors,
    SUM(CASE WHEN block_reason IS NOT NULL THEN 1 ELSE 0 END) AS blocked
    FROM analytics_event WHERE ${where}
    GROUP BY (occurred_at / 3600) ORDER BY bucket`).all(...args)
    .map(x=>({
      at:new Date(x.bucket*1000).toISOString(),
      requests:Number(x.requests),
      bytes_out:Number(x.bytes_out || 0),
      errors:Number(x.errors || 0),
      blocked:Number(x.blocked || 0),
    }));
  return {
    kind, value, hours, raw_unavailable:false,
    requests:Number(row.requests || 0),
    bytes_out:Number(row.bytes_out || 0),
    bytes_in:Number(row.bytes_in || 0),
    errors:Number(row.errors || 0),
    server_errors:Number(row.server_errors || 0),
    blocked:Number(row.blocked || 0),
    route_count:Number(row.route_count || 0),
    ip_count:Number(row.ip_count || 0),
    agent_count:Number(row.agent_count || 0),
    connections:Number(row.connections || 0),
    first_seen:row.first_seen === null ? null : new Date(row.first_seen*1000).toISOString(),
    last_seen:row.last_seen === null ? null : new Date(row.last_seen*1000).toISOString(),
    average_ms:row.average_ms,
    timeline,
    routes:breakdown("host_id"),
    domains:breakdown("domain"),
    methods:breakdown("method"),
    statuses:breakdown("status"),
    bots:breakdown("bot_class"),
    paths:breakdown("path",30),
    connections_list:breakdown("connection_id",30),
    related_ips: field==="user_agent" ? breakdown("client_ip",30) : [],
    related_agents: field==="client_ip" ? breakdown("user_agent",30) : [],
  };
}

import express from "express";
import os from "node:os";
import jwtdecode from "../lib/express/jwt-decode.js";
import { addNodeBlockRule, deleteNodeBlockRule, listNodeBlockRules, getNodeBlockAudit, enableKnownScannerBlocking, getKnownScannerPolicy, setKnownScannerPolicy } from "../internal/analytics-blocking.js";
import internalProxyHost from "../internal/proxy-host.js";
import internalRedirectionHost from "../internal/redirection-host.js";
import internalDeadHost from "../internal/dead-host.js";
import internalStream from "../internal/stream.js";
import { getNodeStreamAnalytics } from "../internal/stream-analytics.js";
import internalInstanceSync from "../internal/instance-sync.js";
import {
  exportNodeAnalyticsCsv,
  getNodeAnalytics,
  getNodeAnalyticsRequests,
  parseNodeFilters,
} from "../internal/node-analytics.js";

const router = express.Router({ caseSensitive: true, strict: true, mergeParams: true });

function routeIdentity(id) {
  if (id > 0) return { kind: "proxy", routeId: id };
  if (id < -1000000 && id > -2000000) return { kind: "redirection", routeId: -id - 1000000 };
  if (id < -2000000 && id > -3000000) return { kind: "dead", routeId: -id - 2000000 };
  if (id === -3000000) return { kind: "default", routeId: null };
  return { kind: "fallback", routeId: null };
}
router.use(jwtdecode());

/**
 * Full-node reporting exposes aggregates across all proxy hosts, including
 * hosts owned by other accounts. Require Settings read access (admin-level).
 * Each request independently authorizes before opening any analytics data.
 */
const authorize = async (res) => {
  await res.locals.access.can("settings:get");
};

const reportFilters = (query) => ({
  ...parseNodeFilters(query),
  ip: query.ip,
  user_agent: query.user_agent,
  bot: query.bot,
  connection_id: query.connection_id,
});

router.get("/node", async (req, res, next) => {
  try {
    await authorize(res);
    const filters = reportFilters(req.query);
    const [report, hosts, redirects, deadHosts, streams, sync] = await Promise.all([
      Promise.resolve().then(() => getNodeAnalytics(filters)),
      internalProxyHost.getAll(res.locals.access),
      internalRedirectionHost.getAll(res.locals.access),
      internalDeadHost.getAll(res.locals.access),
      internalStream.getAll(res.locals.access),
      internalInstanceSync.getStatus(),
    ]);
    const domains = new Map(hosts.map((host) => [Number(host.id), host.domain_names || []]));
    const configured = new Map(hosts.map((host) => [Number(host.id), Boolean(host.enabled)]));
    const redirectDomains = new Map(redirects.map((host) => [Number(host.id), host.domain_names || []]));
    const deadDomains = new Map(deadHosts.map((host) => [Number(host.id), host.domain_names || []]));
    const streamReport = getNodeStreamAnalytics(filters.hours);
    res.status(200).send({
      ...report,
      stream_traffic: {
        ...streamReport,
        streams: streamReport.streams.map((row) => ({
          ...row,
          incoming_port: streams.find((entry) => Number(entry.id) === row.stream_id)?.incoming_port ?? null,
          configured: streams.some((entry) => Number(entry.id) === row.stream_id),
        })),
      },
      node: {
        name: sync.nodeName || os.hostname(),
        id: sync.nodeId || null,
        role: sync.enabled ? sync.role : "standalone",
        version: sync.version || null,
      },
      hosts: report.hosts.map((host) => {
        const identity = routeIdentity(host.host_id);
        const nameList = identity.kind === "proxy" ? domains
          : identity.kind === "redirection" ? redirectDomains
            : identity.kind === "dead" ? deadDomains : null;
        const hostDomains = nameList?.get(identity.routeId) || [];
        return {
          ...host, kind: identity.kind, route_id: identity.routeId,
          domains: hostDomains,
          configured: identity.kind === "proxy" ? configured.has(identity.routeId)
            : Boolean(nameList?.has(identity.routeId)) || identity.kind === "default" || identity.kind === "fallback",
          enabled: identity.kind === "proxy" ? (configured.get(identity.routeId) ?? null) : null,
        };
      }),
    });
  } catch (err) { next(err); }
});

router.get("/node/requests", async (req, res, next) => {
  try {
    await authorize(res);
    const filters = reportFilters(req.query);
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    res.status(200).send(getNodeAnalyticsRequests(filters, limit, offset));
  } catch (err) { next(err); }
});

router.get("/node/export", async (req, res, next) => {
  try {
    await authorize(res);
    const result = exportNodeAnalyticsCsv(reportFilters(req.query));
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", 'attachment; filename="npmi-node-analytics.csv"');
    res.set("X-Analytics-Truncated", String(result.truncated));
    res.status(200).send(result.csv);
  } catch (err) { next(err); }
});

/**
 * Blocking is local to the inspected node. Only administrators allowed to
 * change protection settings can mutate deny rules. Nginx test/reload and
 * rollback happen before acknowledging successful activation.
 */
const authorizeWrite = async (res) => {
  await res.locals.access.can("settings:update", "http-protection");
};
router.get("/blocks", async (_req, res, next) => {
  try {
    await authorize(res);
    res.status(200).send({ rules: listNodeBlockRules(), audit: getNodeBlockAudit() });
  } catch (err) { next(err); }
});
router.post("/blocks", async (req, res, next) => {
  try {
    await authorizeWrite(res);
    const operator = res.locals.access.token.getUserId(1);
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
      throw new RangeError("Rule body must be an object");
    const rule = addNodeBlockRule({
      type: req.body.type,
      target: req.body.target,
      note: req.body.note || "",
      operator,
    });
    res.status(201).send(rule);
  } catch (err) { next(err); }
});
router.delete("/blocks/:id", async (req, res, next) => {
  try {
    await authorizeWrite(res);
    const operator = res.locals.access.token.getUserId(1);
    const id = Number(req.params.id);
    res.status(200).send(deleteNodeBlockRule(id, operator));
  } catch (err) { next(err); }
});
router.get("/blocks/scanner-policy", async (_req, res, next) => {
  try {
    await authorize(res);
    res.status(200).send(getKnownScannerPolicy());
  } catch (err) { next(err); }
});
router.put("/blocks/scanner-policy", async (req, res, next) => {
  try {
    await authorizeWrite(res);
    const operator = res.locals.access.token.getUserId(1);
    res.status(200).send(setKnownScannerPolicy(req.body?.enabled, operator));
  } catch (err) { next(err); }
});

router.post("/blocks/scanner-presets", async (_req, res, next) => {
  try {
    await authorizeWrite(res);
    const operator = res.locals.access.token.getUserId(1);
    res.status(200).send(enableKnownScannerBlocking(operator));
  } catch (err) { next(err); }
});

export default router;

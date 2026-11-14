import express from "express";
import jwtdecode from "../lib/express/jwt-decode.js";
import internalAuditLog from "../internal/audit-log.js";
import {
  addDynamicDNSRecord, deleteDynamicDNSRecord,
  listDynamicDNSProviders, listDynamicDNSRecords, refreshDynamicDNS,
} from "../lib/dynamic-dns.js";

const router = express.Router({ caseSensitive: true, strict: true, mergeParams: true });
router.use(jwtdecode());
let lastManualRefresh = 0;
const read = async (res) => res.locals.access.can("settings:get");
const write = async (res) => res.locals.access.can("settings:update", "dynamic-dns");
const badInput = (res, error) => res.status(400).json({ error: { code: 400, message: error.message } });

router.get("/", async (_req, res, next) => {
  try {
    await read(res);
    res.status(200).json({ providers: listDynamicDNSProviders(), records: listDynamicDNSRecords() });
  } catch (error) { next(error); }
});

router.post("/", async (req, res, next) => {
  try {
    await write(res);
    const record = addDynamicDNSRecord(req.body);
    await internalAuditLog.add(res.locals.access, {
      action: "created", object_type: "dynamic_dns", object_id: 0,
      meta: { provider: record.provider, hostname: record.hostname, record_type: record.recordType },
    }).catch(() => {});
    res.status(201).json(record);
  } catch (error) {
    if (error instanceof RangeError) return badInput(res, error);
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await write(res);
    const deleted = deleteDynamicDNSRecord(req.params.id);
    if (deleted) await internalAuditLog.add(res.locals.access, {
      action: "deleted", object_type: "dynamic_dns", object_id: 0,
      meta: { record_id: req.params.id },
    }).catch(() => {});
    res.status(deleted ? 200 : 404).json({ deleted });
  } catch (error) { next(error); }
});

router.post("/refresh", async (_req, res, next) => {
  try {
    await write(res);
    if (Date.now() - lastManualRefresh < 60000) {
      return res.status(429).json({ error: { code: 429, message: "Wait one minute between manual Dynamic DNS refreshes." } });
    }
    lastManualRefresh = Date.now();
    res.status(200).json(await refreshDynamicDNS({ force: true }));
  } catch (error) { next(error); }
});

export default router;

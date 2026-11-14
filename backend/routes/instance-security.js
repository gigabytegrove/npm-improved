import express from "express";
import jwtdecode from "../lib/express/jwt-decode.js";
import internalAuditLog from "../internal/audit-log.js";
import {
  configureInstanceSecurity,
  getInstanceSecurityStatus,
  reconcileInstanceSecurity,
  confirmInstanceSecurityActivation,
} from "../internal/instance-security.js";

const router = express.Router({ caseSensitive: true, strict: true, mergeParams: true });
router.use(jwtdecode());

router.get("/", async (_req, res, next) => {
  try {
    await res.locals.access.can("settings:get");
    res.status(200).json(await getInstanceSecurityStatus());
  } catch (error) { next(error); }
});

router.put("/", async (req, res, next) => {
  try {
    await res.locals.access.can("settings:update", "instance-security");
    const result = await configureInstanceSecurity(req.body);
    await internalAuditLog.add(res.locals.access, {
      action: "updated", object_type: "instance_security", object_id: 0,
      meta: { mode: result.config.mode, state: result.config.state,
        management_network_count: result.config.trustedNetworks.length,
        confirmation_required: Boolean(result.pendingUntil) },
    }).catch(() => {});
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof RangeError) return res.status(400).json({ error: { code: 400, message: error.message } });
    if (error.message?.includes("Firewall helper is unavailable")) {
      return res.status(409).json({ error: { code: 409, message: error.message } });
    }
    next(error);
  }
});

router.post("/confirm", async (_req, res, next) => {
  try {
    await res.locals.access.can("settings:update", "instance-security");
    const result = await confirmInstanceSecurityActivation();
    await internalAuditLog.add(res.locals.access, {
      action: "confirmed", object_type: "instance_security", object_id: 0,
      meta: { mode: result.config.mode, state: result.config.state },
    }).catch(() => {});
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof RangeError) return res.status(409).json({ error: { code: 409, message: error.message } });
    next(error);
  }
});

router.post("/reconcile", async (_req, res, next) => {
  try {
    await res.locals.access.can("settings:update", "instance-security");
    await reconcileInstanceSecurity();
    res.status(200).json(await getInstanceSecurityStatus());
  } catch (error) { next(error); }
});

export default router;

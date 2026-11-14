import express from "express";
import jwtdecode from "../lib/express/jwt-decode.js";
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
    res.status(200).json(await configureInstanceSecurity(req.body));
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
    res.status(200).json(await confirmInstanceSecurityActivation());
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

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import streamModel from "../models/stream.js";
import {
  DEFAULT_MANAGEMENT_NETWORKS,
  normalizeInstanceSecurity,
  buildInstancePolicy,
  compileInstancePorts,
} from "../lib/instance-security-policy.js";
import { global as logger } from "../logger.js";

const directory = process.env.NPM_INSTANCE_SECURITY_DIR || "/data/instance-security";
const configPath = path.join(directory, "config.json");
const policyPath = path.join(directory, "policy.json");
const statusPath = path.join(directory, "status.json");
const managementPort = Number(process.env.NPM_ADMIN_PORT || "81");
let reconciling = null;

function readJSON(filename, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function atomicJSON(filename, value) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = filename + "." + crypto.randomUUID() + ".tmp";
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, filename);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* Temporary file already absent or cleanup failed. */ }
  }
}

export function currentSecurityConfiguration() {
  return readJSON(configPath, {
    configured: false, mode: "unmanaged", state: "deferred",
    trustedNetworks: [...DEFAULT_MANAGEMENT_NETWORKS], hostLanIp: "", acknowledgedDmz: false,
  });
}

async function serviceRows() {
  return streamModel.query()
    .select("id", "incoming_port", "tcp_forwarding", "udp_forwarding", "enabled", "is_deleted")
    .where("is_deleted", 0);
}

export async function reconcileInstanceSecurity() {
  if (reconciling) return reconciling;
  reconciling = (async () => {
    let config = currentSecurityConfiguration();
    if (config.pendingActivation && Date.parse(config.pendingActivation.deadline) <= Date.now()) {
      const previous = config.pendingActivation.previous;
      config = previous?.configured ? previous : { ...config, pendingActivation: undefined, state: "deferred" };
      atomicJSON(configPath, config);
      logger.warn("Unconfirmed instance firewall activation expired; restored the previous security policy.");
    }
    const streams = await serviceRows();
    const policy = buildInstancePolicy(config, streams, managementPort);
    const encoded = JSON.stringify(policy, null, 2) + "\n";
    let previous = null;
    try { previous = fs.readFileSync(policyPath, "utf8"); } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (previous !== encoded) atomicJSON(policyPath, policy);
    return policy;
  })();
  try { return await reconciling; } finally { reconciling = null; }
}

export async function configureInstanceSecurity(input, { initial = false } = {}) {
  const config = normalizeInstanceSecurity(input);
  if (initial && config.state === "active") {
    throw new RangeError("Activate managed filtering after signing in and checking access.");
  }
  if (config.state === "active") {
    const helper = readJSON(statusPath, null);
    const age = helper?.checkedAt ? Date.now() - Date.parse(helper.checkedAt) : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(age) || age > 20000) {
      throw new Error("Firewall helper is unavailable. Managed filtering cannot be activated.");
    }
  }
  const oldConfig = currentSecurityConfiguration();
  if (config.state === "active") {
    const previous = oldConfig.pendingActivation?.previous ?? oldConfig;
    config.pendingActivation = {
      deadline: new Date(Date.now() + 120000).toISOString(),
      previous: { ...previous, pendingActivation: undefined },
    };
  }
  atomicJSON(configPath, config);
  try { await reconcileInstanceSecurity(); }
  catch (error) {
    if (oldConfig.configured) atomicJSON(configPath, oldConfig);
    else fs.rmSync(configPath, { force: true });
    await reconcileInstanceSecurity().catch(() => {});
    throw error;
  }
  return await getInstanceSecurityStatus();
}

export async function confirmInstanceSecurityActivation() {
  const config = currentSecurityConfiguration();
  if (!config.pendingActivation) throw new RangeError("There is no pending firewall activation to confirm.");
  if (Date.parse(config.pendingActivation.deadline) <= Date.now()) {
    await reconcileInstanceSecurity();
    throw new RangeError("The firewall confirmation window has expired.");
  }
  const currentStatus = await getInstanceSecurityStatus();
  if (!currentStatus.enforced) throw new Error("The firewall helper has not verified the new policy.");
  const confirmed = { ...config };
  delete confirmed.pendingActivation;
  atomicJSON(configPath, confirmed);
  await reconcileInstanceSecurity();
  return await getInstanceSecurityStatus();
}

export async function getInstanceSecurityStatus() {
  const config = currentSecurityConfiguration();
  const streams = await serviceRows();
  const ports = compileInstancePorts(streams, managementPort);
  const helper = readJSON(statusPath, null);
  let desiredHash = null;
  try { desiredHash = crypto.createHash("sha256").update(fs.readFileSync(policyPath)).digest("hex"); } catch {}
  const checkedAge = helper?.checkedAt ? Date.now() - Date.parse(helper.checkedAt) : Number.POSITIVE_INFINITY;
  const helperReady = Number.isFinite(checkedAge) && checkedAge >= 0 && checkedAge < 20000;
  const enforced = config.mode !== "unmanaged" && config.state === "active" &&
    helperReady && helper.state === "active" && helper.policyHash === desiredHash;
  const state = !config.configured ? "not_configured" : config.mode === "unmanaged" ? "unmanaged" :
    config.state === "deferred" ? "deferred" : enforced ?
      (config.pendingActivation ? "activation_pending" : "active") : "needs_attention";
  // In bridge networking, the container's interface address is NOT the host's LAN address.
  const containerAddresses = Object.values(os.networkInterfaces()).flat()
    .filter((entry) => entry && !entry.internal && entry.family === "IPv4")
    .map((entry) => entry.address);
  return {
    config, state, enforced, helperReady,
    pendingUntil: config.pendingActivation?.deadline || null,
    helperError: helperReady ? (helper.error || null) : "Firewall helper is not reporting.",
    managementPort, ports,
    dockerPublishing: "unverified",
    hostLanIp: config.hostLanIp || process.env.NPM_HOST_LAN_IP || null,
    containerAddresses,
    warning: "NPMi filters its Docker instance network namespace, not the router or other containers. Docker port publishing and router forwarding are independent.",
  };
}

export function startInstanceSecurityReconciler() {
  const run = () => reconcileInstanceSecurity().catch((error) => logger.warn("Instance firewall policy reconciliation failed: " + error.message));
  void run();
  const timer = setInterval(run, 5000);
  timer.unref?.();
}

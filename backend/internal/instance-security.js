import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { observedNetworkIdentity } from "../lib/instance-network-observation.js";
import { observePublicIpv4 } from "../lib/dynamic-dns.js";
import streamModel from "../models/stream.js";
import {
  DEFAULT_MANAGEMENT_NETWORKS,
  normalizeInstanceSecurity,
  switchInstanceFirewall,
  buildInstancePolicy,
  compileInstancePorts,
} from "../lib/instance-security-policy.js";
import { global as logger } from "../logger.js";
import { buildExposurePlan } from "../lib/instance-exposure.js";

const directory = process.env.NPM_INSTANCE_SECURITY_DIR || "/data/instance-security";
const configPath = path.join(directory, "config.json");
const policyDirectory = path.join(directory, "firewall");
const policyPath = path.join(policyDirectory, "policy.json");
const statusPath = path.join(policyDirectory, "status.json");
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
  if (path.dirname(filename) === policyDirectory) {
    fs.mkdirSync(policyDirectory, { recursive: true, mode: 0o755 });
  }
  const temporary = filename + "." + crypto.randomUUID() + ".tmp";
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: filename === policyPath ? 0o644 : 0o600, flag: "wx" });
    fs.renameSync(temporary, filename);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* Temporary file already absent or cleanup failed. */ }
  }
}

export function currentSecurityConfiguration() {
  return readJSON(configPath, {
    configured: false, enabled: true, mode: "static", state: "deferred",
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
  if (config.enabled && config.state === "active") {
    const helper = readJSON(statusPath, null);
    const age = helper?.checkedAt ? Date.now() - Date.parse(helper.checkedAt) : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(age) || age > 20000) {
      throw new Error("Firewall helper is unavailable. Managed filtering cannot be activated.");
    }
  }
  const oldConfig = currentSecurityConfiguration();
  if (config.enabled && config.state === "active") {
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

/**
 * Settings-level master switch. Off releases only NPMi's instance filtering,
 * preserving the configured model and trusted networks. Turning it back on
 * never silently activates default-deny; explicit confirmation is required.
 */
export async function setInstanceFirewallEnabled(enabled) {
  if (typeof enabled !== "boolean") throw new RangeError("Firewall enabled must be true or false.");
  const previous = currentSecurityConfiguration();
  if ((previous.enabled !== false) === enabled) return await getInstanceSecurityStatus();
  const normalized = switchInstanceFirewall(previous, enabled);
  atomicJSON(configPath, normalized);
  try {
    await reconcileInstanceSecurity();
  } catch (error) {
    if (previous.configured) atomicJSON(configPath, previous);
    else fs.rmSync(configPath, { force: true });
    await reconcileInstanceSecurity().catch(() => {});
    throw error;
  }
  return await getInstanceSecurityStatus();
}

export async function confirmInstanceSecurityActivation() {
  const config = currentSecurityConfiguration();
  if (config.enabled === false) throw new RangeError("Enable firewall functionality before confirming activation.");
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
  const enabled = config.enabled !== false;
  const disabling = !enabled && helperReady && helper.state === "active";
  const disabledUnverified = !enabled && !disabling && (!helperReady || helper.state !== "deferred");
  const releasePending = disabling || disabledUnverified;
  const enforced = enabled && config.mode !== "unmanaged" && config.state === "active" &&
    helperReady && helper.state === "active" && helper.policyHash === desiredHash;
  const state = disabling ? "disabling" : disabledUnverified ? "disabled_unverified" : !enabled ? "disabled" : !config.configured ? "not_configured" : config.mode === "unmanaged" ? "unmanaged" :
    config.state === "deferred" ? "deferred" : enforced ?
      (config.pendingActivation ? "activation_pending" : "active") : "needs_attention";
  // The addresses visible here are the container's in bridge mode, and the
  // host's in host-network mode. Public IPv4 is independently observed and
  // does not prove inbound reachability or router forwarding.
  const network = observedNetworkIdentity();
  const publicObservation = await observePublicIpv4();
  const hostLanIp = config.hostLanIp || process.env.NPM_HOST_LAN_IP || null;
  const observedRules = helperReady && helper?.state === "active" &&
    helper.liveRulesObserved === true && typeof helper.liveRules === "string"
      ? helper.liveRules : null;
  return {
    config: { ...config, enabled }, enabled, state, enforced, helperReady, releasePending,
    droppedPackets: enforced && Number.isSafeInteger(helper?.droppedPackets) ? helper.droppedPackets : null,
    droppedBytes: enforced && Number.isSafeInteger(helper?.droppedBytes) ? helper.droppedBytes : null,
    pendingUntil: config.pendingActivation?.deadline || null,
    helperError: helperReady ? (helper.error || null) : "Firewall helper is not reporting.",
    managementPort, ports,
    dockerPublishing: "unverified",
    exposurePlan: buildExposurePlan(config.mode, ports, hostLanIp || ""),
    hostLanIp,
    instanceIp: network.instanceIp,
    networkMode: network.networkMode,
    networkInterfaces: network.interfaces,
    containerAddresses: network.interfaces.map(({ address }) => address),
    publicIpv4: publicObservation.address,
    publicIpObservedAt: publicObservation.checkedAt
      ? new Date(publicObservation.checkedAt).toISOString() : null,
    // These are the actual kernel table rules read by the namespace-scoped
    // companion, not an invented representation of the intended policy.
    liveRules: observedRules,
    liveRulesObservedAt: observedRules ? helper.checkedAt : null,
    desiredPolicy: readJSON(policyPath, null),
    warning: "NPMi filters its Docker instance network namespace, not the router or other containers. Docker port publishing and router forwarding are independent.",
  };
}

export function startInstanceSecurityReconciler() {
  const run = () => reconcileInstanceSecurity().catch((error) => logger.warn("Instance firewall policy reconciliation failed: " + error.message));
  void run();
  const timer = setInterval(run, 5000);
  timer.unref?.();
}

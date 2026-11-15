import assert from "node:assert/strict";
import { test } from "node:test";
import { findRepairPeer, assertSafeRepairJoin, mergePeerHeartbeat } from "../lib/npmx-repair-policy.js";
import {
  createNpmxPairingCode,
  parseNpmxPairingCode,
  generateNpmxSecret,
  generateNpmxTokenId,
} from "../lib/npmx.js";

const peer = { node_id: "secondary-001", role: "secondary", node_name: "proxy2", public_url: "http://192.168.0.18:81", last_sync: "2026-11-12T12:00:00.000Z" };
const code = { mode: "repair", target_node_id: peer.node_id };
const local = (nodeId = "new-container-id", role = "primary", value = "disabled", peers = []) => ({
  value, meta: { node_id: nodeId, role, peers },
});

test("only an existing secondary can receive an in-place repair code", () => {
  assert.deepEqual(findRepairPeer([peer], peer.node_id), peer);
  assert.throws(() => findRepairPeer([], peer.node_id), /not enrolled/);
  assert.throws(() => findRepairPeer([{ ...peer, role: "primary" }], peer.node_id), /not enrolled/);
  assert.throws(() => findRepairPeer([peer], "unknown"), /not enrolled/);
});

test("repair preserves the original peer ID instead of creating a replacement", () => {
  const choice = assertSafeRepairJoin({ code, current: local(), configuredSecret: "", restoreIdentity: true });
  assert.equal(choice.mode, "repair");
  assert.equal(choice.nodeId, peer.node_id);
  assert.equal(choice.identityRestoreRequired, true);
  assert.throws(() => assertSafeRepairJoin({ code, current: local(), configuredSecret: "", restoreIdentity: false }), /confirm identity restoration/);
});

test("repair without identity change needs no special takeover permission", () => {
  const choice = assertSafeRepairJoin({ code, current: local(peer.node_id, "secondary", "disabled"), configuredSecret: "previous" });
  assert.equal(choice.nodeId, peer.node_id);
  assert.equal(choice.identityRestoreRequired, false);
});

test("never converts a primary that still owns secondary peer membership", () => {
  assert.throws(() => assertSafeRepairJoin({
    code, current: local("primary-001", "primary", "enabled", [peer]), configuredSecret: "cluster", restoreIdentity: true,
  }), /already has enrolled secondary/);
});

test("active unrelated secondary cannot be silently adopted", () => {
  assert.throws(() => assertSafeRepairJoin({
    code, current: local("other-001", "secondary", "enabled"), configuredSecret: "different",
  }), /Explicit identity recovery confirmation/);
});

test("enrollment cannot overwrite an existing paired node", () => {
  const enroll = { mode: "enroll", target_node_id: null };
  assert.throws(() => assertSafeRepairJoin({
    code: enroll, current: local("existing", "secondary", "enabled"), configuredSecret: "cluster",
  }), /already has NPMX credentials/);
  const fresh = assertSafeRepairJoin({
    code: enroll, current: local("fresh"), configuredSecret: "",
  });
  assert.equal(fresh.nodeId, "fresh");
});

test("new codes explicitly select enroll or target one existing peer", () => {
  const args = { primaryUrl: "http://192.168.0.17:81", tokenId: generateNpmxTokenId(), tokenSecret: generateNpmxSecret(), expiresAt: new Date(Date.now() + 600_000).toISOString() };
  const enroll = parseNpmxPairingCode(createNpmxPairingCode(args));
  assert.equal(enroll.mode, "enroll");
  assert.equal(enroll.target_node_id, null);
  const repair = parseNpmxPairingCode(createNpmxPairingCode({ ...args, targetNodeId: peer.node_id }));
  assert.equal(repair.mode, "repair");
  assert.equal(repair.target_node_id, peer.node_id);
});

test("a repair code with missing or misleading target identity is rejected", () => {
  const args = { primaryUrl: "http://192.168.0.17:81", tokenId: generateNpmxTokenId(), tokenSecret: generateNpmxSecret(), expiresAt: new Date(Date.now() + 600_000).toISOString() };
  const raw = createNpmxPairingCode({ ...args, targetNodeId: peer.node_id });
  const [prefix, payload] = raw.split(".");
  const object = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  object.target_node_id = "";
  assert.throws(() => parseNpmxPairingCode(prefix + "." + Buffer.from(JSON.stringify(object)).toString("base64url")), /unsafe NPMX pairing mode/);
  assert.throws(() => createNpmxPairingCode({ ...args, targetNodeId: "" }), /requires a valid existing node ID/);
});

test("repair heartbeat preserves existing display/contact overrides and historical sync time", () => {
  const previous = { ...peer, configured_name: "Backup Proxy", configured_url: "http://192.168.0.18:81" };
  const now = "2026-11-15T14:00:00.000Z";
  const result = mergePeerHeartbeat(previous, { node_id: peer.node_id, role: "secondary", node_name: "reconnected", last_sync: null, repair_pending: true }, now);
  assert.equal(result.node_id, peer.node_id);
  assert.equal(result.configured_name, "Backup Proxy");
  assert.equal(result.configured_url, previous.configured_url);
  assert.equal(result.last_sync, previous.last_sync);
  assert.equal(result.repair_pending, true);
  assert.equal(result.last_seen, now);
  const refreshed = mergePeerHeartbeat(result, { node_id: peer.node_id, last_sync: "2026-11-15T14:03:00.000Z" }, now);
  assert.equal(refreshed.repair_pending, false);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeNetwork, normalizeInstanceSecurity, switchInstanceFirewall, compileInstancePorts, buildInstancePolicy,
} from "../lib/instance-security-policy.js";

test("four instance deployment models remain distinct", () => {
  for (const mode of ["static", "forwarded", "dmz", "unmanaged"]) {
    const config = normalizeInstanceSecurity({ mode, state: "deferred", acknowledgedDmz: true });
    assert.equal(config.mode, mode);
    assert.equal(config.state, "deferred");
  }
});

test("unmanaged is not a firewall-disabled managed mode", () => {
  assert.throws(() => normalizeInstanceSecurity({ mode: "unmanaged", state: "active" }));
  assert.throws(() => normalizeInstanceSecurity({ mode: "dmz", state: "active" }));
});

test("management access requires bounded CIDRs", () => {
  assert.equal(normalizeNetwork("192.168.1.10"), "192.168.1.10/32");
  assert.equal(normalizeNetwork("2001:db8::/64"), "2001:db8::/64");
  for (const network of ["0.0.0.0/0", "::/0", "192.168.1.100/99", "abc", "1.1.1.1/-1"]) {
    assert.throws(() => normalizeNetwork(network));
  }
});

test("ports are an instance-wide union of enabled stream protocols", () => {
  const streams = [
    { id: 10, incoming_port: 39482, enabled: 1, tcp_forwarding: true, udp_forwarding: false },
    { id: 11, incoming_port: 39482, enabled: 1, tcp_forwarding: true, udp_forwarding: true },
    { id: 12, incoming_port: 10000, enabled: 0, tcp_forwarding: true, udp_forwarding: true },
    { id: 13, incoming_port: 12000, enabled: 1, is_deleted: 1, tcp_forwarding: true },
  ];
  const ports = compileInstancePorts(streams);
  assert.deepEqual(ports.map((row) => row.protocol + ":" + row.port), ["tcp:80", "tcp:443", "tcp:39482", "udp:39482"]);
  assert.deepEqual(ports.find((row) => row.port === 39482 && row.protocol === "tcp").sources, ["stream:10", "stream:11"]);
});

test("management port collisions are rejected", () => {
  assert.throws(() => compileInstancePorts([{ id: 1, incoming_port: 81, enabled: true, tcp_forwarding: true }]));
});

test("policy does not copy proxy-host ACLs into a shared port filter", () => {
  const config = normalizeInstanceSecurity({ mode: "dmz", acknowledgedDmz: true, state: "active" });
  const policy = buildInstancePolicy(config, [], 81);
  assert.deepEqual(policy.ports, [{port:80,protocol:"tcp"},{port:443,protocol:"tcp"}]);
  assert.equal(policy.managementPort, 81);
  assert.equal(Object.hasOwn(policy, "hosts"), false);
});

test("activation deadline is propagated only when pending", () => {
  const config = normalizeInstanceSecurity({ mode: "static", state: "active", trustedNetworks: ["10.0.0.0/8"] });
  assert.equal(buildInstancePolicy(config, []).confirmBy, "");
  config.pendingActivation = { deadline: "2026-11-14T14:00:00.000Z" };
  assert.equal(buildInstancePolicy(config, []).confirmBy, "2026-11-14T14:00:00.000Z");
});

test("firewall functionality defaults to enabled but never enforces before confirmation", () => {
  const config = normalizeInstanceSecurity({ mode: "static", state: "deferred" });
  assert.equal(config.enabled, true);
  assert.equal(config.state, "deferred");
  assert.equal(buildInstancePolicy(config, []).state, "deferred");
});

test("master switch validates booleans and refuses disabled active policies", () => {
  assert.throws(() => normalizeInstanceSecurity({ enabled: "false", mode: "static", state: "deferred" }));
  assert.throws(() => normalizeInstanceSecurity({ enabled: false, mode: "static", state: "active" }));
  const active = normalizeInstanceSecurity({ enabled: true, mode: "static", state: "active" });
  const disabled = switchInstanceFirewall(active, false);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.state, "deferred");
  assert.equal(buildInstancePolicy(disabled, []).state, "deferred");
});

test("master switch preserves incomplete first-run security setup", () => {
  const initial = {
    configured: false,
    enabled: true,
    mode: "static",
    state: "deferred",
    trustedNetworks: ["10.0.0.0/8"],
    hostLanIp: "",
    acknowledgedDmz: false,
  };
  const disabled = switchInstanceFirewall(initial, false);
  assert.equal(disabled.configured, false);
  assert.equal(disabled.enabled, false);
  const restored = switchInstanceFirewall(disabled, true);
  assert.equal(restored.configured, false);
  assert.equal(restored.state, "deferred");
});

test("switching firewall off and back on preserves trusted networks, never auto-activates", () => {
  const initial = normalizeInstanceSecurity({
    enabled: true, mode: "forwarded", state: "active",
    trustedNetworks: ["192.168.0.0/24", "fd00::/8"],
    hostLanIp: "192.168.0.105",
  });
  const off = switchInstanceFirewall(initial, false);
  assert.deepEqual(off.trustedNetworks, initial.trustedNetworks);
  assert.equal(off.mode, "forwarded");
  assert.equal(off.hostLanIp, "192.168.0.105");
  assert.equal(off.enabled, false);
  const restored = switchInstanceFirewall(off, true);
  assert.equal(restored.enabled, true);
  assert.equal(restored.state, "deferred");
  assert.deepEqual(restored.trustedNetworks, initial.trustedNetworks);
  assert.throws(() => switchInstanceFirewall(off, "yes"));
});

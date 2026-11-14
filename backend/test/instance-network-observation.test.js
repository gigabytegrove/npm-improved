import test from "node:test";
import assert from "node:assert/strict";
import { observedInterfaceAddresses, observedNetworkIdentity, primaryRouteInterface } from "../lib/instance-network-observation.js";

const ipv4 = (address) => ({ address, family: "IPv4", internal: false });
const internal = (address) => ({ address, family: "IPv4", internal: true });

test("bridge-mode interface observation shows the Docker IP, not an invented host LAN address", () => {
  const data = { lo: [internal("127.0.0.1")], eth0: [ipv4("172.19.0.4")] };
  assert.deepEqual(observedInterfaceAddresses(data), [{ interface: "eth0", address: "172.19.0.4" }]);
  const identity = observedNetworkIdentity(data);
  assert.equal(identity.instanceIp, "172.19.0.4");
  assert.ok(!Object.hasOwn(identity, "hostLanIp"));
});

test("host-network interfaces expose their real host IPv4 addresses without manual input", () => {
  const data = { lo: [internal("127.0.0.1")], enp2s0: [ipv4("192.168.0.105")], wlan0: [ipv4("192.168.2.18")] };
  assert.equal(observedNetworkIdentity(data).instanceIp, "192.168.0.105");
  assert.deepEqual(observedInterfaceAddresses(data).map((x) => x.address), ["192.168.0.105", "192.168.2.18"]);
});

test("link-local, IPv6, loopback and empty networks never create fake addresses", () => {
  const data = {
    lo: [internal("127.0.0.1")],
    eth0: [ipv4("169.254.5.6"), { address: "fd00::1", family: "IPv6", internal: false }],
  };
  assert.equal(observedNetworkIdentity(data).instanceIp, null);
  assert.deepEqual(observedInterfaceAddresses({}), []);
});

test("primary eth0 is selected consistently when several namespaces are present", () => {
  const data = { veth0: [ipv4("172.18.0.1")], eth0: [ipv4("172.18.0.3")] };
  assert.equal(observedNetworkIdentity(data).instanceIp, "172.18.0.3");
});

test("default route selects actual routed interface instead of assuming eth0", () => {
  const routes = [
    "Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT",
    "eth0 00000000 0100000A 0003 0 0 200 00000000 0 0 0",
    "enp1s0 00000000 0100A8C0 0003 0 0 10 00000000 0 0 0",
  ].join("\n");
  assert.equal(primaryRouteInterface(routes), "enp1s0");
  const data = { eth0: [ipv4("10.0.0.2")], enp1s0: [ipv4("192.168.0.15")] };
  assert.equal(observedNetworkIdentity(data, routes).instanceIp, "192.168.0.15");
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildExposurePlan } from "../lib/instance-exposure.js";

const ports = [
 {port:80,protocol:"tcp",sources:["http"]},
 {port:443,protocol:"tcp",sources:["https"]},
 {port:39482,protocol:"tcp",sources:["stream:17"]},
 {port:24454,protocol:"udp",sources:["stream:18"]}
];

test("dynamic-forward generates exact per-protocol router guidance for the configured LAN destination", () => {
 const plan=buildExposurePlan("forwarded",ports,"192.168.1.50");
 assert.equal(plan.required.length,4);
 assert.match(plan.required[2].routerInstruction,/Forward TCP 39482 to 192\.168\.1\.50/);
 assert.match(plan.required[3].routerInstruction,/Forward UDP 24454 to 192\.168\.1\.50/);
 assert.equal(plan.required[2].dockerPublishing,"unverified");
 assert.equal(plan.routerForwardingVerified,false);
});
test("unknown bridge-address environment never guesses a routable destination", () => {
 const plan=buildExposurePlan("forwarded",ports);
 assert.equal(plan.routerAddress,null);
 assert.match(plan.required[2].routerInstruction,/verified NPMi Docker host LAN address/);
});
test("DMZ is instance-scoped and explicitly warns of host exposure", () => {
 const plan=buildExposurePlan("dmz",ports,"192.168.1.51");
 assert.equal(plan.model,"dmz");
 assert.match(plan.required[2].routerInstruction,/DMZ/);
 assert.ok(plan.warnings.some(line=>line.includes("shared Docker host")));
 assert.ok(plan.warnings.some(line=>line.includes("IPv6")));
});
test("unmanaged is distinct from a deferred managed firewall", () => {
 const plan=buildExposurePlan("unmanaged",ports);
 assert.equal(plan.required[0].firewallRule,"external");
 assert.match(plan.required[0].routerInstruction,/upstream hardware firewall/);
});
test("invalid model, protocol and router destination cannot produce instructions", () => {
 assert.throws(()=>buildExposurePlan("magic",ports),RangeError);
 assert.throws(()=>buildExposurePlan("forwarded",ports,"127.0.0.1; nft flush ruleset"),RangeError);
 assert.throws(()=>buildExposurePlan("forwarded",[{port:65000,protocol:"shell"}]),RangeError);
 assert.throws(()=>buildExposurePlan("forwarded",[{port:0,protocol:"tcp"}]),RangeError);
});

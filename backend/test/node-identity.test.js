import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getServingNodeHostname, isValidHostName } from "../lib/node-identity.js";

test("node identity is read from the local host's updater marker, never Docker container hostname", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "npmi-node-hostname-"));
  const markerPath = path.join(dir, "ready.json");
  const env = { NPM_HOST_PROJECT_DIR: "/opt/proxy1", HOSTNAME: "d857d9f4de65" };
  try {
    fs.writeFileSync(markerPath, JSON.stringify({
      mode: "native-host-service", project_dir: "/opt/proxy1",
      host_hostname: "proxy1", component_version: "1.6.1",
    }));
    assert.equal(getServingNodeHostname({ env, markerPath }), "proxy1");
    assert.equal(getServingNodeHostname({
      env: { ...env, NPM_HOST_PROJECT_DIR: "/opt/another" }, markerPath,
    }), null, "an updater marker from another project must not be mistaken for this node");
    assert.equal(getServingNodeHostname({
      env: { ...env, NPM_NODE_HOSTNAME: "proxy2" }, markerPath,
    }), "proxy1", "host-provisioned identity is preferred to a potentially stale env value");

    fs.writeFileSync(markerPath, "{ broken");
    assert.equal(getServingNodeHostname({ env, markerPath }), null);
    assert.equal(getServingNodeHostname({
      env: { ...env, NPM_NODE_HOSTNAME: "proxy1.example.net" }, markerPath,
    }), "proxy1.example.net");
    assert.equal(getServingNodeHostname({
      env: { ...env, NPM_NODE_HOSTNAME: "bad\nInjected" }, markerPath,
    }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("node hostname header validator rejects invalid values", () => {
  assert.equal(isValidHostName("proxy1"), true);
  assert.equal(isValidHostName("proxy1.example.net"), true);
  for (const value of ["", "bad host", "bad\r\nInjected: yes", "a".repeat(254), null, "bad..host"]) {
    assert.equal(isValidHostName(value), false);
  }
});

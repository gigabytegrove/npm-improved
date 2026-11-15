import assert from "node:assert/strict";
import { test } from "node:test";
import { assertValidIdentityRecord, hasIdentityDrift } from "../lib/npmx-update-identity.js";

const secondary = () => ({
  id: "instance-sync", value: "enabled",
  meta: { node_id: "stable-secondary", role: "secondary", primary_url: "http://proxy1:81", node_name: "proxy2", interval_seconds: 60, peers: [], last_sync: "2026-11-10T10:00:00Z" },
});

test("validates and copies a persisted node identity", () => {
  const original = secondary();
  const copy = assertValidIdentityRecord(original);
  copy.meta.role = "primary";
  assert.equal(original.meta.role, "secondary");
  assert.throws(() => assertValidIdentityRecord({ id: "instance-sync", value: "disabled", meta: {} }), /invalid/);
});

test("detects a secondary silently reset to a new primary", () => {
  const actual = secondary();
  actual.value = "disabled";
  actual.meta.role = "primary";
  actual.meta.node_id = "replacement";
  assert.equal(hasIdentityDrift(secondary(), actual), true);
  assert.equal(hasIdentityDrift(secondary(), null), true);
});

test("permits runtime sync telemetry changes without false drift", () => {
  const actual = secondary();
  actual.meta.last_sync = "2026-11-15T12:00:00Z";
  actual.meta.last_error = "";
  assert.equal(hasIdentityDrift(secondary(), actual), false);
});

test("detects primary loss of a previously paired secondary", () => {
  const primary = secondary();
  primary.meta.role = "primary";
  primary.meta.primary_url = "";
  primary.meta.node_id = "stable-primary";
  primary.meta.peers = [{ node_id: "paired-secondary" }];
  const actual = structuredClone(primary);
  actual.meta.peers = [];
  assert.equal(hasIdentityDrift(primary, actual), true);
});

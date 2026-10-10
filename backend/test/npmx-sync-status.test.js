import assert from "node:assert/strict";
import test from "node:test";
import { latestPeerCheckin, latestSuccessfulPeerSync } from "../lib/npmx-sync-status.js";

test("primary reports latest successful SECONDARY apply, not pairing/heartbeat presence", () => {
  const peers = [
    { role: "secondary", last_seen: "2026-10-10T11:00:00Z", last_sync: null },
    { role: "secondary", last_seen: "2026-10-10T11:02:00Z", last_sync: "2026-10-10T10:55:00Z" },
    { role: "secondary", last_seen: "2026-10-10T11:05:00Z", last_sync: "2026-10-10T10:58:00Z" },
    { role: "primary", last_seen: "2026-10-10T11:10:00Z", last_sync: "2026-10-10T11:10:00Z" },
  ];
  assert.equal(latestSuccessfulPeerSync(peers), "2026-10-10T10:58:00.000Z");
  assert.equal(latestPeerCheckin(peers), "2026-10-10T11:05:00.000Z");
});

test("never report a successful sync from pairing-only nodes or invalid timestamps", () => {
  const peers = [
    { role: "secondary", last_seen: "2026-10-10T11:00:00Z", last_sync: null },
    { role: "secondary", last_seen: "2026-10-10T11:05:00Z", last_sync: "invalid" },
    { role: "primary", last_sync: "2026-10-10T11:07:00Z" },
    { role: "secondary", last_sync: "2100-01-01T00:00:00Z" },
  ];
  assert.equal(latestSuccessfulPeerSync(peers), null);
  assert.equal(latestSuccessfulPeerSync([]), null);
  assert.equal(latestSuccessfulPeerSync(null), null);
  assert.equal(latestPeerCheckin(peers), "2026-10-10T11:05:00.000Z");
});

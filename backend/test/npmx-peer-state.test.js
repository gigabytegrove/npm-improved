import assert from "node:assert/strict";
import { test } from "node:test";
import { editEnrolledNpmxPeer, mergeNpmxPeerHeartbeat } from "../lib/npmx-peer-state.js";

const existing = () => [
  { node_id: "original-secondary", role: "secondary", node_name: "old", public_url: "", last_sync: "2026-11-07T10:00:00Z", last_seen: "2026-11-07T10:00:00Z" },
  { node_id: "another-secondary", role: "secondary", node_name: "another", public_url: "http://example.test:81" },
];

test("edit updates only the enrolled peer; no record is added or replaced", () => {
  const old = existing();
  const updated = editEnrolledNpmxPeer(old, "original-secondary", { nodeName: "proxy2", publicUrl: "http://192.168.0.18:81" });
  assert.equal(updated.length, 2);
  assert.equal(updated[0].node_id, "original-secondary");
  assert.equal(updated[0].node_name, "proxy2");
  assert.equal(updated[0].public_url, "http://192.168.0.18:81");
  assert.equal(updated[0].last_sync, old[0].last_sync);
  assert.deepEqual(updated[1], old[1]);
  assert.deepEqual(old, existing());
});

test("editing a nonexistent peer must not create a replacement", () => {
  assert.equal(editEnrolledNpmxPeer(existing(), "missing", { nodeName: "x", publicUrl: "" }), null);
});

test("returning secondary updates its existing record and preserves manually edited name, address and history", () => {
  const edited = editEnrolledNpmxPeer(existing(), "original-secondary", { nodeName: "proxy2", publicUrl: "http://192.168.0.18:81" });
  const updated = mergeNpmxPeerHeartbeat(edited, { node_id: "original-secondary", role: "secondary", node_name: "docker-random", public_url: "", last_seen: "2026-11-15T12:00:00Z", last_sync: null });
  assert.equal(updated.length, 2);
  assert.equal(updated[0].node_id, "original-secondary");
  assert.equal(updated[0].node_name, "proxy2");
  assert.equal(updated[0].public_url, "http://192.168.0.18:81");
  assert.equal(updated[0].last_seen, "2026-11-15T12:00:00Z");
  assert.equal(updated[0].last_sync, "2026-11-07T10:00:00Z");
});

test("offline peers remain enrolled while another peer checks in", () => {
  const updated = mergeNpmxPeerHeartbeat(existing(), { node_id: "another-secondary", role: "secondary", node_name: "another", last_seen: "2026-11-15T13:00:00Z", last_sync: null });
  assert.equal(updated.length, 2);
  assert.equal(updated[0].node_id, "original-secondary");
  assert.equal(updated[0].last_seen, "2026-11-07T10:00:00Z");
});

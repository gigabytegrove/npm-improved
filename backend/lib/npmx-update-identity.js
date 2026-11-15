/**
 * Only check durable, node-local NPMX identity during an update. Peer heartbeat
 * timestamps and last_sync legitimately advance while an update is running.
 */
const plain = (row) => typeof row?.toJSON === "function" ? row.toJSON() : row;

export const assertValidIdentityRecord = (value) => {
  const row = plain(value);
  if (
    !row || row.id !== "instance-sync" ||
    !["enabled", "disabled"].includes(row.value) ||
    !row.meta || typeof row.meta !== "object" ||
    typeof row.meta.node_id !== "string" || !row.meta.node_id ||
    !["primary", "secondary"].includes(row.meta.role)
  ) {
    throw new Error("NPMX identity checkpoint is missing or invalid");
  }
  return structuredClone(row);
};

export const hasIdentityDrift = (expectedInput, actualInput) => {
  const expected = assertValidIdentityRecord(expectedInput);
  if (!actualInput) return true;
  let actual;
  try {
    actual = assertValidIdentityRecord(actualInput);
  } catch {
    return true;
  }
  if (expected.value !== actual.value) return true;
  for (const key of ["node_id", "role", "primary_url", "public_url", "node_name", "interval_seconds"]) {
    if ((expected.meta[key] ?? null) !== (actual.meta[key] ?? null)) return true;
  }
  // The primary must not silently forget previously paired peers either.
  const expectedPeers = Array.isArray(expected.meta.peers) ? expected.meta.peers : [];
  const actualPeers = Array.isArray(actual.meta.peers) ? actual.meta.peers : [];
  return expectedPeers.some((peer) => peer.node_id && !actualPeers.some((item) => item.node_id === peer.node_id));
};

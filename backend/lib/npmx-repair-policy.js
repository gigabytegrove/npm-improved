/**
 * NPMX repair never enlists an anonymous second peer or changes proxy data.
 * Only a primary-selected, existing secondary can be recovered in place.
 */
export function findRepairPeer(peers, targetNodeId) {
  if (typeof targetNodeId !== "string" || !targetNodeId.trim() || targetNodeId.length > 100) {
    throw new Error("Select an existing NPMX secondary to repair");
  }
  const peer = Array.isArray(peers) ? peers.find((item) => item.node_id === targetNodeId) : null;
  if (!peer || peer.role !== "secondary") {
    throw new Error("The selected secondary is not enrolled on this primary; a new node record will not be created");
  }
  return peer;
}

export function assertSafeRepairJoin({ code, current, configuredSecret, restoreIdentity = false }) {
  const meta = current?.meta || {};
  const role = meta.role || "primary";
  const hasPeers = Array.isArray(meta.peers) && meta.peers.length > 0;
  const nodeId = meta.node_id || "";
  const enabled = current?.value === "enabled";
  if (hasPeers) {
    throw new Error("Refusing to convert a node that already has enrolled secondary peers");
  }
  if (code.mode === "enroll") {
    if (configuredSecret || enabled) {
      throw new Error("This node already has NPMX credentials or an active role. Use a targeted repair code for the existing peer instead");
    }
    return { nodeId, identityRestoreRequired: false, mode: "enroll" };
  }
  if (code.mode !== "repair" || !code.target_node_id) {
    throw new Error("NPMX code is not a valid targeted repair code");
  }
  if (enabled && role === "primary" && !restoreIdentity) {
    throw new Error("This node is currently an enabled primary. Explicit identity recovery confirmation is required");
  }
  if (enabled && role === "secondary" && nodeId !== code.target_node_id && !restoreIdentity) {
    throw new Error("This node is an active different secondary. Explicit identity recovery confirmation is required");
  }
  if (nodeId !== code.target_node_id && !restoreIdentity) {
    throw new Error("Targeted repair will restore the original secondary node ID; confirm identity restoration before continuing");
  }
  return {
    nodeId: code.target_node_id,
    identityRestoreRequired: nodeId !== code.target_node_id,
    mode: "repair",
  };
}

export function mergePeerHeartbeat(previous, incoming, now) {
  // Peer display/contact overrides are administrative and should not be
  // discarded on subsequent heartbeat updates.
  return {
    ...(previous || {}),
    ...incoming,
    // Administratively configured peer addresses must remain authoritative
    // for ACME preflight and all other primary-to-secondary requests.
    public_url: previous?.configured_url || incoming.public_url || previous?.public_url || "",
    reported_public_url: incoming.public_url || previous?.reported_public_url || "",
    last_sync: incoming.last_sync || previous?.last_sync || null,
    last_seen: now,
    repair_pending: incoming.repair_pending === true ? true
      : Boolean(incoming.last_sync) ? false : Boolean(previous?.repair_pending),
    ...(incoming.repair_pending === true ? { repaired_at: now } : {}),
  };
}

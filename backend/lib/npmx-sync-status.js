/**
 * NPMX is pull-based: secondaries record successful configuration applies and
 * report them to the primary through authenticated heartbeats. The primary has
 * no local pull history. Its displayed "last successful sync" must be derived
 * from known secondary peers, never confused with a pairing heartbeat.
 */
export function latestSuccessfulPeerSync(peers) {
  if (!Array.isArray(peers)) return null;
  let latest = null;
  for (const peer of peers) {
    if (!peer || peer.role !== "secondary" || typeof peer.last_sync !== "string") continue;
    const parsed = Date.parse(peer.last_sync);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > Date.now() + 60_000) continue;
    if (latest === null || parsed > latest) latest = parsed;
  }
  return latest === null ? null : new Date(latest).toISOString();
}

export function latestPeerCheckin(peers) {
  if (!Array.isArray(peers)) return null;
  let latest = null;
  for (const peer of peers) {
    if (!peer || peer.role !== "secondary" || typeof peer.last_seen !== "string") continue;
    const parsed = Date.parse(peer.last_seen);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > Date.now() + 60_000) continue;
    if (latest === null || parsed > latest) latest = parsed;
  }
  return latest === null ? null : new Date(latest).toISOString();
}

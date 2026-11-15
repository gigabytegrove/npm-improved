/** Keep enrolled identities stable while editing or checking in. */
export const editEnrolledNpmxPeer = (peers, nodeId, { nodeName, publicUrl }) => {
  const index = peers.findIndex((peer) => peer.node_id === nodeId && peer.role === "secondary");
  if (index < 0) return null;
  return peers.map((peer, position) => position === index ? {
    ...peer,
    node_name: nodeName,
    public_url: publicUrl,
    name_overridden: true,
    url_overridden: true,
  } : peer);
};

export const mergeNpmxPeerHeartbeat = (peers, heartbeat) => {
  const index = peers.findIndex((peer) => peer.node_id === heartbeat.node_id);
  if (index < 0) return [...peers, heartbeat];
  const prior = peers[index];
  return peers.map((peer, position) => position === index ? {
    ...prior,
    ...heartbeat,
    node_name: prior.name_overridden ? prior.node_name : heartbeat.node_name,
    public_url: prior.url_overridden ? prior.public_url : heartbeat.public_url,
    last_sync: heartbeat.last_sync || prior.last_sync || null,
  } : peer);
};

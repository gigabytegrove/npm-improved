import { useSyncExternalStore } from "react";

export interface BackendNodeState {
  hostname: string | null;
  previousHostname: string | null;
  switched: boolean;
}

let snapshot: BackendNodeState = {
  hostname: null,
  previousHostname: null,
  switched: false,
};
const listeners = new Set<() => void>();

const normalizeHostname = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length < 1 || value.length > 253) return null;
  return /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(value) && !value.includes("..")
    ? value : null;
};

/**
 * Called for every API response. A shared URL can be answered by different
 * NPMi nodes; show the host that most recently responded, not a cached NPMX
 * friendly name or the DNS hostname of the public load balancer.
 */
export function observeBackendNode(value: unknown): void {
  const hostname = normalizeHostname(value);
  if (hostname === snapshot.hostname) return;
  const previousHostname = snapshot.hostname;
  snapshot = {
    hostname,
    previousHostname,
    switched: Boolean(hostname && previousHostname && hostname !== previousHostname),
  };
  for (const listener of listeners) listener();
}

export function getBackendNodeSnapshot(): BackendNodeState {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBackendNode(): BackendNodeState {
  return useSyncExternalStore(subscribe, getBackendNodeSnapshot, getBackendNodeSnapshot);
}

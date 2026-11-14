import net from "node:net";
import fs from "node:fs";
import os from "node:os";

/**
 * Addresses actually visible to the NPMi network namespace. Under Docker host
 * networking these are host interface addresses; under bridge networking they
 * are container addresses. Never label a bridge address as the host's router
 * forwarding destination.
 */
export function observedInterfaceAddresses(interfaces = os.networkInterfaces()) {
  const rows = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!Array.isArray(addresses)) continue;
    for (const item of addresses) {
      if (!item || item.internal || item.family !== "IPv4" || net.isIP(item.address) !== 4) continue;
      if (item.address.startsWith("169.254.") || item.address.startsWith("127.")) continue;
      rows.push({ interface: name, address: item.address });
    }
  }
  return rows.sort((a, b) => {
    const rank = (name) => name === "eth0" ? 0 : name.startsWith("en") ? 1 : name.startsWith("wl") ? 2 : 3;
    return rank(a.interface) - rank(b.interface) || a.interface.localeCompare(b.interface) || a.address.localeCompare(b.address);
  });
}

export function primaryRouteInterface(routeTable) {
  if (typeof routeTable !== "string") return null;
  const candidates = routeTable.split(/\r?\n/).slice(1).map((line) => {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 8 || columns[1] !== "00000000" || columns[7] !== "00000000") return null;
    const flags = Number.parseInt(columns[3], 16);
    const metric = Number(columns[6]);
    if (!Number.isFinite(flags) || !(flags & 1) || !Number.isSafeInteger(metric) || metric < 0) return null;
    return { name: columns[0], metric };
  }).filter(Boolean);
  candidates.sort((a, b) => a.metric - b.metric || a.name.localeCompare(b.name));
  return candidates[0]?.name || null;
}

export function observedNetworkIdentity(interfaces = os.networkInterfaces(), routing = undefined) {
  const interfacesObserved = observedInterfaceAddresses(interfaces);
  let routeTable = routing;
  if (routeTable === undefined) {
    try { routeTable = fs.readFileSync("/proc/net/route", "utf8"); }
    catch { routeTable = ""; }
  }
  const routedInterface = primaryRouteInterface(routeTable);
  const primary = interfacesObserved.find((entry) => entry.interface === routedInterface) || interfacesObserved[0];
  return {
    instanceIp: primary?.address ?? null,
    interfaces: interfacesObserved,
    // Docker network mode cannot be proved from an unprivileged container.
    // An explicitly supplied mode is useful metadata, not a network probe.
    networkMode: ["host", "bridge"].includes(process.env.NPM_DOCKER_NETWORK_MODE)
      ? process.env.NPM_DOCKER_NETWORK_MODE : "unverified",
  };
}

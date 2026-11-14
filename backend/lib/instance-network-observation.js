import net from "node:net";
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

export function observedNetworkIdentity(interfaces = os.networkInterfaces()) {
  const interfacesObserved = observedInterfaceAddresses(interfaces);
  return {
    instanceIp: interfacesObserved[0]?.address ?? null,
    interfaces: interfacesObserved,
    // Docker network mode cannot be proved from an unprivileged container.
    // An explicitly supplied mode is useful metadata, not a network probe.
    networkMode: ["host", "bridge"].includes(process.env.NPM_DOCKER_NETWORK_MODE)
      ? process.env.NPM_DOCKER_NETWORK_MODE : "unverified",
  };
}

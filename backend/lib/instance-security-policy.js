import net from "node:net";

export const DEPLOYMENT_MODES = Object.freeze(["static", "forwarded", "dmz", "unmanaged"]);
export const DEFAULT_MANAGEMENT_NETWORKS = Object.freeze([
  "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7",
]);

export function normalizeNetwork(value) {
  if (typeof value !== "string" || !value.trim()) throw new RangeError("A management network cannot be empty.");
  const parts = value.trim().split("/");
  if (parts.length > 2 || net.isIP(parts[0]) === 0) throw new RangeError("Invalid IP/CIDR: " + value);
  const max = net.isIP(parts[0]) === 4 ? 32 : 128;
  const prefix = parts.length === 2 ? Number(parts[1]) : max;
  if (parts.length === 2 && !/^\d+$/.test(parts[1])) throw new RangeError("Invalid CIDR prefix: " + value);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) throw new RangeError("Invalid CIDR prefix: " + value);
  if (prefix === 0) throw new RangeError("Management access cannot be open to the entire internet.");
  return parts[0] + "/" + prefix;
}

export function normalizeInstanceSecurity(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new RangeError("Invalid instance security configuration.");
  const allowed = ["enabled", "mode", "state", "trustedNetworks", "trusted_networks", "hostLanIp", "host_lan_ip", "acknowledgedDmz", "acknowledged_dmz"];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new RangeError("Unexpected security setting.");
  if (!DEPLOYMENT_MODES.includes(input.mode)) throw new RangeError("Choose a valid deployment model.");
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    throw new RangeError("Firewall enabled must be a boolean.");
  }
  const enabled = input.enabled !== false;
  const state = input.state || "deferred";
  if (!["active", "deferred"].includes(state)) throw new RangeError("Invalid firewall state.");
  if (!enabled && state === "active") throw new RangeError("A disabled firewall cannot enforce a policy.");
  if (input.mode === "unmanaged" && state === "active") throw new RangeError("An external firewall is not managed by NPMi.");
  if (input.mode === "dmz" && (input.acknowledgedDmz ?? input.acknowledged_dmz) !== true) throw new RangeError("Acknowledge the router DMZ security warning.");
  const suppliedNetworks = input.trustedNetworks ?? input.trusted_networks;
  const networks = suppliedNetworks === undefined ? [...DEFAULT_MANAGEMENT_NETWORKS] : suppliedNetworks;
  if (!Array.isArray(networks) || networks.length > 128) throw new RangeError("Provide up to 128 management networks.");
  const trustedNetworks = [...new Set(networks.map(normalizeNetwork))];
  if (input.mode !== "unmanaged" && state === "active" && !trustedNetworks.length) {
    throw new RangeError("At least one management network is required before activation.");
  }
  const suppliedHostIp = input.hostLanIp ?? input.host_lan_ip ?? "";
  if (typeof suppliedHostIp !== "string") throw new RangeError("Docker host LAN address must be an IP address.");
  const hostLanIp = suppliedHostIp.trim();
  if (hostLanIp && net.isIP(hostLanIp) === 0) {
    throw new RangeError("Docker host LAN address must be an IP address.");
  }
  return {
    configured: true,
    enabled,
    mode: input.mode,
    state,
    trustedNetworks,
    hostLanIp,
    acknowledgedDmz: input.mode === "dmz",
  };
}

export function compileInstancePorts(streams, managementPort = 81) {
  if (!Array.isArray(streams)) throw new TypeError("Streams must be an array.");
  const map = new Map();
  const put = (port, protocol, source) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError("Invalid incoming service port.");
    const key = protocol + ":" + port;
    const row = map.get(key) || { port, protocol, sources: [] };
    if (!row.sources.includes(source)) row.sources.push(source);
    map.set(key, row);
  };
  put(80, "tcp", "http");
  put(443, "tcp", "https");
  for (const row of streams) {
    if (!row.enabled || row.is_deleted) continue;
    const port = Number(row.incoming_port);
    if (port === Number(managementPort)) throw new RangeError("Stream conflicts with the NPMi management port.");
    if (row.tcp_forwarding) put(port, "tcp", "stream:" + row.id);
    if (row.udp_forwarding) put(port, "udp", "stream:" + row.id);
  }
  return [...map.values()].sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol));
}

export function buildInstancePolicy(config, streams, managementPort = 81) {
  const ports = compileInstancePorts(streams, managementPort);
  return {
    schemaVersion: 1,
    mode: config.mode,
    state: config.enabled === false ? "deferred" : config.state,
    managementPort,
    managementNetworks: config.trustedNetworks,
    confirmBy: config.pendingActivation?.deadline || "",
    ports: ports.map(({ port, protocol }) => ({ port, protocol })),
  };
}

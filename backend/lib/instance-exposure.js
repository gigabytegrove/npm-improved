import net from "node:net";

/**
 * Instance-level exposure guidance, not an assertion of router or Docker state.
 * No Docker host address is guessed from a container bridge address.
 */
export function buildExposurePlan(mode, ports, hostLanIp = "") {
  const supported = ["static", "forwarded", "dmz", "unmanaged"];
  if (!supported.includes(mode)) throw new RangeError("Invalid NPMi deployment model");
  if (!Array.isArray(ports)) throw new TypeError("Port inventory must be an array");
  const address = typeof hostLanIp === "string" ? hostLanIp.trim() : "";
  if (address && net.isIP(address) === 0) throw new RangeError("Router destination must be an IP address");
  const instructions = ports.map(({port, protocol, sources}) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !["tcp", "udp"].includes(protocol)) {
      throw new RangeError("Invalid inbound service port");
    }
    const standard = protocol === "tcp" && (port === 80 || port === 443);
    return {
      port, protocol,
      sources: Array.isArray(sources) ? sources : [],
      firewallRule: mode === "unmanaged" ? "external" : "instance-managed",
      dockerPublishing: "unverified",
      routerForwarding: "unverified",
      dockerInstruction: standard
        ? "Default NPMi Compose publishes this port. Verify the running Docker configuration."
        : "Publish " + protocol.toUpperCase() + " " + port +
          " to the NPMi container, or use an independently routable container LAN address.",
      routerInstruction: mode === "forwarded"
        ? "Forward " + protocol.toUpperCase() + " " + port +
          " to " + (address || "your verified NPMi Docker host LAN address") + "."
        : mode === "dmz"
          ? "Verify your router DMZ points to the dedicated NPMi destination" +
            (address ? " (" + address + ")" : "") +
            "; a DMZ does not publish Docker container ports."
          : mode === "unmanaged"
            ? "Check the upstream hardware firewall's inbound " + protocol.toUpperCase() +
              " " + port + " policy."
            : "Verify that " + protocol.toUpperCase() + " " + port +
              " is routed to the NPMi destination at the fixed address.",
    };
  });
  return {
    model: mode,
    routerAddress: address || null,
    dockerPublishingVerified: false,
    routerForwardingVerified: false,
    required: instructions,
    warnings: [
      "Firewall permission, Docker port publication, and router reachability are independent.",
      "A container bridge address is not automatically a router-accessible destination.",
      ...(mode === "dmz" ? [
        "DMZ to a shared Docker host also exposes the host and potentially other containers. NPMi cannot filter those services.",
        "IPv4 DMZ configuration does not guarantee equivalent IPv6 filtering.",
      ] : []),
    ],
  };
}

# NPMi instance firewall agent

This is a least-privilege Docker companion. It shares only the NPMi app's
network namespace (Compose network_mode: service:app), and holds CAP_NET_ADMIN
there. It has no Docker socket, host network, or host filesystem access.
It manages only its own nftables table, inet npmi_instance.

It **does not** enforce an upstream router firewall, restrict other Docker
containers, change Docker published ports, or manage host INPUT/FORWARD chains.
This is the intended boundary: the entire NPMi container, not the host.

The NPMi API writes a validated, instance-wide
/data/instance-security/firewall/policy.json. The agent validates the policy again,
checks the nft transaction before applying, and reports actual state in
status.json. It never executes arbitrary shell commands.

The rules allow loopback, established connections, ICMP/ICMPv6, management
traffic from configured source CIDRs, HTTP/HTTPS, and enabled stream TCP/UDP
ports. Everything else initiating a connection to this namespace is dropped.
Site-specific HTTP ACLs continue to be enforced by Nginx, where multiple
sites may share the same listener.

No inbound filtering is enabled by default. An administrator chooses one of
four instance deployment models at setup. Managed-mode activation requires
an additional authenticated action after the operator reviews access.

For custom streams in a bridge network, Docker port publishing and upstream
router configuration are still required. The UI must never report ports as
internet-reachable merely because a firewall permission is present.

The companion receives **only** `./data/instance-security/firewall:/policy`.
The separate DDNS key and encrypted records stay in the parent directory,
which is not mounted into the firewall service. The policy directory is
traversable, the policy file is world-readable inside the namespace (it
contains no secrets), and the status file is readable by the non-root
NPMi backend. The s6 startup process normalizes ownership safely.

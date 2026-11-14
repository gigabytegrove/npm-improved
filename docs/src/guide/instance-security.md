# Instance Security and Docker firewall

NPMi supports four **instance-level** deployment models. This feature is not
a per-host, per-stream, or per-DNS-record firewall. Individual enabled streams
contribute their incoming port and protocol to a single instance-wide
policy; Nginx HTTP access lists continue to act at the application layer.

| Model | Filtering | Router/network configuration |
| --- | --- | --- |
| Static IP | NPMi-managed | Administrator provides fixed network routing |
| Dynamic IP — Forwarded | NPMi-managed | Forward 80/443 and any new service ports manually |
| Dynamic IP — DMZ | NPMi-managed | Router sends unsolicited traffic to NPMi's destination |
| Unmanaged | External firewall | NPMi retains threat monitoring and HTTP protections |

The default is **not configured / deferred**. Firewall management is not
activated silently by installation or by a software update. Initial setup
records the selected model; an authenticated administrator reviews management
network access and explicitly activates enforcement in **Instance Security**.

**Do not treat DMZ as universally recommended.** Selective port forwarding is
safer. Router DMZ may forward unsolicited connections to the Docker host's
LAN IP. NPMi cannot configure the upstream router or its public IP firewall,
cannot protect the Docker host or other containers, and cannot guarantee
that inbound IPv6 follows the router's IPv4 DMZ behavior.

## What is filtered?

The firewall companion is an additional Docker container sharing the **app's
network namespace**, with NET_ADMIN capability only in that namespace. It has
no host networking and no Docker socket. It uses nftables to control traffic
to the NPMi instance, never host INPUT/FORWARD or Docker-owned chains.

When activated, unsolicited inbound connections to the NPMi app network
namespace are denied except for:

- Loopback and established/related connections.
- ICMP/ICMPv6 needed for network operation.
- Container TCP 80 and TCP 443.
- The configured NPMi management TCP port, **only** from approved source CIDRs.
- Enabled Nginx stream TCP and UDP incoming ports, derived automatically.

Disabling or deleting a stream removes its contribution when no other
active stream needs that port. HTTP access lists cannot be blindly translated
to nftables because independent websites share ports 80 and 443. Nginx still
enforces those per-site restrictions.

## Docker and router exposure are separate

**An nftables ACCEPT rule does not publish a Docker port.** The default
Compose application publishes 80, 81, and 443. To expose a custom stream,
its protocol/port must also be published in Docker and, with conventional
router forwarding, forwarded to the Docker host's LAN address. Docker port
publication may require recreating the application container.

NPMi's bridge-network interface address is not the Docker host's LAN IP.
If NPMi cannot verify the Docker host's address, enter it in the Instance
Security screen. Never mistake the displayed container address for the
destination used by your router.

The UI reports Docker publication as **unverified** until an independent
deployment integration can prove it. A permitted port is not automatically
an internet-reachable port.

## Activation and recovery

Keep an independent route to administer the Docker host or external firewall
before activating a restrictive instance policy. Specify the management
source CIDRs accurately. After saving, verify that **Current protection**
reports the companion and its matching policy digest as active. "Needs
attention" is not equivalent to active protection.

Only authorized NPMi administrators can configure or reconcile this policy.
NPMX configuration synchronization does not alter the firewall on another
physical node; configure each Docker instance independently. Unmanaged is
a distinct external-firewall deployment model, not a managed firewall
"off" switch. A managed model can be **deferred**, explicitly leaving
network filtering unenforced and showing the risk.

The companion is built/deployed by Compose, not bundled inside the normal
application image. Bare docker-run deployments cannot activate managed
filtering without the companion and its shared network namespace.

## Docker source-address caveat

Docker's NAT and optional userland proxy may cause incoming traffic to arrive
in the container with a gateway address rather than the original internet
source. Do not assume source CIDR conditions in the container reliably
protect publicly published management port 81. Protect the management
listener at the router/host firewall, and ideally do not forward port 81
at all. The companion reports whether its instance rules were installed,
not whether a particular remote client can bypass router restrictions.

## Confirmation rollback and monitoring

Activating managed filtering starts a 120-second confirmation window. The
nftables companion automatically releases the temporary policy if the
administrator does not confirm it in the UI, even if the NPMi backend stops
responding. The backend also restores the previous policy after the deadline;
if the previous policy was already active, it reinstates that known state.
Policy status and the current policy digest must match before confirmation.

The companion records dropped packet and byte counters for the active policy.
Counters reset when the policy changes; they are not a count of distinct
attackers or blocked connections. These counters apply only to NPMi's network
namespace and do not include traffic dropped by upstream firewalls.

## Filesystem boundary

The companion only mounts `./data/instance-security/firewall` and cannot
read the separate encrypted Dynamic DNS records or encryption key in the
parent `instance-security` directory. The parent remains mode `0700` owned
by the NPMi runtime user; the firewall subdirectory is `0755`, and its
policy and status files are readable by the non-root backend and companion.

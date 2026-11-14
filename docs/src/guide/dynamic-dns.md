# Dynamic DNS

**Networking → Dynamic DNS** can update the public A or AAAA record for an
internet connection whose address changes. Each configured record is checked
every five minutes, using a consensus of at least two HTTPS public-IP
detectors. NPMi avoids redundant updates and refreshes successfully updated
records at least once per day. A manual check can be requested, subject to
a one-minute rate limit.

Supported providers in this integration:

| Provider | Credentials needed |
| --- | --- |
| Cloudflare | Scoped DNS Write API token, Zone ID, DNS Record ID |
| DuckDNS | Domain and its update token |
| No-IP | DDNS Key username and password |
| Dynu | IP-update username and password |
| Hurricane Electric | Dynamic record hostname and generated update key |
| deSEC / dedyn.io | Dedicated update token |
| DigitalOcean | Scoped DNS API token, DNS zone name, existing numeric record ID |
| Namecheap | Dynamic DNS domain password, domain name (IPv4 A only) |

Provider destinations are fixed and use HTTPS. There is no arbitrary
administrator-supplied update URL or shell-command path. The UI never returns
a stored secret. Per-record credentials are encrypted with AES-256-GCM using
a locally generated key under /data/instance-security/ddns.key; protect
and back up this key together with your data. Losing it prevents using the
stored encrypted credentials. The key and encrypted records reside on the
same deployment and cannot protect against a full host compromise.

Each record shows last checked time, last successful public IP, last update
time, and a sanitized error state. An external provider may impose rate
limits, account restrictions, paid plan requirements, or record-type
limitations. Some providers' dynamic update protocols may also update the
other address family when changing AAAA, so review provider behavior.

Dynamic DNS only changes DNS data. It **cannot** configure your router,
automatically publish Docker ports, fix ISP CGNAT, or grant internet access
where the ISP blocks inbound connections. Check the router's actual WAN
address to distinguish CGNAT from ordinary dynamic public addressing.

Address family separation: deSEC updates use the provider's `myipv4` /
`myipv6` parameters and preserve the other family; Dynu updates explicitly
set the other family to `no`. DuckDNS updates supply the correct IPv4/IPv6
address in its `ip` field. These behaviors follow each provider's documented
update protocol.

Dynamic DNS public IP discovery contacts independent third-party HTTPS
services (ipify, Amazon CheckIP, icanhazip / ident.me). Those services can
observe the current public IP and update request. They receive no stored
DNS provider credentials.

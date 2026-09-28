---
outline: deep
---

# Instance Synchronization and NPMX

NPM Improved can synchronize two or more instances so multiple Nginx nodes carry the same proxy configuration, certificates, and required local assets.

The synchronization model remains **one authoritative primary with one or more read-only secondaries**. This deliberately avoids automatic multi-writer behavior and split-brain configuration changes.

NPM Improved Exchange (**NPMX**) is the node-to-node exchange protocol used by Instance Synchronization.

## Why NPMX exists

Instance synchronization is more than copying database rows.

A working proxy node may also depend on:

- certificate files;
- Let's Encrypt state;
- custom Nginx files;
- custom SSL assets;
- Default Site templates;
- generated Nginx configuration;
- node identity and version compatibility.

NPMX gives NPM Improved nodes a defined protocol for secure pairing, capability negotiation, snapshot exchange, and heartbeat/status reporting.

## Easy secure pairing

Administrators do not create or copy cluster secrets manually.

On the primary:

1. Open **Settings → Instance Synchronization**.
2. Choose **Primary** and give the node a useful name.
3. Set or confirm the URL other NPM Improved nodes can use to reach it.
4. Select **Create pairing code**.

NPM Improved automatically creates the cluster credential when needed and returns a **one-time NPMX pairing code**.

The pairing code:

- expires after 10 minutes;
- can be used only once;
- includes a random one-time pairing token;
- does not expose the persistent cluster credential;
- is intended to be copied only to the secondary being added.

On the secondary:

1. Install the same NPM Improved application version.
2. Open **Settings → Instance Synchronization**.
3. Choose **Secondary**.
4. Paste the NPMX pairing code.
5. Select **Pair & join**.

The primary URL, persistent cluster authentication material, and secondary relationship are established automatically.

## Pairing cryptography

NPMX v1 pairing uses:

- cryptographically random one-time pairing tokens;
- an ephemeral X25519 key exchange;
- HKDF-SHA256 key derivation;
- AES-256-GCM to transfer the persistent cluster credential;
- HMAC-SHA256 proofs that bind the pairing token to the ephemeral exchange;
- short pairing-token expiry;
- single-use pairing state.

The persistent cluster secret remains stored locally in:

```text
/data/cluster-secret
```

with restrictive file permissions. It is not displayed in the normal UI.

HTTPS is still recommended for node-to-node traffic. NPMX protects its own authentication and snapshot payload, but TLS also protects metadata and provides the normal transport-level privacy expected for management traffic.

## Normal NPMX request authentication

After pairing, NPMX does not send the persistent cluster secret as an HTTP authentication header.

Every NPMX request is signed with HMAC-SHA256 and includes:

- NPMX protocol version;
- sending node ID;
- timestamp;
- random nonce;
- request method and path;
- canonical request-body digest;
- request signature.

The receiver rejects stale timestamps, reused nonces, invalid signatures, and unsupported NPMX protocol versions.

## Capability negotiation

Before a secondary accepts a snapshot, it asks the primary for its NPMX status and capabilities.

NPMX v1 currently negotiates capabilities including:

- configuration synchronization;
- certificate synchronization;
- custom Nginx assets;
- filesystem assets;
- Default Site templates;
- node-local template rendering;
- heartbeat/status exchange;
- snapshot format support.

A secondary refuses a full snapshot when the protocol/capability combination cannot satisfy the required synchronization contract.

NPM Improved currently also requires an exact application-version match before a secondary applies a cluster snapshot. This prevents a database/schema mismatch from being silently copied between unlike application versions.

## What is synchronized

An NPMX cluster snapshot includes the operational state another node needs to serve the same proxy configuration:

- Proxy Hosts, including HA upstream pools;
- Redirection Hosts and 404 Hosts;
- Streams;
- Access Lists and their credentials/rules;
- certificates and certificate records;
- Let's Encrypt state and certificate material;
- custom SSL files;
- users, permissions, authentication, and 2FA state;
- normal NPM Improved settings;
- configuration history;
- custom Nginx files;
- Default Site **templates**.

The following stay local to each node:

- the node's NPMX / Instance Synchronization identity and role;
- its persistent cluster-secret file;
- its one-time pairing state;
- its JWT signing keys;
- its native recovery credential;
- its audit log;
- rendered Default Site output.

That last item is intentional: NPMX synchronizes the Default Site template, then every node renders the template locally so variables such as `{{node.hostname}}` and `{{node.name}}` identify the node that actually answered the request.

## Default Site cluster variables

Custom Default Site HTML and redirect destinations may use NPM Improved template variables.

Examples include:

```text
{{node.hostname}}
{{node.name}}
{{node.id}}
{{node.role}}
{{node.public_url}}
{{node.version}}
{{node.build_commit}}
{{node.build_date}}
{{cluster.enabled}}
{{cluster.protocol}}
{{cluster.protocol_version}}
{{system.platform}}
{{system.arch}}
{{system.generated_at}}
```

For example:

```html
<h1>Default Site</h1>
<p>Answered by {{node.name}} ({{node.hostname}})</p>
<p>{{node.role}} · NPM Improved {{node.version}} · {{cluster.protocol}}/{{cluster.protocol_version}}</p>
```

NPMX copies that template unchanged. Primary and secondary nodes render different local values from the same source template.

## Transactional synchronization

A secondary does not simply overwrite its live configuration.

For every synchronization it:

1. authenticates and negotiates NPMX protocol/capabilities;
2. downloads the encrypted primary snapshot;
3. captures its current database and filesystem state for rollback;
4. replaces the synchronized database scope;
5. restores synchronized configuration/certificate assets;
6. renders node-local Default Site output from the synchronized template;
7. regenerates Nginx configuration;
8. runs `nginx -t`;
9. reloads Nginx only after validation succeeds;
10. rolls the database and filesystem back if validation/reload fails.

After success, the secondary sends a signed NPMX heartbeat to the primary.

## Read-only secondaries

While a node is an enabled secondary, synchronized configuration is read-only there. Mutating host, stream, certificate, user, settings, disaster-recovery, and configuration-history operations are rejected.

This is intentional. Allowing independent writes on multiple nodes without a distributed consensus system would create split-brain state.

## Proxy traffic and multiple points of contact

Synchronization does **not** force clients to use a particular proxy node. Every synchronized node runs its own Nginx data plane and can accept HTTP/HTTPS traffic independently.

To make multiple nodes actual entry points, publish more than one node through infrastructure appropriate to your network, for example:

- multiple DNS A/AAAA records;
- a load balancer in front of the NPM Improved nodes;
- a floating/virtual IP managed by external HA tooling;
- separate site-local addresses in a multi-site design.

NPM Improved keeps proxy state synchronized; DNS, load balancing, or virtual-IP tooling determines which available node receives a request.

## Failover promotion

If the primary is unavailable:

1. confirm the old primary is offline or otherwise fenced from making changes;
2. open **Settings → Instance Synchronization** on a current secondary;
3. choose **Promote this node**;
4. update DNS/load-balancer/virtual-IP control paths as needed.

Promotion makes that node authoritative and enables configuration writes.

Do not leave two writable primaries active. NPM Improved cannot safely reconcile two independently modified primary databases.

## Shared MySQL

Shared MySQL remains a separate multi-node architecture.

When nodes use one shared MySQL database, Primary/Secondary Instance Synchronization is disabled because the database state is already common to all participating nodes. Filesystem/certificate coordination for Shared MySQL remains a distinct deployment responsibility.

## Combined HA example

A practical redundant deployment can use:

- NPMi-1 as NPMX primary;
- NPMi-2 as synchronized NPMX secondary;
- DNS/load balancing that sends clients to both proxy nodes;
- a Default Site template that prints `{{node.hostname}}` for troubleshooting;
- each Proxy Host configured with App-1, App-2, and App-3 in an upstream pool.

That protects against both a proxy-node failure and an application-backend failure while making it easy to identify which proxy node served an unmatched hostname.

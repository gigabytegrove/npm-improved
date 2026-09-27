---
outline: deep
---

# Instance Synchronization

NPM Improved can synchronize two or more instances so multiple Nginx nodes carry the same proxy configuration and certificate material.

The synchronization model is **one authoritative primary with one or more read-only secondaries**. This deliberately avoids automatic multi-writer behavior and split-brain configuration changes.

## What is synchronized

A cluster snapshot includes the operational state required for another NPM Improved node to serve the same configuration:

- Proxy Hosts, including HA upstream pools;
- Redirection Hosts and 404 Hosts;
- Streams;
- Access Lists and their credentials/rules;
- certificates and certificate records;
- Let's Encrypt state and certificate material;
- users, permissions, authentication, and 2FA state;
- normal NPM Improved settings;
- configuration history;
- custom Nginx and default-site files.

The following stay local to each node:

- the node's **Instance Synchronization** identity and role;
- its cluster secret file;
- its JWT signing keys;
- its native recovery credential;
- its audit log.

Keeping the cluster identity local prevents a synchronized snapshot from turning every node into a copy of the primary's cluster identity.

## Encryption and authentication

The cluster secret is stored locally at:

```text
/data/cluster-secret
```

It is written with mode `0600` and is never returned by the management API after it is saved.

Configuration snapshots use NPM Improved's encrypted backup envelope: AES-256-GCM with a key derived from the cluster secret using scrypt. The same secret also authenticates node-to-node cluster requests.

Use HTTPS for synchronization across any network you do not completely trust. The encrypted snapshot protects snapshot contents, but the cluster authentication header must also be protected in transit.

## Configure the primary

On the authoritative instance:

1. Open **Settings → Instance Synchronization**.
2. Enable synchronization.
3. Choose **Primary**.
4. Give the node a unique name.
5. Set its reachable public/internal URL when useful for operators.
6. Set a strong cluster secret of at least 24 characters.
7. Save.

Only one primary should be active for a cluster.

## Add a secondary

On each additional NPM Improved instance:

1. Install the **same NPM Improved version** as the primary.
2. Open **Settings → Instance Synchronization**.
3. Choose **Secondary**.
4. Enter the primary's management URL.
5. Enter the exact same cluster secret.
6. Choose the synchronization interval.
7. Enable synchronization and save.
8. Use **Sync now** for the first pull or wait for the scheduler.

NPM Improved requires an exact version match before a secondary accepts a primary snapshot. This prevents a database/schema mismatch from being silently replicated.

## Transactional synchronization

A secondary does not simply overwrite its live configuration.

For every synchronization it:

1. downloads and authenticates the encrypted primary snapshot;
2. captures its current database and filesystem state for rollback;
3. replaces the synchronized database scope;
4. restores synchronized configuration/certificate files;
5. regenerates Nginx configuration;
6. runs `nginx -t`;
7. reloads Nginx only after validation succeeds;
8. rolls the database and filesystem back if validation/reload fails.

After success, the secondary reports a heartbeat to the primary. The primary's synchronization page lists secondary nodes that have checked in.

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

NPM Improved keeps the proxy configuration consistent; DNS, a load balancer, or a virtual-IP mechanism determines how clients reach the available nodes.

## Failover promotion

If the primary is unavailable:

1. confirm the old primary is offline or otherwise fenced from making changes;
2. open **Settings → Instance Synchronization** on a current secondary;
3. choose **Promote this node**;
4. update your DNS/load-balancer/virtual-IP control path as needed.

Promotion makes that node authoritative and enables configuration writes.

Do not leave two writable primaries active. NPM Improved intentionally warns before promotion because it cannot safely reconcile two independently modified primary databases.

## Combined HA example

A practical redundant deployment can use:

- NPMi-1 as primary;
- NPMi-2 as synchronized secondary;
- DNS/load balancing that sends clients to both proxy nodes;
- each Proxy Host configured with App-1, App-2, and App-3 in an upstream pool.

That protects against both a proxy-node failure and an application-backend failure without making either layer depend on the other.

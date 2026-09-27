---
outline: deep
---

# Database & Cluster

NPM Improved can start small with SQLite and later move to MySQL or MariaDB without rebuilding your proxy configuration by hand.

The migration controls live under **Settings → Database & Cluster**.

The same page also provides **Shared MySQL** mode for people who want two or more NPM Improved servers to use one common database.

## Which database should I use?

### SQLite

SQLite is the simplest option.

Use it when:

- you have one NPM Improved server;
- you want the fewest moving parts;
- you do not need several NPMi nodes to use one live database.

The default file is:

```text
/data/database.sqlite
```

SQLite is a local file. It should not be placed on a network share and opened by several NPM Improved servers at the same time.

### MySQL / MariaDB

Use MySQL or MariaDB when:

- the database should run separately from the proxy server;
- you want to move the database to dedicated storage;
- you want several NPM Improved nodes to use one shared source of truth;
- you already operate MySQL/MariaDB and prefer to manage database backups separately.

NPM Improved supports database TLS from the UI. Use TLS when the database traffic crosses a network you do not fully trust.

## Moving from SQLite to MySQL

1. Create an empty MySQL/MariaDB database and a user that can create and modify tables.
2. Open **Settings → Database & Cluster**.
3. Choose **MySQL / MariaDB**.
4. Enter the database server, port, database name, user, and password.
5. Enable TLS if appropriate.
6. Choose **Move this server's current NPMi data to the selected database**.
7. Select **Test database connection**.
8. Review the connection result.
9. Type **MIGRATE**.
10. Select **Migrate and switch database**.

NPM Improved does not change the active database first.

It creates/updates the destination schema, copies the current NPMi application records, verifies the copied row counts, and only then writes the new local database selection.

The backend restarts automatically after a successful switch. The independent control plane and Nginx do not need to be stopped for the database choice to be saved.

The original SQLite database is left in place. NPM Improved does not delete the source automatically.

## Moving from MySQL back to SQLite

The same wizard works in the other direction.

1. Open **Settings → Database & Cluster**.
2. Choose **SQLite**.
3. Choose an absolute database-file path.
4. Test the target.
5. Choose **Move this server's current NPMi data to the selected database**.
6. Type **MIGRATE**.
7. Start the migration.

NPM Improved builds a temporary SQLite database first and verifies the copy before switching.

If the requested destination file already exists, NPM Improved keeps that previous file by renaming it with a timestamp before the verified new file takes its place.

The source MySQL database is not deleted.

## Changing databases again later

Database choice is not a one-time installer decision.

The active UI-managed selection is stored locally at:

```text
/data/database-config.json
```

The file is written with restricted permissions and may contain the MySQL password.

Treat it as a deployment secret.

A UI-managed database selection takes precedence over database environment variables on later backend starts. This allows a server originally installed with SQLite or a Compose MySQL configuration to move databases without replacing its entire container configuration.

## Shared MySQL

Shared MySQL lets multiple NPM Improved servers connect to the **same MySQL/MariaDB database**.

This is different from snapshot-based Instance Synchronization.

With Shared MySQL:

- hosts, users, access lists, settings, certificates, audit/configuration records, and other database-backed state are read from the same live database;
- every NPMi node still runs its own Nginx process;
- one node is the **Primary** and accepts configuration changes;
- Secondary nodes are read-only for synchronized configuration;
- certificate files, Let's Encrypt state, custom Nginx files, Default Site files, and the JWT signing identity are mirrored through the shared database;
- Secondary nodes rebuild and validate their own local Nginx configuration when the shared revision changes.

This means an NPMi node can continue serving proxy traffic using its own local Nginx process while all nodes use the same management data.

## Creating the first Shared MySQL node

On the NPM Improved server that already contains your desired configuration:

1. Open **Settings → Database & Cluster**.
2. Choose **MySQL / MariaDB**.
3. Enter the database connection.
4. Enable **Use this MySQL database with multiple NPM Improved servers**.
5. Give the server a recognizable node name.
6. Choose **Primary**.
7. Choose **Move this server's current NPMi data to the selected database**.
8. Test the connection.
9. Type **MIGRATE**.
10. Complete the migration.

After restart, the node claims the Shared MySQL Primary lease and publishes the filesystem state needed by other nodes.

## Adding another NPM Improved server

Install the **same NPM Improved version** on the additional server first.

Then:

1. Open **Settings → Database & Cluster**.
2. Enter the same MySQL/MariaDB connection.
3. Enable **Use this MySQL database with multiple NPM Improved servers**.
4. Give this server its own unique node name.
5. Choose **Secondary**.
6. Choose **Join an existing NPM Improved shared database without replacing its data**.
7. Test the database.
8. Confirm that NPM Improved detects an existing, current schema.
9. Type **CONNECT**.
10. Choose **Join shared database**.

Join mode does **not** copy the new server's old SQLite data into the shared database.

The shared database remains authoritative. The Secondary adopts it, downloads the shared filesystem state, regenerates Nginx, validates the result, and then becomes a read-only failover node.

## Why there is one Primary

Allowing several web interfaces to update one proxy configuration at the same time creates race conditions.

Shared MySQL therefore uses a single-writer model:

```text
             ┌─ NPMi Primary ────── writes configuration
Shared MySQL ┤
             ├─ NPMi Secondary ──── reads + serves traffic
             └─ NPMi Secondary ──── reads + serves traffic
```

A short database-backed Primary lease is refreshed while the Primary is healthy.

Secondary nodes reject normal configuration writes.

This does not stop Secondary Nginx processes from serving proxy traffic.

## Failover

If the Primary NPM Improved node fails, a Secondary can be promoted from **Settings → Database & Cluster**.

Normally, promotion succeeds after the previous Primary lease has expired.

If you deliberately need to override a still-active lease, the UI requires typing:

```text
PROMOTE
```

before forcing promotion.

Only do this when the old Primary is actually offline, isolated, or intentionally demoted. Forcing two live Primaries can create conflicting operations.

## What gets shared

Shared MySQL contains normal NPM Improved application data plus the cluster metadata required to keep nodes aligned.

The Primary also publishes these local files through the shared database:

- custom TLS certificate files;
- Let's Encrypt certificate/state files;
- custom Nginx configuration;
- custom Default Site files;
- the JWT signing keys used by the management API.

Sharing the JWT signing identity means a login token can remain valid when a management load balancer sends requests to another NPMi node.

The local file:

```text
/data/shared-database-node.json
```

is **not** shared. It preserves that machine's own node ID, name, role, and applied revision.

## Sensitive data in Shared MySQL

Shared MySQL contains security-sensitive material.

Because certificate and JWT files are copied through the database, anyone with unrestricted access to the NPM Improved database may be able to access private certificate material or authentication-signing keys.

Protect the database accordingly:

- use a dedicated NPMi database account;
- restrict network access to the database;
- use TLS when appropriate;
- secure database backups;
- protect database administrator credentials;
- do not expose MySQL/MariaDB directly to the public Internet.

## Shared MySQL is not MySQL high availability

Several NPMi servers using one MySQL server removes the NPMi application database from each individual proxy node, but the database service can still become a single point of failure.

For full database-level availability, use a MySQL/MariaDB deployment that provides its own redundancy, failover, or managed high-availability service.

NPM Improved does not attempt to build or manage a MySQL replication cluster for you.

## Shared MySQL versus Instance Synchronization

NPM Improved supports two multi-node approaches.

| | Shared MySQL | Instance Synchronization |
| --- | --- | --- |
| Database | Same live MySQL/MariaDB DB | Separate database on every node |
| Updates | Primary writes common DB | Secondary periodically downloads encrypted snapshot |
| Secondary config writes | Read-only | Read-only |
| Files/certificates | Mirrored through shared DB | Included in encrypted sync snapshot |
| Best fit | Central DB / several active proxy nodes | Independent nodes / sites with separate storage |
| Database dependency | Shared | Independent per node |

When Shared MySQL is active, the older snapshot-based Instance Synchronization controls are disabled for that node to avoid running two synchronization systems at once.

## Migration safety

Database migration intentionally avoids deleting the source.

For a normal move, NPM Improved:

1. tests the destination;
2. creates or upgrades the destination NPMi schema;
3. copies the logical NPMi records;
4. verifies table row counts;
5. saves the new local database selection only after verification succeeds;
6. restarts the backend.

If migration fails before the switch, the active source remains selected.

As with any important infrastructure change, keep a current encrypted NPM Improved backup and a storage/database backup before migration.

## PostgreSQL

NPM Improved still retains the existing PostgreSQL deployment support for users who configure it through the deployment environment/Compose stack.

The **Database & Cluster** migration wizard currently focuses on SQLite and MySQL/MariaDB because Shared Database mode is implemented for MySQL/MariaDB.

PostgreSQL is not currently a Shared Database wizard target.

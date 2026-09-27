---
outline: deep
---

# Database & Storage

NPM Improved can run on a local SQLite database or on MySQL/MariaDB.

You can change the active database from **Settings → Database & Storage** without rebuilding the application around a different Compose file.

The database wizard supports three common jobs:

- move an existing SQLite installation to MySQL/MariaDB;
- join an existing shared NPM Improved MySQL database from another server;
- move an installation from MySQL/MariaDB back to SQLite.

## Which database should I use?

### SQLite

SQLite is a good fit for:

- one NPM Improved server;
- home labs and small deployments;
- simple backups;
- installations where a separate database server would add unnecessary complexity.

The default SQLite file is:

```text
/data/database.sqlite
```

SQLite should be treated as a **single NPM Improved server database**.

Do not place one SQLite file on shared network storage and open it from several NPM Improved servers as a substitute for MySQL.

### MySQL / MariaDB

MySQL/MariaDB is a better fit when:

- the database should live independently of the NPM Improved container;
- you already operate a database service;
- you want several NPM Improved servers to use the same configuration database;
- you want database backup/replication to be handled by your database platform.

NPM Improved supports both a normal single-node MySQL connection and **Shared MySQL mode**.

## Moving SQLite to MySQL

Open:

**Settings → Database & Storage**

Choose **Move this installation to MySQL**.

Enter:

- MySQL/MariaDB hostname or IP;
- port, normally `3306`;
- database name;
- database user;
- database password;
- TLS/SSL preference.

Use **Test connection** first.

NPM Improved reports whether it can reach the database and whether NPM Improved data already exists there.

When you choose **Copy, verify & switch database**, NPM Improved:

1. leaves the current database untouched;
2. connects to the destination;
3. brings the destination schema up to the current NPM Improved version;
4. takes a consistent logical snapshot of the current database;
5. copies the application tables to the destination;
6. verifies row counts after the copy;
7. saves the new database choice under `/data/database-config.json`;
8. restarts the backend;
9. reconnects using the new database.

If the copy fails, NPM Improved does not switch away from the current database.

The original database is not automatically deleted. Keep it until you have verified the new deployment.

## Moving back to SQLite

Choose **Move back to SQLite** in the same wizard.

NPM Improved copies the active database into an SQLite file under `/data`, verifies the copy, saves the new database selection, and restarts the backend.

This lets you move in either direction instead of treating the SQLite-to-MySQL choice as permanent.

## Joining an existing shared MySQL database

Use **Join an existing shared MySQL database** when another NPM Improved server already uses that database.

Join mode is different from migration mode:

- it does **not** erase the destination;
- it verifies that an NPM Improved schema and data already exist;
- it verifies shared-cluster version information when available;
- it stores the connection locally;
- it restarts this NPM Improved backend against the shared database.

Use the same NPM Improved version on every node sharing the database.

## Shared MySQL mode

Shared MySQL mode lets several NPM Improved servers use one MySQL/MariaDB database.

This makes database configuration immediately common between the nodes.

NPM Improved adds several pieces of coordination so this is more than simply pointing multiple containers at the same SQL server.

### Local Nginx configuration refresh

Every NPM Improved node still runs its own Nginx process.

Each shared-database node watches the common database for relevant configuration changes. When another node changes hosts, streams, access lists, certificates, or settings, the node regenerates and validates its local Nginx configuration and reloads Nginx.

The default watcher interval is five seconds.

It can be adjusted with:

```text
NPM_SHARED_DB_POLL_SECONDS=5
```

The supported range is 2–60 seconds.

### Shared login identity

A load balancer may send one request to NPMi-1 and the next request to NPMi-2.

If those nodes sign login tokens with different keys, a login created by one server would not be accepted by the other.

In Shared MySQL mode, NPM Improved coordinates the JWT signing identity through the shared database. A joining node adopts the established cluster signing identity and restarts its backend before serving normal API traffic.

### Node presence

Shared-database nodes publish a small heartbeat in the common database.

The **Database & Storage** page shows:

- node name;
- node ID;
- NPM Improved version;
- last-seen time.

This makes it possible to confirm that additional NPM Improved servers are actually connected to the database.

## Certificate files still need shared storage

The database contains certificate records, but the certificate files themselves live on persistent storage.

For several NPM Improved servers to terminate the same HTTPS sites, every node must have the same certificate material.

At minimum, share or replicate:

```text
/etc/letsencrypt
/data/custom_ssl
```

Common approaches include:

- an NFS mount;
- another shared POSIX filesystem;
- block/storage replication appropriate to your environment;
- another reliable file-replication system.

Do not assume that sharing only the MySQL database also shares certificate files.

## Shared MySQL vs Instance Synchronization

These are two different HA models.

### Shared MySQL

Use Shared MySQL when every NPM Improved node can reach one common database.

All nodes read and write the same database, and each node keeps its own local Nginx data plane refreshed from that common state.

### Instance Synchronization

Use Instance Synchronization when each NPM Improved server has its own database and a Primary should replicate configuration to Secondary nodes.

NPM Improved disables Primary/Secondary Instance Synchronization while Shared MySQL mode is active because both systems must not try to replicate the same database state at the same time.

## Database credentials

Database credentials saved by the wizard are stored locally in:

```text
/data/database-config.json
```

The file is written with owner-only permissions.

The management API does not return the saved database password after configuration.

## Returning control to deployment settings

If the database was selected through the UI, **Database & Storage** also provides **Use deployment database settings**.

This removes the runtime database selection and restarts the backend.

After restart, NPM Improved again uses the database configured through container environment variables or deployment defaults.

This action does **not** move any data. Migrate the current database first if the deployment-configured database does not already contain the state you want to use.

## Safety recommendations

Before a database move:

1. create a current NPM Improved backup;
2. make sure the destination database has its own backup policy;
3. use **Test connection**;
4. do not delete the old database immediately after the move;
5. verify Proxy Hosts, users, certificates, Streams, settings, logs, and System Health after the restart.

For a shared MySQL deployment, also verify every proxy node and the shared certificate storage before placing production traffic across all nodes.

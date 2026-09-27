---
outline: deep
---

# Backup & Disaster Recovery

NPM Improved can create encrypted, versioned backup bundles from **Settings → Backup & Recovery**.

Backup files use the `.npmibak` extension and are encrypted with AES-256-GCM. The encryption key is derived from the passphrase supplied when the backup is created. NPM Improved does not store or recover that passphrase.

## Backup types

### Configuration backup

A Configuration backup is intended for migration, rebuilding, or restoring NPM Improved configuration while keeping the destination installation's user accounts and JWT identity.

It contains:

- Proxy Hosts;
- Redirection Hosts;
- 404 Hosts;
- Streams;
- Access Lists and their authorization/client entries;
- application settings;
- configuration revision history;
- certificate database records, including provider metadata;
- custom certificate material under `/data/custom_ssl`;
- Let's Encrypt state under `/etc/letsencrypt`;
- custom Nginx configuration under `/data/nginx/custom`;
- custom Default Site files under `/data/nginx/default_www`.

When restored, object ownership is assigned to the administrator performing the restore. User accounts and JWT keys on the destination are not replaced.

### Full disaster recovery backup

A Full Disaster Recovery backup contains everything in a Configuration backup plus:

- NPM Improved users;
- user permissions;
- authentication records, including configured two-factor state;
- administrative audit-log history;
- the instance JWT key pair from `/data/keys.json`;
- the native recovery credential from `/data/recovery-access.json`.

This mode is intended to rebuild the **same NPM Improved instance** after host/container/storage loss. A restart is required after a full restore so all processes reload restored JWT and recovery identity state.

## Sensitive data

Both backup types contain sensitive material. Depending on the configuration, this can include TLS private keys, DNS-provider credentials, Access List credentials/hashes, and other secrets.

Full Disaster Recovery backups additionally contain authentication and JWT state.

For that reason, NPM Improved requires an encryption passphrase of at least 12 characters for every backup.

Store both the backup and its passphrase according to your normal disaster-recovery procedures. Losing the passphrase means the backup cannot be decrypted.

## Automated retained backups

NPM Improved can create encrypted backups automatically under:

```text
/data/backups
```

Automation is deliberately configured through deployment environment variables rather than storing the backup passphrase in the application database.

Set:

```text
NPM_BACKUP_PASSPHRASE=<at least 12 characters>
NPM_BACKUP_SCOPE=disaster-recovery
NPM_BACKUP_INTERVAL_HOURS=24
NPM_BACKUP_RETENTION=7
```

- `NPM_BACKUP_PASSPHRASE` enables the scheduler. If it is absent or shorter than 12 characters, scheduled backups stay disabled.
- `NPM_BACKUP_SCOPE` may be `configuration` or `disaster-recovery`. The default is `disaster-recovery`.
- `NPM_BACKUP_INTERVAL_HOURS` defaults to 24 and is constrained to 1–8760 hours.
- `NPM_BACKUP_RETENTION` defaults to 7 and is constrained to 1–365 retained scheduled backups.

The first scheduled backup is attempted shortly after backend startup, then at the configured interval. Scheduled files use the `.npmibak` format and are visible in the native recovery console even when the normal Node management API is unhealthy.

The scheduler only retains the configured number of **scheduled** backups. Automatic pre-restore safety backups use their own retention policy and are not counted against this value.

For real disaster recovery, copy retained backups off the NPM Improved host. A backup stored only on the same disk as the application does not protect against storage or host loss.

## Inspect before restore

Selecting a backup and entering its passphrase does **not** immediately restore it.

Use **Inspect backup** first. NPM Improved decrypts the file, validates its format and filesystem paths, and shows:

- backup type;
- creation time;
- source NPM Improved version;
- source database engine;
- object counts;
- certificate/access-list counts;
- filesystem entry count and size;
- whether authentication state is included.

No database or filesystem changes are made during inspection.

## Restore safety

Restore is deliberately destructive and requires entering:

```text
RESTORE
```

Before applying the bundle, NPM Improved creates a local rollback snapshot of the current database scope and relevant persistent filesystem state. It also writes an encrypted pre-restore backup under `/data/backups` using the same passphrase as the imported backup. The ten most recent automatic pre-restore bundles are retained.

The imported database/filesystem state is then restored and Nginx configuration is regenerated from the imported records.

The restore only succeeds after:

1. generated configuration completes;
2. `nginx -t` passes;
3. Nginx reload succeeds.

If any of those steps fail, NPM Improved restores the pre-import database and filesystem snapshot and reloads the previous working configuration.

## Database portability

The logical backup format is database-engine independent. Configuration is exported through the NPM Improved data models rather than as a SQLite/MySQL/PostgreSQL database file.

That allows a backup to be restored to an installation using a different supported database engine, provided the destination NPM Improved version understands the bundle format and schema.

For Configuration backups, user ownership is remapped to the administrator performing the restore.

## External database configuration

A Full Disaster Recovery backup protects the NPM Improved records stored in an external MySQL/MariaDB/PostgreSQL database, but it does **not** export the database server's connection environment variables or credentials.

Keep deployment secrets such as `DB_MYSQL_*` or `DB_POSTGRES_*` with your infrastructure backup/configuration management.

## What is not included

Generated Nginx host files are not treated as authoritative backup data because NPM Improved regenerates them from the restored configuration.

Runtime logs are also intentionally excluded from the backup bundle.

For forensic or compliance requirements, archive logs separately.

## Recommended DR practice

Periodically create a Full Disaster Recovery backup and verify it with **Inspect backup**.

Also keep infrastructure-level backups/snapshots of:

```text
/data
/etc/letsencrypt
```

For production systems, periodically perform a restore test into a non-production NPM Improved instance. A backup that has never been tested is not a proven recovery plan.

---
outline: deep
---

# Configuration History

NPM Improved keeps durable revision history for generated Proxy Host, Redirection Host, 404 Host, and Stream configurations.

The history is intended for recovery and diagnosis, not just auditing. It records the database state and the generated Nginx configuration that participated in the activation transaction.

## Revision states

### Pending

The requested change has been captured, but Nginx activation has not completed yet.

### Active

This is the most recent revision that completed validation and activation successfully for the object.

Only one revision per object should be Active.

### Superseded

The revision was previously Active and has since been replaced by another successful revision.

Superseded revisions are eligible for restore.

### Failed

The candidate failed rendering, `nginx -t`, or reload.

Failed revisions retain the candidate configuration and exact error/phase when available, but they are intentionally **not restorable**. A failed candidate is evidence for diagnosis, not a known-good recovery point.

## What a revision contains

A detailed revision includes:

- revision ID and timestamp;
- actor;
- object type and object ID;
- operation such as create, update, enable, disable, delete, or restore;
- complete stored database snapshot;
- generated Nginx configuration;
- state;
- activation error and failure phase, when applicable;
- source revision ID when a revision was created by restore.

The history list uses lightweight summaries. Full configuration and snapshot data are loaded only when a revision is opened.

## Existing installations

When Configuration History is introduced, NPM Improved does not regenerate every existing host.

Instead, before the first new change to an existing host or stream, the current database state and live Nginx configuration are captured as an **Active baseline** revision. The new requested change is then recorded separately.

This means the first edit after upgrading is still reversible to the configuration that was serving immediately before that edit.

## Restoring a revision

Configuration restore is currently administrator-only.

To restore:

1. Open **Configuration History**.
2. Open a Superseded revision.
3. Review its database snapshot and generated Nginx configuration.
4. Choose **Restore this revision** and confirm.

NPM Improved does not copy the old config file directly into service.

It restores the stored database snapshot as a candidate, regenerates the Nginx configuration through the current template engine, validates the entire Nginx configuration with `nginx -t`, reloads Nginx, and then records a new Active revision.

The original historical revision remains unchanged.

## Restore failures

A failed restore does not replace the currently serving configuration.

The restore attempt is recorded as Failed, the database is put back to its pre-restore state, and the existing last-known-good Nginx configuration remains authoritative.

## Deleted and disabled objects

Disable and delete operations are revisions too.

The successful revision records that state with no live generated host configuration. Restoring an earlier Superseded revision can re-enable or undelete the object when that earlier database snapshot represents an enabled, non-deleted state.

## Relationship to Audit Log

Audit Log answers **who performed an application action**.

Configuration History answers **which database/configuration state actually participated in Nginx activation, whether it succeeded, and which known-good state can be restored**.

Both are retained because they serve different operational purposes.

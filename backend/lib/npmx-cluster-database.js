/**
 * Replace an NPMi snapshot as one database transaction. A cluster snapshot is
 * authoritative for replicated state, never for this node's pairing identity.
 *
 * The identity SELECT, table replacement, and identity INSERT must share the
 * SAME transaction. Committing the replacement first exposes a window where a
 * container restart permanently turns a secondary into an unpaired node.
 */
export const replaceSnapshotRowsAtomically = async (
  knex, tables, snapshot, writeRows, { scope, ownerUserId = null },
) => {
  if (scope === "cluster" && (
    !Array.isArray(snapshot?.setting) ||
    snapshot.setting.some((row) => row.id === "instance-sync")
  )) {
    throw new Error("NPMX cluster snapshot must not contain the node-local instance-sync setting");
  }

  await knex.transaction(async (trx) => {
    const identity = scope === "cluster"
      ? await trx("setting").where({ id: "instance-sync" }).first()
      : null;
    if (scope === "cluster" && !identity) {
      throw new Error("NPMX local node identity is missing; refusing to apply a cluster snapshot");
    }

    for (const [table] of [...tables].reverse()) {
      await trx(table).del();
    }
    for (const [table, model] of tables) {
      await writeRows(trx, table, model, snapshot[table] || [], ownerUserId);
    }
    if (identity) {
      await trx("setting").insert(identity);
    }
  });
};

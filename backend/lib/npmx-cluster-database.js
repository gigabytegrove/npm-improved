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

  const preserveLocalIdentity = scope === "cluster" || scope === "configuration";
  await knex.transaction(async (trx) => {
    const identity = preserveLocalIdentity
      ? await trx("setting").where({ id: "instance-sync" }).first()
      : null;
    if (preserveLocalIdentity && !identity) {
      throw new Error("NPMX local node identity is missing; refusing to apply a cluster snapshot");
    }

    for (const [table] of [...tables].reverse()) {
      await trx(table).del();
    }
    for (const [table, model] of tables) {
      // Configuration-only backups may include the source node identity.
      // A restore must never overwrite the destination node pairing state.
      const rows = preserveLocalIdentity && table === "setting"
        ? (snapshot[table] || []).filter((row) => row.id !== "instance-sync")
        : (snapshot[table] || []);
      await writeRows(trx, table, model, rows, ownerUserId);
    }
    if (identity) {
      await trx("setting").insert(identity);
    }
  });
};

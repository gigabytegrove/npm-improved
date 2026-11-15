import assert from "node:assert/strict";
import { test } from "node:test";
import { replaceSnapshotRowsAtomically } from "../lib/npmx-cluster-database.js";

const original = () => ({
  setting: [
    { id: "instance-sync", value: "enabled", meta: JSON.stringify({ role: "secondary", node_id: "node-2" }) },
    { id: "default-site", value: "old" },
  ],
  proxy_host: [{ id: 1, domain: "existing.example" }],
});

const snapshot = () => ({
  setting: [{ id: "default-site", value: "new" }],
  proxy_host: [{ id: 2, domain: "updated.example" }],
});

const tables = [["setting", {}], ["proxy_host", {}]];

const harness = (initial = original()) => {
  let persisted = structuredClone(initial);
  let committed = 0;
  const knex = {
    async transaction(fn) {
      const pending = structuredClone(persisted);
      const trx = (table) => ({
        where(match) {
          return { async first() { return pending[table].find((row) => Object.entries(match).every(([key, value]) => row[key] === value)) || null; } };
        },
        async del() { pending[table] = []; },
        async insert(row) { pending[table].push(structuredClone(row)); },
      });
      const result = await fn(trx);
      persisted = pending;
      committed += 1;
      return result;
    },
  };
  const writeRows = async (trx, table, _model, rows) => {
    for (const row of rows) await trx(table).insert(row);
  };
  return { knex, writeRows, get state() { return structuredClone(persisted); }, get committed() { return committed; } };
};

const replace = (h, data = snapshot(), scope = "cluster", writeRows = h.writeRows) =>
  replaceSnapshotRowsAtomically(h.knex, tables, data, writeRows, { scope });

test("cluster snapshot preserves secondary identity atomically alongside replaced proxy hosts", async () => {
  const h = harness();
  await replace(h);
  assert.equal(h.committed, 1);
  assert.deepEqual(h.state.setting.find((row) => row.id === "instance-sync"), original().setting[0]);
  assert.deepEqual(h.state.proxy_host, snapshot().proxy_host);
  assert.deepEqual(h.state.setting.find((row) => row.id === "default-site"), snapshot().setting[0]);
});

test("cluster rollback restores previous replicated records without deleting the local identity", async () => {
  const h = harness();
  await replace(h);
  await replace(h, { setting: [{ id: "default-site", value: "old" }], proxy_host: original().proxy_host });
  assert.equal(h.committed, 2);
  assert.deepEqual(h.state.proxy_host, original().proxy_host);
  assert.deepEqual(h.state.setting.find((row) => row.id === "instance-sync"), original().setting[0]);
  assert.deepEqual(h.state.setting.find((row) => row.id === "default-site"), original().setting[1]);
});

test("failed insertion rolls back both replicated data and the preserved identity", async () => {
  const h = harness();
  const before = h.state;
  const insertAndFail = async (trx, table, model, rows) => {
    await h.writeRows(trx, table, model, rows);
    if (table === "proxy_host") throw new Error("simulated interrupted snapshot");
  };
  await assert.rejects(replace(h, snapshot(), "cluster", insertAndFail), /interrupted snapshot/);
  assert.equal(h.committed, 0);
  assert.deepEqual(h.state, before);
});

test("refuses cluster overwrite when local identity is already missing", async () => {
  const initial = original();
  initial.setting = initial.setting.filter((row) => row.id !== "instance-sync");
  const h = harness(initial);
  await assert.rejects(replace(h), /local node identity is missing/);
  assert.equal(h.committed, 0);
  assert.deepEqual(h.state, initial);
});

test("rejects cluster snapshots that attempt to overwrite the node-local identity", async () => {
  const h = harness();
  const data = snapshot();
  data.setting.push({ id: "instance-sync", value: "disabled" });
  await assert.rejects(replace(h, data), /must not contain/);
  assert.deepEqual(h.state, original());
});

test("explicit full disaster recovery continues to replace all settings", async () => {
  const h = harness();
  await replace(h, snapshot(), "disaster-recovery");
  assert.equal(h.state.setting.some((row) => row.id === "instance-sync"), false);
  assert.deepEqual(h.state.proxy_host, snapshot().proxy_host);
});

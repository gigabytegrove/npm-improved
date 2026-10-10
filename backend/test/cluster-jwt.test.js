import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import jwt from "jsonwebtoken";
import { getClusterJwtKey } from "../lib/cluster-jwt.js";

test("paired nodes derive identical purpose-scoped JWT signing keys", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "npmi-cluster-jwt-"));
  const primary = path.join(dir, "primary");
  const secondary = path.join(dir, "secondary");
  const unrelated = path.join(dir, "unrelated");
  try {
    const secret = "secure-pairing-secret-for-unit-tests-123456789";
    fs.writeFileSync(primary, secret + "\n", { mode: 0o600 });
    fs.writeFileSync(secondary, secret + "\n", { mode: 0o600 });
    fs.writeFileSync(unrelated, secret + "-different\n", { mode: 0o600 });
    const primaryKey = getClusterJwtKey(primary);
    const secondaryKey = getClusterJwtKey(secondary);
    const unrelatedKey = getClusterJwtKey(unrelated);
    assert.ok(Buffer.isBuffer(primaryKey));
    assert.equal(primaryKey.length, 32);
    assert.deepEqual(primaryKey, secondaryKey);
    assert.notDeepEqual(primaryKey, unrelatedKey);
    const signed = jwt.sign({ attrs: { id: 8 }, scope: ["user"] }, primaryKey, {
      algorithm: "HS256", expiresIn: "7d",
    });
    assert.equal(jwt.verify(signed, secondaryKey, { algorithms: ["HS256"] }).attrs.id, 8);
    assert.throws(() => jwt.verify(signed, unrelatedKey, { algorithms: ["HS256"] }));
    assert.throws(() => jwt.verify(signed, secondaryKey, { algorithms: ["RS256"] }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid, absent, or undersized NPMX secrets cannot enable cluster token signing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "npmi-cluster-key-invalid-"));
  const file = path.join(dir, "cluster-secret");
  try {
    assert.equal(getClusterJwtKey(file), null);
    fs.writeFileSync(file, "too-short");
    assert.equal(getClusterJwtKey(file), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

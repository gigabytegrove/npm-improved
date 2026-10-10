import assert from "node:assert/strict";
import test from "node:test";
import cors from "../lib/express/cors.js";

test("cross-origin API responses expose the physical node identity header", () => {
  let headers = {};
  let nextCalled = false;
  cors(
    { headers: { origin: "https://console.example.test" } },
    { set: (fields) => { headers = fields; } },
    () => { nextCalled = true; },
  );
  assert.equal(nextCalled, true);
  assert.match(headers["Access-Control-Expose-Headers"], /(?:^|, )X-NPMi-Node-Hostname(?:,|$)/);
  assert.equal(headers["Access-Control-Allow-Origin"], "https://console.example.test");
});

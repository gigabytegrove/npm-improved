import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeAnalyticsPath, classifyAnalyticsDevice, injectAnalyticsLog } from "../internal/proxy-analytics.js";

test("paths strip query and fragment and redact opaque identifiers", () => {
  assert.equal(sanitizeAnalyticsPath("/home?a=secret"), "/home");
  assert.equal(sanitizeAnalyticsPath("/users/jane@example.com"), "/users/[redacted]");
  assert.equal(sanitizeAnalyticsPath("/secrets/0123456789abcdef012345"), "/secrets/[redacted]");
  assert.equal(sanitizeAnalyticsPath("not-a-path"), "/");
  assert.equal(sanitizeAnalyticsPath(null), "/");
});

test("user agents are reduced to broad device classes", () => {
  assert.equal(classifyAnalyticsDevice("Mozilla/5.0 iPhone Mobile"), "mobile");
  assert.equal(classifyAnalyticsDevice("Googlebot"), "crawler");
  assert.equal(classifyAnalyticsDevice("Mozilla/5.0 Chrome"), "desktop");
});

test("existing generated proxy configurations are upgraded once, without unrelated changes", () => {
  const original = "server {\n  access_log /data/logs/proxy-host-5_access.log proxy;\n}";
  const converted = injectAnalyticsLog(original, 5);
  assert.ok(converted.includes("proxy-host-5_analytics.log proxy_analytics;"));
  assert.equal(injectAnalyticsLog(converted, 5), converted);
  assert.equal(injectAnalyticsLog(original, 6), original);
});

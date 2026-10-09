import assert from "node:assert/strict";
import test from "node:test";
import { parseAnalyticsEvent } from "../lib/proxy-analytics.js";
import { analyticsSourceId, injectNonProxyAnalyticsLog } from "../internal/proxy-analytics.js";

test("distinct routing categories cannot collide with positive proxy host identifiers", () => {
  assert.equal(analyticsSourceId("proxy-host-7_analytics.log"), 7);
  assert.equal(analyticsSourceId("redirection-host-7_analytics.log"), -1000007);
  assert.equal(analyticsSourceId("dead-host-7_analytics.log.1"), -2000007);
  assert.equal(analyticsSourceId("default-host_analytics.log"), -3000000);
  assert.equal(analyticsSourceId("fallback-http_analytics.log"), -3000001);
  assert.equal(analyticsSourceId("unrelated.log"), null);
});

test("HTTP event parser validates the route identity supplied by its file", () => {
  const line = JSON.stringify({
    time: new Date().toISOString(), status: "301", bytes_sent: "180",
    request_time: "0.005",
  });
  assert.equal(parseAnalyticsEvent(line, -1000007)?.hostId, -1000007);
  assert.equal(parseAnalyticsEvent(line, 7)?.hostId, 7);
  assert.equal(parseAnalyticsEvent(JSON.stringify({ ...JSON.parse(line), host_id: 7 }), -1000007), null);
});

test("existing redirection, 404, default and stream configs are upgraded idempotently", () => {
  const patterns = [
    ["redirection-host", 7, "standard"],
    ["dead-host", 4, "standard"],
    ["default-host", null, "combined"],
    ["stream", 2, "stream"],
  ];
  for (const [source, id, format] of patterns) {
    const stem = id === null ? source : `${source}-${id}`;
    const original = `server {\n  access_log /data/logs/${stem}_access.log ${format};\n}`;
    const once = injectNonProxyAnalyticsLog(original, source, id);
    assert.match(once, new RegExp(`${stem}_analytics\\.log ${source === "stream" ? "stream_analytics" : "proxy_analytics"}`));
    assert.equal(injectNonProxyAnalyticsLog(once, source, id), once);
  }
});

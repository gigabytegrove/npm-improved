import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateAnalytics,
  bucketAnalytics,
  classifyStatus,
  parseAnalyticsEvent,
} from "../lib/proxy-analytics.js";

const input = (overrides = {}) => JSON.stringify({
  host_id: 5,
  time: "2026-10-09T12:00:00.000Z",
  status: 200,
  bytes_sent: 120,
  request_time: 0.15,
  uri: "/admin?token=secret",
  remote_addr: "192.0.2.44",
  ...overrides,
});

test("requires matching host id and valid log schema", () => {
  assert.equal(parseAnalyticsEvent(input(), 4), null);
  assert.equal(parseAnalyticsEvent("{", 5), null);
  assert.equal(parseAnalyticsEvent(input({ bytes_sent: -2 }), 5), null);
  assert.equal(parseAnalyticsEvent(input({ request_time: "nan" }), 5), null);
  assert.equal(parseAnalyticsEvent(input({ status: 999 }), 5), null);
});

test("does not persist sensitive request data", () => {
  assert.deepEqual(parseAnalyticsEvent(input(), 5), {
    hostId: 5, time: Date.parse("2026-10-09T12:00:00.000Z"),
    status: 200, bytes: 120, duration: 0.15,
  });
});

test("status classification and percentile aggregation", () => {
  assert.equal(classifyStatus(403), "4xx");
  assert.equal(classifyStatus(101), "other");
  const rows = [
    parseAnalyticsEvent(input(), 5),
    parseAnalyticsEvent(input({ status: 503, bytes_sent: 20, request_time: 1 }), 5),
    parseAnalyticsEvent(input({ status: 302, bytes_sent: 0, request_time: "-" }), 5),
  ];
  assert.deepEqual(aggregateAnalytics(rows), {
    requests: 3,
    bytes_sent: 140,
    status: { "2xx": 1, "3xx": 1, "4xx": 0, "5xx": 1, other: 0 },
    latency_seconds: { samples: 2, p50: 0.15, p95: 1, p99: 1 },
  });
  assert.equal(bucketAnalytics(rows, 60000).length, 1);
  assert.throws(() => bucketAnalytics(rows, 0), RangeError);
});

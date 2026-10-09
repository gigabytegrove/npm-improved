import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("incremental ingestion, partial lines, rotated files, retention and analytics queries", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "npmi-analytics-"));
  const logDir = path.join(root, "logs");
  fs.mkdirSync(logDir);
  process.env.NPM_ANALYTICS_LOG_DIR = logDir;
  process.env.NPM_ANALYTICS_DB = path.join(root, "analytics.sqlite");
  const analytics = await import("../internal/proxy-analytics.js?test=" + Date.now());
  const active = path.join(logDir, "proxy-host-5_analytics.log");
  const payload = (status, bytes) => JSON.stringify({
    time: new Date(Date.now() - 10000).toISOString(),
    domain: "ha.example.test",
    method: "GET",
    path: "/api/records?token=should-not-be-recorded",
    protocol: "HTTP/2.0",
    status: String(status),
    bytes_sent: String(bytes),
    request_length: "31",
    request_time: "0.123",
    upstream_time: "0.110",
    upstream_status: "200",
    user_agent: "Mozilla/5.0 Mobile",
  });
  try {
    fs.writeFileSync(active, payload(200, 150) + "\n");
    assert.equal(analytics.ingestAnalyticsLogs(), 1);
    assert.equal(analytics.ingestAnalyticsLogs(), 0);
    let summary = analytics.getHostAnalytics(5, 24);
    assert.equal(summary.requests, 1);
    assert.equal(summary.bytes_out, 150);
    assert.equal(summary.status["2xx"], 1);
    assert.equal(summary.latency_ms.p95, 123);
    assert.equal(summary.paths[0].label, "/api/records");
    fs.appendFileSync(active, payload(404, 50));
    assert.equal(analytics.ingestAnalyticsLogs(), 0); // last line incomplete
    fs.appendFileSync(active, "\n");
    assert.equal(analytics.ingestAnalyticsLogs(), 1);
    summary = analytics.getHostAnalytics(5, 24);
    assert.equal(summary.requests, 2);
    assert.equal(summary.status["4xx"], 1);
    assert.equal(analytics.getHostRequests(5, 24).total, 2);
    const csv = analytics.exportHostAnalyticsCsv(5, 24).csv;
    assert.ok(csv.includes("timestamp_utc"));
    assert.ok(!csv.includes("should-not-be-recorded"));
    // Nginx log rotation: same inode at new name, new active inode.
    fs.renameSync(active, active + ".1");
    fs.writeFileSync(active, payload(503, 200) + "\n");
    assert.equal(analytics.ingestAnalyticsLogs(), 1);
    assert.equal(analytics.ingestAnalyticsLogs(), 0);
    assert.equal(analytics.getHostAnalytics(5, 24).requests, 3);
    assert.equal(analytics.getHostAnalytics(5, 24).status["5xx"], 1);
    assert.equal(analytics.getHostAnalytics(6, 24).requests, 0);
    assert.throws(() => analytics.getHostAnalytics(5, -1), RangeError);
  } finally {
    delete process.env.NPM_ANALYTICS_LOG_DIR;
    delete process.env.NPM_ANALYTICS_DB;
    // SQLite files may still have open handles until the test process exits.
    fs.rmSync(root, { recursive: true, force: true });
  }
});

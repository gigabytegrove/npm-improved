import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("host traffic intelligence is scoped, evidence-based and never labels all crawlers malicious", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "npmi-host-intel-"));
  process.env.NPM_ANALYTICS_LOG_DIR = path.join(root, "logs");
  process.env.NPM_ANALYTICS_DB = path.join(root, "analytics.sqlite");
  fs.mkdirSync(process.env.NPM_ANALYTICS_LOG_DIR);
  try {
    const collector = await import("../internal/proxy-analytics.js?host-intelligence=" + Date.now());
    const { getHostTrafficIntelligence, classifyBrowserFamily, evaluateClientSignals } =
      await import("../internal/host-traffic-intelligence.js");
    const row = (host, uri, status, agent, ip) => JSON.stringify({
      time: new Date(Date.now() - 5000).toISOString(),
      domain: host === 1 ? "demo.example.test" : "other.example.test",
      method: "GET", path: uri + "?token=never-stored", protocol: "HTTP/2.0",
      status: String(status), bytes_sent: "123", request_length: "45",
      request_time: "0.120", upstream_time: "0.080", upstream_status: "200",
      user_agent: agent, client_ip: ip, peer_ip: "10.1.2.3",
      request_id: "e".repeat(32), connection_id: "99",
      connection_requests: "1", epoch: String(Date.now() / 1000),
      scheme: "https", tls: "TLSv1.3", blocked_ip: "0", blocked_ua: "0",
    }) + "\n";
    fs.writeFileSync(path.join(process.env.NPM_ANALYTICS_LOG_DIR, "proxy-host-1_analytics.log"),
      row(1, "/.env", 404, "YandexBot/3.0", "203.0.113.10") +
      row(1, "/wp-login.php", 404, "YandexBot/3.0", "203.0.113.10") +
      row(1, "/home", 200, "Mozilla/5.0 Chrome/124.0", "198.51.100.22"));
    fs.writeFileSync(path.join(process.env.NPM_ANALYTICS_LOG_DIR, "proxy-host-2_analytics.log"),
      row(2, "/private", 404, "YandexBot/3.0", "203.0.113.10"));
    assert.equal(collector.ingestAnalyticsLogs(), 4);
    const report = getHostTrafficIntelligence(1, 5);
    assert.equal(report.scope, "local-node");
    assert.equal(report.requests, 3);
    assert.equal(report.timeline.reduce((sum, minute) => sum + minute.requests, 0), 3);
    assert.equal(report.unique_ips, 2);
    assert.equal(report.suspicious_ips[0].value, "203.0.113.10");
    assert.equal(report.suspicious_ips[0].probe_requests, 2);
    assert.equal(report.suspicious_agents[0].value, "YandexBot/3.0");
    assert.equal(report.suspicious_agents[0].priority, "review");
    assert.ok(report.recent.every((entry) => !entry.path.includes("token=")));
    assert.ok(report.browsers.some((row) => row.label === "Claimed bot / crawler"));
    assert.equal(report.geography.available, false);
    assert.equal(getHostTrafficIntelligence(2, 5).requests, 1);
    assert.throws(() => getHostTrafficIntelligence(0, 5), RangeError);
    assert.throws(() => getHostTrafficIntelligence(1, 11), RangeError);
    assert.throws(() => getHostTrafficIntelligence(1, "5"), RangeError);
    assert.equal(classifyBrowserFamily("Mozilla/5.0 Edg/126.0 Chrome/126"), "Edge (claimed)");
    assert.equal(evaluateClientSignals({ requests: 1 }, 5).priority, "none");
  } finally {
    delete process.env.NPM_ANALYTICS_DB;
    delete process.env.NPM_ANALYTICS_LOG_DIR;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

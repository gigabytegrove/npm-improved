import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("Node Analytics Center aggregates local hosts, filters, timestamps and safe CSV", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "npmi-node-center-"));
  process.env.NPM_ANALYTICS_LOG_DIR = path.join(root, "logs");
  process.env.NPM_ANALYTICS_DB = path.join(root, "analytics.sqlite");
  fs.mkdirSync(process.env.NPM_ANALYTICS_LOG_DIR);
  const collector = await import("../internal/proxy-analytics.js?node-center=" + Date.now());
  // The analytics module resolves the common collector connection in this process.
  // Tests run in isolated Node test workers.
  const { getNodeAnalytics, getNodeAnalyticsRequests, getNodeClientProfile, parseNodeFilters, exportNodeAnalyticsCsv } =
    await import("../internal/node-analytics.js");

  const now = new Date(Date.now() - 15000).toISOString();
  const logLine = (status, bytes, pathValue) => JSON.stringify({
    time: now, domain: "example.test", method: "GET", path: pathValue,
    protocol: "HTTP/2.0", status: String(status), bytes_sent: String(bytes),
    request_length: "42", request_time: "0.120", upstream_time: "0.080",
    upstream_status: "200", user_agent: "Mozilla/5.0",
    client_ip: "203.0.113.27", peer_ip: "172.18.0.1",
    request_id: "a".repeat(32), connection_id: "87",
    connection_requests: "2", epoch: String(Date.now()/1000),
    scheme: "https", tls: "TLSv1.3", blocked_ip: "0", blocked_ua: "0",
  }) + "\n";
  fs.writeFileSync(path.join(process.env.NPM_ANALYTICS_LOG_DIR, "proxy-host-1_analytics.log"),
    logLine(200, 500, "/a?password=secret") + logLine(503, 100, "/b"));
  fs.writeFileSync(path.join(process.env.NPM_ANALYTICS_LOG_DIR, "proxy-host-2_analytics.log"),
    logLine(404, 50, "/c"));
  try {
    assert.equal(collector.ingestAnalyticsLogs(), 3);
    assert.equal(collector.ingestAnalyticsLogs(), 0);
    const all = getNodeAnalytics({ hours: 24 });
    assert.equal(all.requests, 3);
    assert.equal(all.bytes_out, 650);
    assert.equal(all.bytes_in, 126);
    assert.equal(all.active_hosts, 2);
    assert.equal(all.unique_ips, 1);
    assert.equal(all.ips[0].ip, "203.0.113.27");
    assert.equal(all.user_agents[0].label, "Mozilla/5.0");
    assert.equal(all.status["2xx"], 1);
    assert.equal(all.status["4xx"], 1);
    assert.equal(all.status["5xx"], 1);
    assert.equal(all.latency_ms.p95, 120);
    assert.equal(all.hosts.length, 2);
    assert.equal(all.timeline.reduce((n,x) => n+x.requests,0),3);
    assert.equal(all.paths.find((x)=>x.label === "/a")?.requests, 1);
    assert.equal(getNodeAnalytics({ hours: 24, hostId: 1 }).requests, 2);
    const filtered = getNodeAnalytics({ hours: 24, statusClass: "5xx" });
    assert.equal(filtered.requests, 1);
    assert.equal(filtered.hosts.length, 1);
    const events = getNodeAnalyticsRequests({ hours: 24, hostId: 1 }, 50, 0);
    assert.equal(events.total,2);
    assert.equal(events.entries.length,2);
    assert.equal(events.entries[0].client_ip, "203.0.113.27");
    assert.equal(events.entries[0].connection_id, "87");
    assert.equal(getNodeAnalyticsRequests({ hours: 24, ip: "203.0.113.27" }).total, 3);
    assert.equal(getNodeAnalyticsRequests({ hours: 24, userAgent: "Not a UA" }).total, 0);
    assert.equal(getNodeAnalyticsRequests({ hours: 24, connection_id: "87" }).total, 3);
    const profile = getNodeClientProfile("203.0.113.27", {hours:24});
    assert.equal(profile.requests, 3);
    assert.equal(profile.active_routes, 2);
    assert.equal(profile.distinct_user_agents, 1);
    assert.equal(profile.client_errors, 1);
    assert.equal(profile.server_errors, 1);
    assert.equal(profile.trend.reduce((sum,point)=>sum+point.requests,0),3);
    assert.equal(profile.paths.find(row=>row.value==="/a")?.requests,1);
    assert.equal(profile.user_agents[0].value, "Mozilla/5.0");
    assert.equal(getNodeClientProfile("203.0.113.27",{hours:24,hostId:1}).requests,2);
    assert.equal(getNodeClientProfile("192.0.2.200",{hours:24}).requests,0);
    assert.throws(()=>getNodeClientProfile("not-an-ip",{hours:24}),RangeError);
    const csv = exportNodeAnalyticsCsv({ hours: 24 }).csv;
    assert.ok(csv.includes("/a"));
    assert.ok(csv.includes("203.0.113.27"));
    assert.ok(csv.includes("Mozilla/5.0"));
    assert.ok(!csv.includes("password=secret"));
    assert.equal(exportNodeAnalyticsCsv({hours:24,ip:"192.0.2.200"}).csv.trim().split("\\n").length,1);
    assert.deepEqual(parseNodeFilters({ hours: "24", host_id: "2", status_class:"4xx" }), {
      hours: 24,hostId: 2,statusClass:"4xx",
    });
    assert.throws(() => getNodeAnalytics({ hours: 9 }), RangeError);
    assert.throws(() => getNodeAnalyticsRequests({ hours: 24 }, 1000), RangeError);
    assert.throws(() => getNodeAnalytics({ hours: 24, statusClass: "900" }), RangeError);
  } finally {
    delete process.env.NPM_ANALYTICS_DB;
    delete process.env.NPM_ANALYTICS_LOG_DIR;
    fs.rmSync(root, { recursive:true, force:true });
  }
});

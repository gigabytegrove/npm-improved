import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("stream collector separates TCP/UDP sessions, handles rotation and ignores duplicate reads", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "npmi-stream-"));
  process.env.NPM_ANALYTICS_LOG_DIR = path.join(root, "logs");
  process.env.NPM_ANALYTICS_DB = path.join(root, "analytics.sqlite");
  fs.mkdirSync(process.env.NPM_ANALYTICS_LOG_DIR);
  const source = await import("../internal/stream-analytics.js");
  const filename = path.join(process.env.NPM_ANALYTICS_LOG_DIR, "stream-3_analytics.log");
  const event = (proto, sent, received) => JSON.stringify({
    time: new Date(Date.now()-10000).toISOString(),
    protocol:proto, status:"200", bytes_sent:String(sent),
    bytes_received:String(received), session_time:"1.250",
  })+"\n";
  try {
    assert.equal(source.streamSourceId("stream-3_analytics.log"),3);
    assert.equal(source.streamSourceId("fallback_stream_analytics.log"),0);
    assert.equal(source.streamSourceId("foo.log"),null);
    fs.writeFileSync(filename,event("TCP",300,400));
    assert.equal(source.ingestStreamLogs(),1);
    assert.equal(source.ingestStreamLogs(),0);
    let report=source.getNodeStreamAnalytics(24);
    assert.equal(report.sessions,1);
    assert.equal(report.tcp,1);
    assert.equal(report.bytes_received,400);
    fs.renameSync(filename,filename+".1");
    fs.writeFileSync(filename,event("UDP",20,30));
    assert.equal(source.ingestStreamLogs(),1);
    report=source.getNodeStreamAnalytics(24);
    assert.equal(report.sessions,2);
    assert.equal(report.udp,1);
    assert.equal(report.bytes_sent,320);
    assert.equal(report.streams.length,2);
    assert.equal(report.timeline.reduce((total,row)=>total+row.sessions,0),2);
    assert.throws(()=>source.getNodeStreamAnalytics(9), RangeError);
  } finally {
    delete process.env.NPM_ANALYTICS_LOG_DIR;
    delete process.env.NPM_ANALYTICS_DB;
    fs.rmSync(root,{recursive:true,force:true});
  }
});

import fs from "node:fs";
import path from "node:path";
import { getAnalyticsDatabase, getAnalyticsRetention } from "./proxy-analytics.js";
import { global as logger } from "../logger.js";

// Stream sessions are not HTTP requests. Count them separately to avoid
// misrepresenting TCP/UDP traffic as web request activity.
const ROOT = process.env.NPM_ANALYTICS_LOG_DIR || "/data/logs";
const SOURCE = /^(?:stream-(\d+)|fallback_stream)_analytics\.log(?:\.1)?$/;
const CHUNK = 512 * 1024;
let initialized = false;
let timer = null;
let busy = false;
let lastPrune = 0;

export function streamSourceId(name) {
  const match = SOURCE.exec(name);
  if (!match) return null;
  if (name.startsWith("fallback_stream_")) return 0;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function db() {
  const connection = getAnalyticsDatabase();
  if (!initialized) {
    connection.exec(`
      CREATE TABLE IF NOT EXISTS analytics_stream_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stream_id INTEGER NOT NULL,
        occurred_at INTEGER NOT NULL,
        protocol TEXT NOT NULL,
        status INTEGER NOT NULL,
        bytes_sent INTEGER NOT NULL,
        bytes_received INTEGER NOT NULL,
        duration_ms REAL
      );
      CREATE INDEX IF NOT EXISTS analytics_stream_time ON analytics_stream_event(occurred_at,stream_id);
      CREATE TABLE IF NOT EXISTS analytics_stream_hour (
        stream_id INTEGER NOT NULL,
        bucket INTEGER NOT NULL,
        protocol TEXT NOT NULL,
        status INTEGER NOT NULL,
        sessions INTEGER NOT NULL,
        bytes_sent INTEGER NOT NULL,
        bytes_received INTEGER NOT NULL,
        PRIMARY KEY(stream_id,bucket,protocol,status)
      );
      CREATE INDEX IF NOT EXISTS analytics_stream_hour_time ON analytics_stream_hour(bucket);
    `);
    initialized = true;
  }
  return connection;
}

function sourceEvent(line, id, retentionMs) {
  if (!line || line.length > 65536) return null;
  let raw;
  try { raw = JSON.parse(line); } catch { return null; }
  const stamp = Date.parse(raw.time);
  const protocol = String(raw.protocol || "").toUpperCase();
  const status = Number(raw.status);
  const sent = Number(raw.bytes_sent);
  const received = Number(raw.bytes_received);
  const duration = raw.session_time === "-" ? null : Number(raw.session_time);
  if (!Number.isFinite(stamp) || stamp < retentionMs || stamp > Date.now() + 60000 ||
    !["TCP","UDP"].includes(protocol) || !Number.isInteger(status) || status < 100 || status > 599 ||
    !Number.isSafeInteger(sent) || sent < 0 ||
    !Number.isSafeInteger(received) || received < 0 ||
    (duration !== null && (!Number.isFinite(duration) || duration < 0))) return null;
  return {
    streamId: id,
    time: Math.floor(stamp / 1000), protocol, status, sent, received,
    duration: duration === null ? null : duration * 1000,
  };
}

function ingestFile(name, id) {
  const full = path.join(ROOT, name);
  const stat = fs.statSync(full);
  if (!stat.isFile()) return 0;
  const key = `${stat.dev}:${stat.ino}`;
  const connection = db();
  const previous = connection.prepare("SELECT position FROM analytics_cursor WHERE inode_key=?").get(key);
  let start = previous?.position || 0;
  if (stat.size < start) start = 0;
  if (start >= stat.size) return 0;
  const length = Math.min(CHUNK, stat.size - start);
  const buffer = Buffer.allocUnsafe(length);
  const fd = fs.openSync(full, "r");
  let n;
  try { n = fs.readSync(fd, buffer, 0, length, start); }
  finally { fs.closeSync(fd); }
  if (!n) return 0;
  const end = buffer.subarray(0,n).lastIndexOf(10);
  const checkpoint = connection.prepare(`INSERT INTO analytics_cursor(inode_key,file_name,position,modified_at)
    VALUES(?,?,?,?) ON CONFLICT(inode_key) DO UPDATE SET
    file_name=excluded.file_name,position=excluded.position,modified_at=excluded.modified_at`);
  if (end < 0) {
    if (n === CHUNK) checkpoint.run(key, name, start+n, Date.now());
    return 0;
  }
  const lines = buffer.subarray(0,end+1).toString("utf8").split("\n");
  const insert = connection.prepare(`INSERT INTO analytics_stream_event
    (stream_id,occurred_at,protocol,status,bytes_sent,bytes_received,duration_ms)
    VALUES (?,?,?,?,?,?,?)`);
  const rollup = connection.prepare(`INSERT INTO analytics_stream_hour
    (stream_id,bucket,protocol,status,sessions,bytes_sent,bytes_received)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(stream_id,bucket,protocol,status) DO UPDATE SET
    sessions=sessions+1,bytes_sent=bytes_sent+excluded.bytes_sent,
    bytes_received=bytes_received+excluded.bytes_received`);
  const cutoff = Date.now() - getAnalyticsRetention().rawDays * 86400000;
  let accepted = 0;
  connection.transaction(() => {
    for(const line of lines) {
      const value = sourceEvent(line, id, cutoff);
      if(!value) continue;
      insert.run(id,value.time,value.protocol,value.status,value.sent,value.received,value.duration);
      rollup.run(id,Math.floor(value.time/3600)*3600,value.protocol,value.status,1,value.sent,value.received);
      accepted++;
    }
    checkpoint.run(key,name,start+end+1,Date.now());
  })();
  return accepted;
}

export function ingestStreamLogs() {
  if (busy || process.env.NPM_ANALYTICS_ENABLED === "false" || !fs.existsSync(ROOT)) return 0;
  busy = true;
  try {
    let count = 0;
    const deadline = Date.now() + 1000;
    const files = fs.readdirSync(ROOT).filter((file) => SOURCE.test(file))
      .sort((a,b)=> Number(b.endsWith(".1"))-Number(a.endsWith(".1")));
    for(const file of files) {
      if(Date.now()>deadline) break;
      const id=streamSourceId(file);
      if(id===null) continue;
      try { count+=ingestFile(file,id); }
      catch(error) { logger.warn(`Stream analytics ingestion skipped ${file}: ${error.message}`); }
    }
    if(Date.now()-lastPrune>3600000) {
      const connection=db(), retention=getAnalyticsRetention();
      connection.prepare("DELETE FROM analytics_stream_event WHERE occurred_at<?")
        .run(Math.floor(Date.now()/1000)-retention.rawDays*86400);
      connection.prepare("DELETE FROM analytics_stream_hour WHERE bucket<?")
        .run(Math.floor(Date.now()/1000)-retention.rollupDays*86400);
      lastPrune=Date.now();
    }
    return count;
  } finally {busy=false;}
}

export function startStreamCollector() {
  if(timer || process.env.NPM_ANALYTICS_ENABLED==="false") return;
  try {db(); ingestStreamLogs();} catch(error) {logger.warn(`Stream analytics unavailable: ${error.message}`);}
  timer=setInterval(()=>{
    try {ingestStreamLogs();} catch(error) {logger.warn(`Stream analytics error: ${error.message}`);}
  },10000);
  timer.unref();
}

export function getNodeStreamAnalytics(hours=24) {
  if(![1,24,168,720,2160].includes(hours)) throw new RangeError("Invalid stream reporting window");
  const connection=db(), retention=getAnalyticsRetention();
  const rolled=hours>retention.rawDays*24;
  const since=Math.floor(Date.now()/1000)-hours*3600;
  const source=rolled?"analytics_stream_hour":"analytics_stream_event";
  const time=rolled?"bucket":"occurred_at";
  const sessionCount=rolled?"SUM(sessions)":"COUNT(*)";
  const rows=connection.prepare(`SELECT stream_id,protocol,
    ${sessionCount} AS sessions,SUM(bytes_sent) AS bytes_sent,
    SUM(bytes_received) AS bytes_received FROM ${source}
    WHERE ${time}>=? GROUP BY stream_id,protocol ORDER BY sessions DESC LIMIT 250`).all(since);
  const totals={sessions:0,bytes_sent:0,bytes_received:0,tcp:0,udp:0};
  for(const row of rows) {
    const n=Number(row.sessions);
    totals.sessions+=n;
    totals.bytes_sent+=Number(row.bytes_sent||0);
    totals.bytes_received+=Number(row.bytes_received||0);
    if(row.protocol==="TCP") totals.tcp+=n;
    if(row.protocol==="UDP") totals.udp+=n;
  }
  const stride=hours===1&&!rolled?60:hours<=24?3600:86400;
  const timeline=connection.prepare(`SELECT CAST(${time}/? AS INTEGER)*? AS bucket,
    ${sessionCount} AS sessions,SUM(bytes_sent) AS bytes_sent,
    SUM(bytes_received) AS bytes_received FROM ${source}
    WHERE ${time}>=? GROUP BY CAST(${time}/? AS INTEGER) ORDER BY bucket`)
    .all(stride,stride,since,stride).map((row)=>({
      at:new Date(row.bucket*1000).toISOString(),sessions:Number(row.sessions),
      bytes_sent:Number(row.bytes_sent||0),bytes_received:Number(row.bytes_received||0),
    }));
  return {
    ...totals, accuracy:rolled?"hourly-rollup":"raw-events",
    streams: rows.map((row)=>({
      stream_id:row.stream_id,protocol:row.protocol,sessions:Number(row.sessions),
      bytes_sent:Number(row.bytes_sent||0),bytes_received:Number(row.bytes_received||0),
    })),timeline,
    limitations:"TCP and UDP are counted as Nginx stream sessions, not HTTP requests; per-session metrics appear when the session ends.",
  };
}

/**
 * Privacy-conscious, side-effect-free analytics helpers for structured Nginx logs.
 * Logging/ingestion and API wiring are separate follow-up components.
 */
const STATUSES = ["2xx", "3xx", "4xx", "5xx", "other"];
const validTime = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

export function classifyStatus(status) {
  const code = Number(status);
  if (!Number.isInteger(code) || code < 100 || code > 599) return "other";
  const band = Math.floor(code / 100);
  return band >= 2 && band <= 5 ? `${band}xx` : "other";
}

export function parseAnalyticsEvent(line, expectedHostId) {
  if (typeof line !== "string" || line.length > 65536) return null;
  let raw;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const hostId = Number(raw.host_id);
  const time = Date.parse(raw.time);
  const status = Number(raw.status);
  const bytes = Number(raw.bytes_sent);
  if (!Number.isSafeInteger(hostId) || hostId < 1 || hostId !== expectedHostId) return null;
  if (!Number.isFinite(time) || !Number.isInteger(status) || status < 100 || status > 599) return null;
  if (!Number.isSafeInteger(bytes) || bytes < 0) return null;
  const duration = raw.request_time === null || raw.request_time === undefined || raw.request_time === "-"
    ? null : Number(raw.request_time);
  if (duration !== null && !validTime(duration)) return null;
  // Intentionally exclude raw URI, query, cookies, client IP, headers and user-agent.
  return Object.freeze({ hostId, time, status, bytes, duration });
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  const rank = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[rank];
}

export function aggregateAnalytics(events) {
  const status = Object.fromEntries(STATUSES.map((key) => [key, 0]));
  const latency = [];
  let requests = 0;
  let bytesSent = 0;
  for (const event of events) {
    requests += 1;
    bytesSent += event.bytes;
    status[classifyStatus(event.status)] += 1;
    if (event.duration !== null) latency.push(event.duration);
  }
  latency.sort((a, b) => a - b);
  return {
    requests,
    bytes_sent: bytesSent,
    status,
    latency_seconds: {
      samples: latency.length,
      p50: percentile(latency, 0.50),
      p95: percentile(latency, 0.95),
      p99: percentile(latency, 0.99),
    },
  };
}

export function bucketAnalytics(events, bucketMs) {
  if (!Number.isSafeInteger(bucketMs) || bucketMs <= 0) throw new RangeError("Invalid bucket size");
  const buckets = new Map();
  for (const event of events) {
    const timestamp = Math.floor(event.time / bucketMs) * bucketMs;
    if (!buckets.has(timestamp)) buckets.set(timestamp, []);
    buckets.get(timestamp).push(event);
  }
  return [...buckets].sort(([a], [b]) => a - b).map(([time, rows]) => ({
    time: new Date(time).toISOString(),
    ...aggregateAnalytics(rows),
  }));
}

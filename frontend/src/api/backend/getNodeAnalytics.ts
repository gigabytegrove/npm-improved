import * as api from "./base";

export type NodeHours = 1 | 24 | 168 | 720 | 2160;
export type HttpStatusClass = "2xx" | "3xx" | "4xx" | "5xx";
export interface NodeFilters {
  hours: NodeHours;
  hostId?: number | null;
  statusClass?: HttpStatusClass | null;
}
export interface NodeBreakdown {
  label: string;
  requests: number;
  bytesOut: number;
}
export interface NodeHost {
  hostId: number;
  requests: number;
  bytesOut: number;
  bytesIn: number;
  errors: number;
  domains: string[];
  kind: "proxy" | "redirection" | "dead" | "default" | "fallback";
  routeId: number | null;
  configured: boolean;
  enabled: boolean | null;
}
export interface NodeReport {
  scope: "local-node";
  node: { name: string; id: string | null; role: string; version: string | null };
  hours: NodeHours;
  filters: { hostId: number | null; statusClass: HttpStatusClass | null };
  accuracy: "raw-events" | "hourly-rollup";
  granularity: "minute" | "hour" | "day";
  retainedRawDays: number;
  retainedRollupDays: number;
  requests: number;
  bytesOut: number;
  bytesIn: number;
  status: Record<string, number>;
  activeHosts: number;
  serverErrorRate: number;
  latencyMs: { samples: number; p50: number | null; p95: number | null; p99: number | null };
  firstSeen: string | null;
  lastSeen: string | null;
  lastIngestedAt: string | null;
  timeline: Array<{ at: string; requests: number; bytesOut: number; errors: number }>;
  hosts: NodeHost[];
  domains: NodeBreakdown[];
  methods: NodeBreakdown[];
  paths: NodeBreakdown[];
  protocols: NodeBreakdown[];
  devices: NodeBreakdown[];
  upstreams: NodeBreakdown[];
  statusCodes: NodeBreakdown[];
  streamTraffic: {
    sessions: number; bytesSent: number; bytesReceived: number; tcp: number; udp: number;
    accuracy: "raw-events" | "hourly-rollup";
    streams: Array<{ streamId: number; protocol: string; sessions: number; bytesSent: number; bytesReceived: number; incomingPort: number | null; configured: boolean }>;
    timeline: Array<{ at: string; sessions: number; bytesSent: number; bytesReceived: number }>;
    limitations: string;
  };
  slowPaths: Array<{ hostId: number; path: string; requests: number; averageMs: number; maxMs: number }>;
  errorPaths: Array<{ hostId: number; path: string; requests: number; serverErrors: number }>;
  limitations: { node: string; history: string; extended: string | null; visitors: string; coverage: string };
}
export interface NodeRequest {
  id: number;
  hostId: number;
  occurredAt: number;
  at: string;
  domain: string;
  method: string;
  path: string;
  protocol: string;
  status: number;
  bytesOut: number;
  bytesIn: number | null;
  durationMs: number | null;
  upstreamMs: number | null;
  upstreamStatus: string;
  device: string;
}
export interface NodeRequests {
  total: number;
  limit: number;
  offset: number;
  entries: NodeRequest[];
}
export async function getNodeAnalytics(filters: NodeFilters): Promise<NodeReport> {
  return api.get({ url: "/analytics/node", params: {
    hours: filters.hours,
    ...(filters.hostId ? { hostId: filters.hostId } : {}),
    ...(filters.statusClass ? { statusClass: filters.statusClass } : {}),
  }});
}
export async function getNodeAnalyticsRequests(
  filters: NodeFilters,
  offset = 0,
): Promise<NodeRequests> {
  return api.get({ url: "/analytics/node/requests", params: {
    hours: filters.hours,
    limit: 50,
    offset,
    ...(filters.hostId ? { hostId: filters.hostId } : {}),
    ...(filters.statusClass ? { statusClass: filters.statusClass } : {}),
  }});
}
export async function exportNodeAnalytics(filters: NodeFilters): Promise<void> {
  return api.download({ url: "/analytics/node/export", params: {
    hours: filters.hours,
    ...(filters.hostId ? { hostId: filters.hostId } : {}),
    ...(filters.statusClass ? { statusClass: filters.statusClass } : {}),
  } }, "npmi-node-analytics.csv");
}

import * as api from "./base";

export interface AnalyticsBreakdown {
  label: string;
  requests: number;
  bytesOut: number;
}

export interface HostAnalytics {
  hostId: number;
  hours: number;
  granularity: "minute" | "hour" | "day";
  accuracy: "raw-events" | "hourly-rollup";
  retainedRawDays: number;
  retainedRollupDays: number;
  requests: number;
  bytesOut: number;
  bytesIn: number;
  status: Record<string, number>;
  latencyMs: { samples: number; p50: number | null; p95: number | null; p99: number | null };
  timeline: { at: string; requests: number; bytesOut: number }[];
  domains: AnalyticsBreakdown[];
  methods: AnalyticsBreakdown[];
  paths: AnalyticsBreakdown[];
  devices: AnalyticsBreakdown[];
  upstreams: AnalyticsBreakdown[];
  limitations: {
    uniqueVisitors: string;
    countries: string;
    percentiles: string | null;
    history: string;
    scope: string;
  };
}

export interface AnalyticsRequest {
  id: number;
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

export interface HostAnalyticsRequests {
  total: number;
  limit: number;
  offset: number;
  entries: AnalyticsRequest[];
}

export async function getHostAnalytics(hostId: number, hours: number): Promise<HostAnalytics> {
  return api.get({ url: `/nginx/proxy-hosts/${hostId}/analytics`, params: { hours } });
}

export async function getHostAnalyticsRequests(
  hostId: number,
  hours: number,
  offset = 0,
  status: number | null = null,
): Promise<HostAnalyticsRequests> {
  return api.get({
    url: `/nginx/proxy-hosts/${hostId}/analytics/requests`,
    params: { hours, limit: 50, offset, ...(status === null ? {} : { status }) },
  });
}

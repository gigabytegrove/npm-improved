import * as api from "./base";

export type NodeHours = 1 | 24 | 168 | 720 | 2160;
export type HttpStatusClass = "2xx" | "3xx" | "4xx" | "5xx";
export interface NodeFilters {
  hours: NodeHours;
  hostId?: number | null;
  statusClass?: HttpStatusClass | null;
  ip?: string | null;
  userAgent?: string | null;
  bot?: string | null;
  connectionId?: string | null;
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
  uniqueIps: number | null;
  blockedRequests: number | null;
  ips: Array<{ ip: string; requests: number; bytesOut: number; errors: number; firstSeen: string; lastSeen: string }>;
  userAgents: NodeBreakdown[];
  bots: NodeBreakdown[];
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
  clientIp: string | null;
  peerIp: string | null;
  userAgent: string | null;
  requestId: string | null;
  connectionId: string | null;
  connectionRequests: number | null;
  scheme: string | null;
  tls: string | null;
  botClass: string | null;
  blockReason: string | null;
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
    ...(filters.ip ? { ip: filters.ip } : {}),
    ...(filters.userAgent ? { userAgent: filters.userAgent } : {}),
    ...(filters.bot ? { bot: filters.bot } : {}),
    ...(filters.connectionId ? { connectionId: filters.connectionId } : {}),
  }});
}
export async function exportNodeAnalytics(filters: NodeFilters): Promise<void> {
  return api.download({ url: "/analytics/node/export", params: {
    hours: filters.hours,
    ...(filters.hostId ? { hostId: filters.hostId } : {}),
    ...(filters.statusClass ? { statusClass: filters.statusClass } : {}),
    ...(filters.ip ? { ip: filters.ip } : {}),
    ...(filters.userAgent ? { userAgent: filters.userAgent } : {}),
    ...(filters.bot ? { bot: filters.bot } : {}),
    ...(filters.connectionId ? { connectionId: filters.connectionId } : {}),
  } }, "npmi-node-analytics.csv");
}

export interface NodeBlockRule {
  id: number;
  type: "ip" | "user_agent";
  target: string;
  note: string;
  createdAt: number;
  createdBy: string;
}
export interface NodeBlockAudit {
  id: number;
  action: string;
  type: string;
  target: string;
  operator: string;
  occurredAt: number;
}
export async function getNodeBlocks(): Promise<{rules: NodeBlockRule[]; audit: NodeBlockAudit[]}> {
  return api.get({ url: "/analytics/blocks" });
}
export async function addNodeBlock(type: NodeBlockRule["type"], target: string, note = ""): Promise<NodeBlockRule> {
  return api.post({ url: "/analytics/blocks", data: { type, target, note } });
}
export async function deleteNodeBlock(id: number): Promise<NodeBlockRule> {
  return api.del({ url: `/analytics/blocks/${id}` });
}
export async function enableNodeScannerPreset(): Promise<{added: number}> {
  return api.post({ url: "/analytics/blocks/scanner-presets", data: {} });
}

export interface ClientDimension {
  value: string | number | null;
  requests: number;
  firstSeen: string;
  lastSeen: string;
}
export interface NodeClientProfile {
  ip: string; scope: "local-node"; hours: NodeHours;
  requests: number;firstSeen:string|null;lastSeen:string|null;
  activeRoutes:number;distinctUserAgents:number;bytesOut:number;
  clientErrors:number;serverErrors:number;denied:number;
  trend:Array<{at:string;requests:number;errors:number;blocked:number}>;
  routes:ClientDimension[];
  userAgents:ClientDimension[];
  botClasses:ClientDimension[];
  methods:ClientDimension[];
  statusCodes:ClientDimension[];
  paths:ClientDimension[];
  limitations:string;
}
export async function getNodeClientProfile(ip:string,filters:NodeFilters):Promise<NodeClientProfile> {
  return api.get({url:"/analytics/node/client",params:{
    ip,hours:filters.hours,...(filters.hostId ? {hostId:filters.hostId}:{}),
  }});
}

export interface NodeAgentProfile {
  userAgent:string;scope:"local-node";hours:NodeHours;requests:number;
  uniqueIps:number;routes:number;errors:number;blocked:number;
  firstSeen:string|null;lastSeen:string|null;
  timeline:Array<{at:string;requests:number;errors:number;blocked:number}>;
  ips:ClientDimension[];routeBreakdown:ClientDimension[];
  paths:ClientDimension[];botClasses:ClientDimension[];
  statusCodes:ClientDimension[];limitations:string;
}
export async function getNodeAgentProfile(userAgent:string, filters:NodeFilters):Promise<NodeAgentProfile>{
  return api.get({url:"/analytics/node/agent",params:{
    userAgent,hours:filters.hours,...(filters.hostId?{hostId:filters.hostId}:{}),
  }});
}

export interface StreamSession {
  id:number;streamId:number;occurredAt:number;at:string;
  protocol:"TCP"|"UDP";status:number;bytesSent:number;bytesReceived:number;
  durationMs:number|null;clientIp:string|null;clientPort:number|null;
  listenPort:number|null;upstreamAddr:string|null;
}
export interface NodeStreamSessions {
  total:number;limit:number;offset:number;entries:StreamSession[];
}
export async function getNodeStreamSessions(args:{
  hours:NodeHours;streamId?:number|null;ip?:string|null;offset?:number;
}):Promise<NodeStreamSessions> {
  return api.get({url:"/analytics/node/streams/sessions",params:{
    hours:args.hours,limit:50,offset:args.offset||0,
    ...(args.streamId!==null&&args.streamId!==undefined?{streamId:args.streamId}:{}),
    ...(args.ip?{ip:args.ip}:{}),
  }});
}

export interface ScannerPolicy {
  enabled: boolean;
  activeSignatures: number;
  availableSignatures: number;
  signatures: string[];
  enforcement: "nginx-per-request";
}
export async function getScannerPolicy(): Promise<ScannerPolicy> {
  return api.get({url:"/analytics/blocks/scanner-policy"});
}
export async function setScannerPolicy(enabled:boolean): Promise<ScannerPolicy> {
  return api.put({url:"/analytics/blocks/scanner-policy",data:{enabled}});
}

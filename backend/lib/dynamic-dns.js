import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const directory = process.env.NPM_INSTANCE_SECURITY_DIR || "/data/instance-security";
const recordsPath = path.join(directory, "ddns-records.json");
const keyPath = path.join(directory, "ddns.key");
const providerInfo = Object.freeze([
  { id: "cloudflare", name: "Cloudflare", supports: ["A", "AAAA"], credentials: "API token + zone ID + DNS record ID" },
  { id: "duckdns", name: "DuckDNS", supports: ["A", "AAAA"], credentials: "Domain token" },
  { id: "noip", name: "No-IP", supports: ["A", "AAAA"], credentials: "DDNS Key username and password" },
  { id: "dynu", name: "Dynu", supports: ["A", "AAAA"], credentials: "IP update username and password" },
  { id: "he", name: "Hurricane Electric", supports: ["A", "AAAA"], credentials: "Dynamic DNS record hostname and generated key" },
  { id: "desec", name: "deSEC / dedyn.io", supports: ["A", "AAAA"], credentials: "Dedicated update token" },
  { id: "digitalocean", name: "DigitalOcean", supports: ["A", "AAAA"], credentials: "DNS API token, zone name and numeric DNS record ID" },
  { id: "namecheap", name: "Namecheap", supports: ["A"], credentials: "Enable Dynamic DNS; use the domain DDNS password and zone name" },
]);
const shortResponseLimit = 1000;
let cycle = null;

function atomicWrite(filename, content) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const tmp = filename + "." + crypto.randomUUID() + ".tmp";
  try {
    fs.writeFileSync(tmp, content, { flag: "wx", mode: 0o600 });
    fs.renameSync(tmp, filename);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* Cleanup cannot mask the original error. */ }
  }
}

function encryptionKey() {
  try {
    const key = fs.readFileSync(keyPath);
    if (key.length !== 32) throw new Error("Dynamic DNS key file is invalid.");
    return key;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { fs.writeFileSync(keyPath, crypto.randomBytes(32), { flag: "wx", mode: 0o600 }); }
    catch (creationError) { if (creationError.code !== "EEXIST") throw creationError; }
    return fs.readFileSync(keyPath);
  }
}

function seal(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}
function unseal(value) {
  const parts = value.split(".");
  if (parts.length !== 3) throw new Error("Stored Dynamic DNS credential is invalid.");
  const [iv, tag, payload] = parts.map((part) => Buffer.from(part, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
}

function readRecords() {
  try {
    const value = JSON.parse(fs.readFileSync(recordsPath, "utf8"));
    if (!Array.isArray(value) || value.length > 64) throw new Error("Invalid Dynamic DNS records file.");
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
function saveRecords(records) { atomicWrite(recordsPath, JSON.stringify(records, null, 2) + "\n"); }

export function listDynamicDNSProviders() { return providerInfo; }
export function listDynamicDNSRecords() {
  return readRecords().map(({ secret, ...row }) => ({ ...row, hasCredential: Boolean(secret) }));
}

function validateHostname(value) {
  if (typeof value !== "string" || value.length > 253 ||
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value)) {
    throw new RangeError("Provide a valid DNS hostname.");
  }
  return value.toLowerCase();
}
const identifier = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{4,128}$/.test(value) ? value : "";
function createInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new RangeError("Invalid Dynamic DNS record.");
  const provider = providerInfo.find((row) => row.id === input.provider);
  if (!provider) throw new RangeError("Choose a supported Dynamic DNS provider.");
  const recordType = input.recordType || input.record_type || "A";
  if (!provider.supports.includes(recordType)) throw new RangeError("Unsupported DNS record type.");
  const hostname = validateHostname(input.hostname);
  const originalHostname = input.hostname.trim();
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const secret = input.secret;
  if (typeof secret !== "string" || secret.length < 6 || secret.length > 1024) {
    throw new RangeError("A credential is required (6-1024 characters).");
  }
  if (["noip", "dynu"].includes(provider.id) && (!username || username.length > 200)) {
    throw new RangeError("A Dynamic DNS username is required.");
  }
  const zoneId = input.zoneId || input.zone_id || "";
  const dnsRecordId = input.dnsRecordId || input.dns_record_id || "";
  if (provider.id === "cloudflare" && (!identifier(zoneId) || !identifier(dnsRecordId))) {
    throw new RangeError("Cloudflare zone ID and DNS record ID are required.");
  }
  if (["digitalocean", "namecheap"].includes(provider.id)) {
    if (typeof zoneId !== "string" || !zoneId.trim()) throw new RangeError("DNS zone/domain name is required.");
    const zone = validateHostname(zoneId);
    if (hostname !== zone && !hostname.endsWith("." + zone)) {
      throw new RangeError("The DNS hostname must belong to the configured zone.");
    }
    if (provider.id === "digitalocean" && !/^\d{1,15}$/.test(String(dnsRecordId))) {
      throw new RangeError("DigitalOcean requires the numeric DNS record ID.");
    }
  }
  if (provider.id === "duckdns" && !hostname.endsWith(".duckdns.org")) {
    throw new RangeError("DuckDNS requires a duckdns.org hostname.");
  }
  return {
    id: crypto.randomUUID(), provider: provider.id, hostname, recordType,
    username, zoneId: ["cloudflare", "digitalocean", "namecheap"].includes(provider.id) ? zoneId.trim() : "",
    dnsRecordId: ["cloudflare", "digitalocean"].includes(provider.id) ? String(dnsRecordId) : "",
    updateHostname: provider.id === "namecheap" ? originalHostname : "",
    secret: seal(secret),
    enabled: true,
    lastIp: "", lastUpdatedAt: null, lastCheckedAt: null, lastError: null,
  };
}

export function addDynamicDNSRecord(input) {
  const rows = readRecords();
  if (rows.length >= 32) throw new RangeError("Dynamic DNS supports up to 32 records.");
  const row = createInput(input);
  if (rows.some((old) => old.provider === row.provider && old.hostname === row.hostname && old.recordType === row.recordType)) {
    throw new RangeError("That provider, hostname, and record type are already configured.");
  }
  rows.push(row);
  saveRecords(rows);
  return listDynamicDNSRecords().find((entry) => entry.id === row.id);
}
export function deleteDynamicDNSRecord(id) {
  const rows = readRecords();
  const filtered = rows.filter((row) => row.id !== id);
  if (filtered.length === rows.length) return false;
  saveRecords(filtered);
  return true;
}

function publiclyRoutable(ip, version) {
  if (net.isIP(ip) !== version) return false;
  if (version === 6) return /^[23][0-9a-f]/i.test(ip) && !ip.toLowerCase().startsWith("2001:db8");
  const octets = ip.split(".").map(Number);
  const [a, b, c] = octets;
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 ||
    a === 192 && (b === 168 || b === 0 && c === 0 || b === 0 && c === 2) ||
    a === 100 && b >= 64 && b <= 127 ||
    a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
    a === 203 && b === 0 && c === 113
  );
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options, redirect: "error", signal: AbortSignal.timeout(8500),
    headers: { "User-Agent": "NPM-Improved/1.0 (github.com/gigabytegrove/npm-improved)", ...options.headers },
  });
  const text = (await response.text()).slice(0, shortResponseLimit);
  if (!response.ok) throw new Error("Provider endpoint returned HTTP " + response.status);
  return text;
}

async function discoverPublicIp(version) {
  const sources = version === 4
    ? ["https://api.ipify.org", "https://checkip.amazonaws.com", "https://ipv4.icanhazip.com"]
    : ["https://api6.ipify.org", "https://ipv6.icanhazip.com", "https://v6.ident.me"];
  const candidates = await Promise.all(sources.map(async (url) => {
    try {
      const ip = (await fetchText(url)).trim();
      return publiclyRoutable(ip, version) ? ip : null;
    } catch { return null; }
  }));
  const counts = new Map();
  for (const ip of candidates.filter(Boolean)) counts.set(ip, (counts.get(ip) || 0) + 1);
  for (const [ip, count] of counts) if (count >= 2) return ip;
  throw new Error("Public IPv" + version + " address could not be verified by two independent detectors.");
}

function basic(username, password) {
  return "Basic " + Buffer.from(username + ":" + password).toString("base64");
}

async function updateProvider(row, ip) {
  const host = row.hostname;
  const credential = unseal(row.secret);
  const version = row.recordType === "AAAA" ? 6 : 4;
  let url;
  let options = {};
  if (row.provider === "digitalocean") {
    url = "https://api.digitalocean.com/v2/domains/" + encodeURIComponent(row.zoneId) +
      "/records/" + encodeURIComponent(row.dnsRecordId);
    options = {
      method: "PATCH",
      headers: { Authorization: "Bearer " + credential, "Content-Type": "application/json" },
      body: JSON.stringify({ data: ip }),
    };
    const result = JSON.parse(await fetchText(url, options));
    if (result?.domain_record?.data !== ip) throw new Error("DigitalOcean did not confirm the DNS update.");
    return;
  }
  if (row.provider === "namecheap") {
    url = new URL("https://dynamicdns.park-your-domain.com/update");
    const originalName = row.updateHostname || row.hostname;
    const parent = row.zoneId;
    const shortHost = originalName.toLowerCase() === parent.toLowerCase() ? "@" : originalName.slice(0, -(parent.length + 1));
    url.searchParams.set("host", shortHost);
    url.searchParams.set("domain", parent);
    url.searchParams.set("password", credential);
    url.searchParams.set("ip", ip);
    const reply = await fetchText(url);
    if (!/<ErrCount>\s*0\s*<\/ErrCount>/i.test(reply) || !/<Done>\s*true\s*<\/Done>/i.test(reply)) {
      throw new Error("Namecheap rejected the DNS update.");
    }
    return;
  }
  if (row.provider === "cloudflare") {
    url = "https://api.cloudflare.com/client/v4/zones/" + encodeURIComponent(row.zoneId) +
      "/dns_records/" + encodeURIComponent(row.dnsRecordId);
    options = {
      method: "PATCH",
      headers: { Authorization: "Bearer " + credential, "Content-Type": "application/json" },
      body: JSON.stringify({ type: row.recordType, name: host, content: ip }),
    };
    const result = JSON.parse(await fetchText(url, options));
    if (result.success !== true) throw new Error("Cloudflare rejected the DNS update.");
    return;
  }
  if (row.provider === "duckdns") {
    const name = host.slice(0, -".duckdns.org".length);
    url = new URL("https://www.duckdns.org/update");
    url.searchParams.set("domains", name);
    url.searchParams.set("token", credential);
    url.searchParams.set("ip", ip);
    const response = await fetchText(url);
    if (!response.trim().startsWith("OK")) throw new Error("DuckDNS rejected the update.");
    return;
  }
  if (row.provider === "desec") {
    url = new URL("https://update.dedyn.io/");
    url.searchParams.set("hostname", host);
    url.searchParams.set(version === 4 ? "myipv4" : "myipv6", ip);
    url.searchParams.set(version === 4 ? "myipv6" : "myipv4", "preserve");
    options.headers = { Authorization: "Token " + credential };
  } else {
    const endpoint = row.provider === "noip" ? "https://dynupdate.no-ip.com/nic/update"
      : row.provider === "dynu" ? "https://api.dynu.com/nic/update"
        : "https://dyn.dns.he.net/nic/update";
    url = new URL(endpoint);
    url.searchParams.set("hostname", host);
    url.searchParams.set(row.provider === "dynu" && version === 6 ? "myipv6" : "myip", ip);
    if (row.provider === "dynu") url.searchParams.set(version === 4 ? "myipv6" : "myip", "no");
    const user = row.provider === "he" ? host : row.username;
    options.headers = { Authorization: basic(user, credential) };
  }
  const response = (await fetchText(url, options)).trim();
  if (!/^(good|nochg)(?:\s|$)/i.test(response)) throw new Error("Dynamic DNS provider rejected the update.");
}

export async function refreshDynamicDNS({ force = false } = {}) {
  if (cycle) return cycle;
  cycle = (async () => {
    const rows = readRecords();
    const enabled = rows.filter((row) => row.enabled);
    if (!enabled.length) return { records: listDynamicDNSRecords(), refreshed: 0 };
    const versions = new Set(enabled.map((row) => row.recordType === "AAAA" ? 6 : 4));
    const addresses = {};
    for (const version of versions) {
      try { addresses[version] = await discoverPublicIp(version); }
      catch { addresses[version] = null; }
    }
    let refreshed = 0;
    for (const row of enabled) {
      const version = row.recordType === "AAAA" ? 6 : 4;
      const ip = addresses[version];
      row.lastCheckedAt = new Date().toISOString();
      if (!ip) {
        row.lastError = "Public IPv" + version + " address could not be verified.";
        continue;
      }
      const aging = !row.lastUpdatedAt || Date.now() - Date.parse(row.lastUpdatedAt) > 86400000;
      if (!force && ip === row.lastIp && !row.lastError && !aging) continue;
      try {
        await updateProvider(row, ip);
        row.lastIp = ip;
        row.lastUpdatedAt = new Date().toISOString();
        row.lastError = null;
        refreshed++;
      } catch {
        row.lastError = "Provider update failed; check the credential and provider record settings.";
      }
    }
    // Avoid resurrecting records removed during a network request. Persist
    // only status fields for records that still exist in the latest inventory.
    const latest = readRecords();
    for (const row of latest) {
      const result = rows.find((candidate) => candidate.id === row.id);
      if (result && row.secret === result.secret) {
        row.lastIp = result.lastIp;
        row.lastCheckedAt = result.lastCheckedAt;
        row.lastUpdatedAt = result.lastUpdatedAt;
        row.lastError = result.lastError;
      }
    }
    saveRecords(latest);
    return { records: listDynamicDNSRecords(), refreshed };
  })();
  try { return await cycle; } finally { cycle = null; }
}

export function startDynamicDNS() {
  const timer = setInterval(() => {
    void refreshDynamicDNS().catch(() => {});
  }, 5 * 60 * 1000);
  timer.unref?.();
  const first = setTimeout(() => { void refreshDynamicDNS().catch(() => {}); }, 30 * 1000);
  first.unref?.();
}

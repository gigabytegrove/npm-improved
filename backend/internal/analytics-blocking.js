import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getAnalyticsDatabase } from "./proxy-analytics.js";

// Rules and events remain local to the current proxy node.
const DIR = process.env.NPM_ANALYTICS_POLICY_DIR || "/data/nginx/analytics";
const IP_FILE = path.join(DIR, "blocked-ip-rules.conf");
const UA_FILE = path.join(DIR, "blocked-ua-rules.conf");
const containsControl = (value) => [...value].some((ch) => {
  const code = ch.charCodeAt(0);
  return code < 32 || code === 127;
});


export function validateBlockTarget(type, input) {
  if (typeof input !== "string" || !input.trim()) throw new RangeError("A block target is required");
  const target = input.trim();
  if (type === "ip") {
    const [ip, mask, extra] = target.split("/");
    const family = net.isIP(ip);
    if (!family || extra !== undefined || (mask !== undefined && !/^\d{1,3}$/.test(mask)))
      throw new RangeError("Enter an IPv4/IPv6 address or CIDR");
    if (mask !== undefined && Number(mask) > (family === 4 ? 32 : 128))
      throw new RangeError("Invalid CIDR prefix");
    if (mask === "0") throw new RangeError("A zero-prefix network block is not permitted");
    return mask === undefined ? ip : `${ip}/${Number(mask)}`;
  }
  if (type === "user_agent") {
    if (target.length > 160 || containsControl(target))
      throw new RangeError("User-agent patterns must be 1-160 printable characters");
    return target;
  }
  throw new RangeError("Only IP/CIDR and user-agent blocks are supported");
}

export function renderBlockPolicy(rules) {
  const ips = [];
  const agents = [];
  for (const rule of rules) {
    const value = validateBlockTarget(rule.type, rule.target);
    if (rule.type === "ip") ips.push(`    ${value} 1;`);
    else {
      // Literal substring match, case insensitive; no arbitrary regex/code.
      const escaped = [...value].map((ch) => /[a-zA-Z0-9_-]/.test(ch)
        ? ch : `\\${ch}`).join("");
      agents.push(`    "~*${escaped.replace(/"/g, '\\"')}" 1;`);
    }
  }
  return {
    ip: `# NPMi local node IP denies\n${ips.join("\n")}\n`,
    ua: `# NPMi local node user-agent denies\n${agents.join("\n")}\n`,
  };
}

function database() {
  const db = getAnalyticsDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS analytics_block_rule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('ip','user_agent')),
    target TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, created_by TEXT NOT NULL,
    UNIQUE(type,target));
    CREATE TABLE IF NOT EXISTS analytics_block_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL, type TEXT NOT NULL, target TEXT NOT NULL,
    operator TEXT NOT NULL, occurred_at INTEGER NOT NULL)`);
  return db;
}
export function listNodeBlockRules() {
  return database().prepare("SELECT * FROM analytics_block_rule ORDER BY created_at DESC,id DESC").all();
}
function atomicWrite(filename, value) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o750 });
  const temp = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temp, value, { mode: 0o640 });
  fs.renameSync(temp, filename);
}
function activate(rules) {
  const files = [IP_FILE, UA_FILE];
  const before = files.map((f) => fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);
  const rendered = renderBlockPolicy(rules);
  try {
    atomicWrite(IP_FILE, rendered.ip);
    atomicWrite(UA_FILE, rendered.ua);
    execFileSync("/usr/sbin/nginx", ["-t"], { stdio: "pipe" });
    execFileSync("/usr/sbin/nginx", ["-s", "reload"], { stdio: "pipe" });
  } catch (error) {
    files.forEach((file, i) => {
      try {
        if (before[i] === null) fs.rmSync(file, { force: true });
        else atomicWrite(file, before[i]);
      } catch { /* preserve original error */ }
    });
    throw new Error(`Nginx rule activation failed; old policy restored: ${error.message}`);
  }
}
export function initializeNodeBlocking() { activate(listNodeBlockRules()); }
export function addNodeBlockRule({ type, target, note = "", operator }) {
  const normalized = validateBlockTarget(type, target);
  if (typeof note !== "string" || note.length > 256 || containsControl(note))
    throw new RangeError("Invalid rule note");
  if (!/^[0-9]{1,12}$/.test(String(operator || "")))
    throw new RangeError("Invalid administrator");
  const db = database();
  const current = listNodeBlockRules();
  if (current.length >= 1000) throw new RangeError("Maximum 1000 rules per node");
  if (current.some((row) => row.type === type && row.target === normalized))
    throw new RangeError("Rule already exists");
  activate([...current, { type, target: normalized }]);
  try {
    return db.transaction(() => {
      const now = Math.floor(Date.now() / 1000);
      const result = db.prepare(`INSERT INTO analytics_block_rule
        (type,target,note,created_at,created_by) VALUES (?,?,?,?,?)`)
        .run(type, normalized, note, now, String(operator));
      db.prepare(`INSERT INTO analytics_block_audit
        (action,type,target,operator,occurred_at) VALUES ('add',?,?,?,?)`)
        .run(type, normalized, String(operator), now);
      return { id: Number(result.lastInsertRowid), type, target: normalized, note, created_at: now };
    })();
  } catch (error) { activate(current); throw error; }
}
export function deleteNodeBlockRule(id, operator) {
  if (!Number.isSafeInteger(id) || id < 1) throw new RangeError("Invalid rule ID");
  if (!/^[0-9]{1,12}$/.test(String(operator || ""))) throw new RangeError("Invalid administrator");
  const db = database();
  const current = listNodeBlockRules();
  const row = current.find((r) => r.id === id);
  if (!row) throw new RangeError("Rule does not exist");
  activate(current.filter((r) => r.id !== id));
  try {
    db.transaction(() => {
      db.prepare("DELETE FROM analytics_block_rule WHERE id=?").run(id);
      db.prepare(`INSERT INTO analytics_block_audit
      (action,type,target,operator,occurred_at) VALUES ('remove',?,?,?,?)`)
        .run(row.type, row.target, String(operator), Math.floor(Date.now() / 1000));
    })();
  } catch (error) { activate(current); throw error; }
  return row;
}
export function getNodeBlockAudit() {
  return database().prepare("SELECT * FROM analytics_block_audit ORDER BY id DESC LIMIT 100").all();
}

/**
 * Explicit opt-in scanner-signature policy. Search-engine crawler UAs are NOT
 * included: UA strings are forgeable and blocking verified crawlers is risky.
 */
export const SCANNER_UA_SIGNATURES = Object.freeze([
  "masscan", "zgrab", "sqlmap", "nuclei", "nikto", "dirbuster", "gobuster",
  "wpscan", "acunetix", "nessus", "openvas",
]);
export function enableKnownScannerBlocking(operator) {
  if (!/^[0-9]{1,12}$/.test(String(operator || "")))
    throw new RangeError("Invalid administrator");
  const current = listNodeBlockRules();
  const additions = SCANNER_UA_SIGNATURES.filter((target) =>
    !current.some((row) => row.type === "user_agent" && row.target === target))
    .map((target) => ({ type: "user_agent", target }));
  if (current.length + additions.length > 1000) throw new RangeError("Too many rules");
  if (!additions.length) return { added: 0 };
  activate([...current, ...additions]);
  try {
    return database().transaction(() => {
      const now = Math.floor(Date.now() / 1000);
      for (const row of additions) {
        database().prepare(`INSERT INTO analytics_block_rule
          (type,target,note,created_at,created_by) VALUES (?,?,?,?,?)`)
          .run("user_agent", row.target, "Known scanner signature (opt-in)", now, String(operator));
        database().prepare(`INSERT INTO analytics_block_audit
          (action,type,target,operator,occurred_at) VALUES ('add',?,?,?,?)`)
          .run("user_agent", row.target, String(operator), now);
      }
      return { added: additions.length };
    })();
  } catch (error) { activate(current); throw error; }
}

/**
 * Persistent scanner policy: enabling installs signatures as Nginx maps,
 * so each *future* request is denied automatically without polling or
 * running a separate protection container. No search crawlers are blocked.
 * Disabling only removes preset-owned rules and retains manual blocks.
 */
export function getKnownScannerPolicy() {
  const all = listNodeBlockRules();
  const owned = all.filter((rule) => rule.type === "user_agent" &&
    rule.note === "Known scanner signature (opt-in)" &&
    SCANNER_UA_SIGNATURES.includes(rule.target));
  return {
    enabled: owned.length > 0,
    active_signatures: owned.length,
    available_signatures: SCANNER_UA_SIGNATURES.length,
    signatures: [...SCANNER_UA_SIGNATURES],
    enforcement: "nginx-per-request",
  };
}

export function setKnownScannerPolicy(enabled, operator) {
  if (typeof enabled !== "boolean") throw new RangeError("Invalid policy state");
  if (!/^[0-9]{1,12}$/.test(String(operator || "")))
    throw new RangeError("Invalid administrator");
  if (enabled) return { ...enableKnownScannerBlocking(operator), ...getKnownScannerPolicy() };
  const current = listNodeBlockRules();
  const owned = current.filter((rule) =>
    rule.type === "user_agent" &&
    rule.note === "Known scanner signature (opt-in)" &&
    SCANNER_UA_SIGNATURES.includes(rule.target));
  if (!owned.length) return { removed: 0, ...getKnownScannerPolicy() };
  const ids = new Set(owned.map((row) => row.id));
  activate(current.filter((row) => !ids.has(row.id)));
  try {
    database().transaction(() => {
      const now = Math.floor(Date.now() / 1000);
      for (const row of owned) {
        database().prepare("DELETE FROM analytics_block_rule WHERE id=?").run(row.id);
        database().prepare(`INSERT INTO analytics_block_audit
          (action,type,target,operator,occurred_at) VALUES ('remove',?,?,?,?)`)
          .run(row.type, row.target, String(operator), now);
      }
    })();
  } catch (error) { activate(current); throw error; }
  return { removed: owned.length, ...getKnownScannerPolicy() };
}

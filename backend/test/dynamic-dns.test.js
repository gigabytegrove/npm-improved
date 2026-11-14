import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "npmi-dynamic-dns-"));
process.env.NPM_INSTANCE_SECURITY_DIR = directory;
const ddns = await import("../lib/dynamic-dns.js");

test("supported providers are explicit and fixed", () => {
  const providers = ddns.listDynamicDNSProviders();
  assert.deepEqual(providers.map((p) => p.id), ["cloudflare", "duckdns", "noip", "dynu", "he", "desec", "digitalocean", "namecheap"]);
  assert.equal(providers.every((p) => p.supports.includes("A")), true);
  assert.deepEqual(providers.find((p) => p.id === "namecheap").supports, ["A"]);
});

test("sensitive credentials are encrypted at rest and redacted from API results", () => {
  const hostname = "server.example.com";
  const record = ddns.addDynamicDNSRecord({
    provider: "cloudflare", hostname, recordType: "A",
    secret: "example-secret-123456", zoneId: "1234567890abcdef",
    dnsRecordId: "abcdef1234567890",
  });
  const disk = fs.readFileSync(path.join(directory, "ddns-records.json"), "utf8");
  assert.equal(disk.includes("example-secret-123456"), false);
  assert.equal(record.hostname, hostname);
  assert.equal(record.secret, undefined);
  assert.equal(record.hasCredential, true);
  assert.equal(ddns.listDynamicDNSRecords().length, 1);
  assert.equal(ddns.deleteDynamicDNSRecord(record.id), true);
  assert.equal(ddns.listDynamicDNSRecords().length, 0);
});

test("rejects credentials missing and duplicate records", () => {
  assert.throws(() => ddns.addDynamicDNSRecord({
    provider: "duckdns", hostname: "site.duckdns.org", secret: "x",
  }), RangeError);
  const row = ddns.addDynamicDNSRecord({
    provider: "duckdns", hostname: "site.duckdns.org", secret: "valid-token-value",
  });
  assert.throws(() => ddns.addDynamicDNSRecord({
    provider: "duckdns", hostname: "site.duckdns.org", secret: "another-token",
  }), RangeError);
  assert.equal(ddns.deleteDynamicDNSRecord(row.id), true);
});

test("DigitalOcean and Namecheap validate ownership and record capabilities", () => {
  assert.throws(() => ddns.addDynamicDNSRecord({
    provider: "digitalocean", hostname: "app.example.net", zoneId: "example.com",
    dnsRecordId: "12345", secret: "provider-token-xyz",
  }), RangeError);
  assert.throws(() => ddns.addDynamicDNSRecord({
    provider: "namecheap", hostname: "app.example.com", zoneId: "example.com",
    recordType: "AAAA", secret: "namecheap-secret-abc",
  }), RangeError);
  const row = ddns.addDynamicDNSRecord({
    provider: "digitalocean", hostname: "app.example.com", zoneId: "example.com",
    dnsRecordId: "12345", secret: "provider-token-xyz",
  });
  assert.equal(row.zoneId, "example.com");
  assert.equal(row.dnsRecordId, "12345");
  assert.equal(ddns.deleteDynamicDNSRecord(row.id), true);
});

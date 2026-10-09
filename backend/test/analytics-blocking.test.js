import assert from "node:assert/strict";
import test from "node:test";
import { validateBlockTarget, renderBlockPolicy, SCANNER_UA_SIGNATURES } from "../internal/analytics-blocking.js";

test("IP and IPv6 blocks accept only valid host addresses / bounded CIDR", () => {
  assert.equal(validateBlockTarget("ip", "203.0.113.25"), "203.0.113.25");
  assert.equal(validateBlockTarget("ip", "2001:db8::2/64"), "2001:db8::2/64");
  assert.equal(validateBlockTarget("ip", "192.0.2.0/24"), "192.0.2.0/24");
  assert.throws(() => validateBlockTarget("ip", "0.0.0.0/0"), RangeError);
  assert.throws(() => validateBlockTarget("ip", "2001:db8::/129"), RangeError);
  assert.throws(() => validateBlockTarget("ip", "10.0.0.1; return 200"), RangeError);
  assert.throws(() => validateBlockTarget("ip", "x.y.z"), RangeError);
});
test("user-agent rule values are literals; reject multiline directives", () => {
  assert.equal(validateBlockTarget("user_agent", "BadCrawler/1.0"), "BadCrawler/1.0");
  assert.throws(() => validateBlockTarget("user_agent", "bot\nreturn 200;"), RangeError);
  assert.throws(() => validateBlockTarget("user_agent", "  "), RangeError);
  const result = renderBlockPolicy([
    { type: "ip", target: "192.0.2.0/24" },
    { type: "user_agent", target: "FakeBot/1.2" },
  ]);
  assert.match(result.ip, /192\.0\.2\.0\/24 1;/);
  assert.match(result.ua, /FakeBot/);
  assert.ok(!result.ua.includes("return 200"));
});
test("scanner preset is explicit and excludes legitimate crawlers", () => {
  assert.ok(SCANNER_UA_SIGNATURES.includes("sqlmap"));
  assert.ok(SCANNER_UA_SIGNATURES.includes("nuclei"));
  assert.ok(!SCANNER_UA_SIGNATURES.includes("googlebot"));
  assert.ok(!SCANNER_UA_SIGNATURES.includes("bingbot"));
});

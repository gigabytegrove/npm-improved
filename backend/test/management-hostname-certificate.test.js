import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateNodeCertificateName } from "../lib/management-hostname-validation.js";

describe("optional node management certificate hostname", () => {
    it("accepts the matching node's public FQDN, case insensitive", () => {
        assert.equal(validateNodeCertificateName("proxy1", "Proxy1.GigabyteGrove.Net"),
            "proxy1.gigabytegrove.net");
        assert.equal(validateNodeCertificateName("proxy2", "proxy2.gigabytegrove.net."),
            "proxy2.gigabytegrove.net");
    });
    it("rejects names of other nodes and arbitrary domains", () => {
        for (const name of [
            "proxy2.gigabytegrove.net", "gigabytegrove.net", "example.org",
            "*.gigabytegrove.net", "proxy1..gigabytegrove.net",
            "proxy1.gigabytegrove.net/path", "proxy1.local", "proxy1.127.0.0.1",
        ]) {
            assert.throws(() => validateNodeCertificateName("proxy1", name), {status:400});
        }
    });
    it("fails closed without trustworthy physical node identity", () => {
        assert.throws(() => validateNodeCertificateName(null, "proxy1.gigabytegrove.net"));
        assert.throws(() => validateNodeCertificateName("proxy_1", "proxy_1.gigabytegrove.net"));
    });
});

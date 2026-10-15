import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderManagementHttps } from "../lib/management-https-render.js";

describe("optional management HTTPS virtual host", () => {
    it("serves exact node hostname on 443 and proxies to plain HTTP management port", () => {
        const config = renderManagementHttps({
            hostname: "proxy1.gigabytegrove.net", certificateId: 99, adminPort: 81
        });
        assert.match(config, /server_name proxy1\.gigabytegrove\.net;/);
        assert.match(config, /listen 443 ssl;/);
        assert.match(config, /ssl_certificate \/etc\/letsencrypt\/live\/npm-99\/fullchain\.pem;/);
        assert.match(config, /proxy_pass http:\/\/127\.0\.0\.1:81;/);
        assert.match(config, /proxy_set_header X-Forwarded-Proto https;/);
        assert.doesNotMatch(config, /default_server|ssl_reject_handshake|listen 81|return 301/);
    });
    it("uses configured local backend admin port", () => {
        assert.match(renderManagementHttps({
            hostname: "proxy2.gigabytegrove.net", certificateId: 4, adminPort: 8181
        }), /proxy_pass http:\/\/127\.0\.0\.1:8181;/);
    });
    it("rejects invalid hostname, certificate ID and port", () => {
        for (const hostname of ["proxy1;return 200", "proxy1..example.com",
            "*.example.com", "proxy1.example.com/other", "example",
            "proxy1.example.com\nreturn 200;"]) {
            assert.throws(() => renderManagementHttps({ hostname, certificateId: 1 }));
        }
        for (const certificateId of [0, -1, "1 /etc/shadow", 2.5]) {
            assert.throws(() => renderManagementHttps({
                hostname: "proxy1.example.com", certificateId
            }));
        }
        for (const adminPort of [0, 80, 443, 65536, "81;return 200"]) {
            assert.throws(() => renderManagementHttps({
                hostname: "proxy1.example.com", certificateId: 1, adminPort
            }));
        }
    });
});

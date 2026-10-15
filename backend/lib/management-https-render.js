/**
 * Generate a host-specific, opt-in TLS vhost on the NPMi Nginx 443 listener.
 * The HTTP management recovery listener remains on port 81.
 */
export function renderManagementHttps({ hostname, certificateId, adminPort = 81 }) {
    const host = String(hostname || "").trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) ||
        host.length > 253 || host.includes("..") || host.split(".").length < 3 ||
        host.split(".").some(label => label.length > 63 ||
            !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
        throw new Error("Invalid management hostname");
    }
    const id = Number(certificateId);
    const port = Number(adminPort);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid certificate ID");
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535 ||
        port === 80 || port === 443) throw new Error("Invalid backend management listener port");
    return [
        "# NPM Improved exact-SNI management HTTPS — generated, do not edit",
        "server {",
        "    listen 443 ssl;",
        "    listen [::]:443 ssl;",
        "    server_name " + host + ";",
        "    ssl_certificate /etc/letsencrypt/live/npm-" + id + "/fullchain.pem;",
        "    ssl_certificate_key /etc/letsencrypt/live/npm-" + id + "/privkey.pem;",
        "    include conf.d/include/ssl-ciphers.conf;",
        "    include conf.d/include/ssl-cache.conf;",
        "    access_log /data/logs/management-https-access.log combined;",
        "    error_log /data/logs/management-https-error.log warn;",
        "    location / {",
        "        proxy_pass http://127.0.0.1:" + port + ";",
        "        proxy_http_version 1.1;",
        "        proxy_set_header Host $host;",
        "        proxy_set_header X-Forwarded-Host $host;",
        "        proxy_set_header X-Forwarded-Proto https;",
        "        proxy_set_header X-Forwarded-Scheme https;",
        "        proxy_set_header X-Real-IP $remote_addr;",
        "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
        "        proxy_set_header Upgrade $http_upgrade;",
        "        proxy_set_header Connection upgrade;",
        "    }",
        "}",
        "",
    ].join("\n");
}

# NPM Improved for Android — native Kotlin / Compose

Native Android app developed alongside the NPM Improved server, with no WebView, HTML-rendered UI, embedded server, or cloud proxy.

**Status:** v0.1.0-alpha.4 development build (separate from the NPMi server v1.6.11 release).

## Current scope

- Multiple independent NPMi server profiles and server switching.
- Direct connection to `/api`, verified login at `/api/tokens` and 2FA challenge at `/api/tokens/2fa`.
- Token-only AES-256-GCM encrypted storage using an Android Keystore key. Passwords and 2FA challenges never persisted.
- Native Compose Dashboard, Proxy Hosts, Host Traffic, and Security screens.
- 5/15/60-minute live event investigation from the v1.6.11 API, local-node identity, source IP, claimed user agents, paths, client signals and blocking preparation.
- Existing **node-wide** IP/UA denial rules with deliberate administrator confirmation. Host-scoped blocking is **not yet** in the backend and is not simulated by the app.
- Host enable/disable management on primary/standalone nodes with user confirmation.

## Management API layout

The control-plane HTTP server listens on port 81 by default and serves the native web Control Center and `/api/`. It forwards API requests internally to the Node.js backend at `http://127.0.0.1:3000`. Public website listeners 80 and 443 are separate from that API endpoint unless the owner deliberately sets up an HTTPS management reverse proxy.

The control-plane endpoint `/api` returns a 302 redirect to `/api/`. The Android app intentionally does not follow redirects with credentials, so the health probe must request **`/api/` directly**. This regression is fixed in alpha.4, with automated tests for the API root, login, 2FA and traffic paths.

## Management connection and port 81

The app takes one server URL or IP and sends **all** management requests to that host's **port 81** under \`/api\`. It never assumes the normal website proxy port 443 is the API.

Examples:
- \`https://proxy.example.com/\` → \`https://proxy.example.com:81/api\`
- \`proxy.example.com\` → \`https://proxy.example.com:81/api\`
- \`redacted.invalid\` → \`http://redacted.invalid:81/api\` (explicit acknowledgement of HTTP)
- \`http://proxy.example.com/\` → \`http://proxy.example.com:81/api\` (explicit acknowledgement)
- \`https://proxy.example.com:8443/\` → \`https://proxy.example.com:8443/api\` (explicit nonstandard management port)

**Transport is not silently changed.** NPMi normally serves port 81 over **HTTP**. An HTTPS URL uses TLS on port 81 and requires an HTTPS-enabled management listener, rather than silently exposing credentials over HTTP. If HTTPS on port 81 isn't configured, enter an appropriate HTTP URL and explicitly acknowledge the cleartext risk, preferably only from a trusted LAN/VPN.

The app probes \`GET /api/\` on the resolved management port before saving a new or edited profile. Existing alpha profiles without an explicit management port are migrated to port 81 on app startup; their former-origin access tokens are removed to avoid sending credentials to an unexpected origin.

## Security

Prefer `https://` with a trusted certificate. For users managing LAN-only instances by IP, HTTP requires explicit unencrypted-transport acknowledgement before connection. HTTP transmits session and password traffic without TLS; it is not safe on untrusted networks. Public internet HTTP is rejected. TLS certificate verification is never disabled. Network redirects are disabled to prevent token forwarding to another origin.

App data backups are disabled. The Android Keystore protects tokens at rest; sessions are separate per server. A 401 clears the active server's token only.

Analytics and security operations require the server's own permissions. NPMX read-only secondaries cannot be used to edit hosts; local node-wide blocking is independent of NPMX config sync.

## Build

Requires JDK 17, Gradle 9.6 and Android SDK platform 37.2.

```bash
cd android
gradle testDebugUnitTest assembleDebug
```

The GitHub Actions `NPMi Native Android CI` workflow builds and uploads a **versioned debug-signed APK** plus checksum. Debug builds are for testing only. They do not establish a production signing identity, and installing a different debug signing key may require uninstalling the prior build.

## Next implementation milestones

Editable host forms, certificate renewal/management, deeper request filters, user-configurable alert delivery, offline data cache, authenticated automatic token refresh, richer material-design charts, tablet layouts, and source-verified geography/ASN after corresponding server capabilities are implemented. No Android feature may falsely claim source-limited blocking or verified bot identities until the server supports them.

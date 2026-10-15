# NPM Improved for Android — native Kotlin / Compose

Native Android app developed alongside the NPM Improved server, with no WebView, HTML-rendered UI, embedded server, or cloud proxy.

**Status:** v0.1.0-alpha.2 development build (separate from the NPMi server v1.6.11 release).

## Current scope

- Multiple independent NPMi server profiles and server switching.
- Direct connection to `/api`, verified login at `/api/tokens` and 2FA challenge at `/api/tokens/2fa`.
- Token-only AES-256-GCM encrypted storage using an Android Keystore key. Passwords and 2FA challenges never persisted.
- Native Compose Dashboard, Proxy Hosts, Host Traffic, and Security screens.
- 5/15/60-minute live event investigation from the v1.6.11 API, local-node identity, source IP, claimed user agents, paths, client signals and blocking preparation.
- Existing **node-wide** IP/UA denial rules with deliberate administrator confirmation. Host-scoped blocking is **not yet** in the backend and is not simulated by the app.
- Host enable/disable management on primary/standalone nodes with user confirmation.

## Management connection and port 81

NPM Improved uses the standalone **control-plane server on port 81** for both the management interface and \`/api\`. By default, port 81 serves ordinary HTTP, not HTTPS. Proxy-host ports 80/443 are for published websites, and their default TLS server can reject unrecognized names before API authentication.

The app distinguishes two connection modes:

1. **Direct LAN** (default): enter a private IPv4 address (e.g. \`redacted.invalid\`). The app connects to \`http://redacted.invalid:81/api\`. It warns that HTTP is unencrypted and refuses public addresses. An explicitly mapped alternate admin port may be entered.
2. **HTTPS management gateway**: use a dedicated HTTPS hostname and configure the TLS reverse proxy to forward \`/api\` and the management UI to the NPMi control plane on port 81. The app uses the HTTPS URL exactly, without silently changing 443 to 81 or relaxing certificate validation.

The app probes \`GET /api\` to verify the NPMi API before saving new or edited server connections, and the login screen includes **Change management address / port** for existing profiles. TLS \`unrecognized_name\` alerts are explained as a potential management-vs-data-plane hostname mismatch rather than displayed as raw OpenSSL traces.

## Security

Prefer `https://` with a trusted certificate. For users managing LAN-only instances by IP, **HTTP is allowed only for RFC1918/private IPv4 or loopback**, and must be explicitly acknowledged when adding the server. HTTP transmits session and password traffic without TLS; it is not safe on untrusted networks. Public internet HTTP is rejected. TLS certificate verification is never disabled. Network redirects are disabled to prevent token forwarding to another origin.

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

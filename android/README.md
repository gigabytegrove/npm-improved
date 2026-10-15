# NPM Improved for Android — native Kotlin / Compose

Native Android app developed alongside the NPM Improved server, with no WebView, HTML-rendered UI, embedded server, or cloud proxy.

**Status:** v0.1.0-alpha.1 development build (separate from the NPMi server v1.6.11 release).

## Current scope

- Multiple independent NPMi server profiles and server switching.
- Direct connection to `/api`, verified login at `/api/tokens` and 2FA challenge at `/api/tokens/2fa`.
- Token-only AES-256-GCM encrypted storage using an Android Keystore key. Passwords and 2FA challenges never persisted.
- Native Compose Dashboard, Proxy Hosts, Host Traffic, and Security screens.
- 5/15/60-minute live event investigation from the v1.6.11 API, local-node identity, source IP, claimed user agents, paths, client signals and blocking preparation.
- Existing **node-wide** IP/UA denial rules with deliberate administrator confirmation. Host-scoped blocking is **not yet** in the backend and is not simulated by the app.
- Host enable/disable management on primary/standalone nodes with user confirmation.

## Security

Prefer `https://` with a trusted certificate. For users managing LAN-only instances by IP, **HTTP is allowed only for RFC1918/private IPv4 or loopback**, and must be explicitly acknowledged when adding the server. HTTP transmits session and password traffic without TLS; it is not safe on untrusted networks. Public internet HTTP is rejected. TLS certificate verification is never disabled. Network redirects are disabled to prevent token forwarding to another origin.

App data backups are disabled. The Android Keystore protects tokens at rest; sessions are separate per server. A 401 clears the active server's token only.

Analytics and security operations require the server's own permissions. NPMX read-only secondaries cannot be used to edit hosts; local node-wide blocking is independent of NPMX config sync.

## Build

Requires JDK 17, Gradle 9.4 and Android SDK platform 37.

```bash
cd android
gradle testDebugUnitTest assembleDebug
```

The GitHub Actions `NPMi Native Android CI` workflow builds and uploads a **versioned debug-signed APK** plus checksum. Debug builds are for testing only. They do not establish a production signing identity, and installing a different debug signing key may require uninstalling the prior build.

## Next implementation milestones

Editable host forms, certificate renewal/management, deeper request filters, user-configurable alert delivery, offline data cache, authenticated automatic token refresh, richer material-design charts, tablet layouts, and source-verified geography/ASN after corresponding server capabilities are implemented. No Android feature may falsely claim source-limited blocking or verified bot identities until the server supports them.

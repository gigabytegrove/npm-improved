# NPM Improved v1.7.0 security acceptance criteria

This branch is pre-release. None of the checks below may be represented as completed without evidence from the candidate image and a realistic deployment.

## Supply chain
- [x] Stop force-updating existing release tags and assets.
- [x] Reject an already published tag during release preflight.
- [x] Run native updater unit tests and a release immutability contract before release builds.
- [ ] Publish and independently verify signed release manifest covering image digest, host updater, SBOM and source commit.
- [ ] Pin running image by digest without breaking release discovery, same-version reinstall, or rollback.
- [ ] Confirm ARM64 and AMD64 manifests and anonymous retrieval from clean hosts.
- [ ] Produce SBOMs for actual final images and evaluate OS, NGINX, Go, Node and transitive packages.
- [ ] Reject high/critical exploitable vulnerabilities or document reviewed, expiring exceptions.
- [ ] Ensure all permissions and secrets in CI are scoped to the smallest necessary surface.

## Runtime and administration
- [ ] Exercise authorization boundaries on every settings, backup, certificate, and NPMX endpoint.
- [ ] Test auth failures, MFA recovery, session revocation, CSRF/origin protections and rate limits.
- [ ] Verify upload paths, archive extraction, user-controlled NGINX config and command inputs.
- [ ] Verify secrets redaction in diagnostics, audit events, backup exports and HTTP responses.
- [ ] Verify admin port binding guidance for existing installations and safer defaults for new installs.
- [ ] Audit container capabilities, mount permissions, image provenance and exposed listeners.

## Recovery and compatibility
- [ ] Test existing 1.6.15 to 1.7.0 upgrades across SQLite, PostgreSQL and MySQL.
- [ ] Test upgrades and native updater maintenance with network interruptions and low disk space.
- [ ] Test rollback after unhealthy container, invalid config, failed database migration and interrupted restarts.
- [ ] Test backup restore with independently validated checksums and secret rehydration.
- [ ] Verify NPMX secondary-first rolling upgrades, mismatched versions and revoked peers.
- [ ] Verify certificate renewal, streams, GeoIP2, custom NGINX config, HTTP/2 and supported HTTP/3.
- [ ] Confirm previous UI routes, navigation, light/dark behavior and API compatibility.

## Publication
- [ ] Update all semantic versions together to 1.7.0 once acceptance testing succeeds.
- [ ] Publish complete release notes and migration guidance, not solely a changelog link.
- [ ] Build and independently verify actual published image artifacts.
- [ ] Publish the single 1.7.0 stable release only after every mandatory safety gate passes.

Security acceptance is evidence-based; successful builds alone do not prove compromise resistance.

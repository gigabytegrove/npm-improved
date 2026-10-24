# Security Policy

## Supported versions

NPM Improved publishes stable release tags. The currently supported security-maintenance target is the newest published stable release. Older stable releases do not receive guaranteed security backports; administrators should upgrade promptly. Development branches and unpublished builds are not supported for production deployments.

| Release | Security support |
| --- | --- |
| Latest published stable release | Security maintenance target |
| Earlier stable releases | Upgrade to latest; no guaranteed backports |
| Development branches or untagged builds | Not supported for production |
| Upstream Nginx Proxy Manager | Maintained by its upstream project |

This statement does not imply that any release is free of vulnerabilities. Review GitHub releases and security advisories before deployment.

## Private vulnerability reporting

Do not disclose unpatched vulnerabilities in public issues, pull requests, or discussions.

Submit a private report at https://github.com/gigabytegrove/npm-improved/security/advisories/new. Provide affected version or image digest, reproduction steps, impact and sanitized logs. Never include production credentials, tokens, certificate keys, database passwords or JWT secrets.

The maintainers will triage incoming reports and coordinate fixes and disclosures according to impact and available remediation. No fixed response-time SLA is offered.

## Release integrity

Published release tags and assets must not be overwritten. Corrections require a new version and release. Administrators should prefer pinned immutable image digests and validate independently authenticated release provenance, in addition to checksum verification. SHA-256 checksum files hosted beside their archives verify consistency but do not independently authenticate the publisher.

## Supported deployment practice

Restrict the administrative port to trusted networks, enforce strong unique administrator credentials and MFA where available, protect `/data` and private certificate material, encrypt off-host backups, test restores, and keep the host OS and Docker runtime patched. Expose only explicitly required proxy ports. Check installed runtime and image digests after updates.

## Upstream coordination

If a vulnerability is also present upstream, report it privately to the upstream project as appropriate. NPM Improved may apply its own mitigations or patches.

# Security Policy

## Current support status

NPM Improved is currently pre-1.0 development software.

Until the first stable release is published, security fixes are made against the current `develop` line. There is not yet a supported historical release matrix or an official stable NPM Improved container tag.

| Version / branch | Security support |
| --- | --- |
| Current `develop` | Active development |
| Pre-1.0 snapshots older than current `develop` | No guaranteed backports |
| Upstream Nginx Proxy Manager releases | Supported by the upstream project, not by this fork |

## Reporting a vulnerability

**Do not open a public GitHub issue, pull request, or discussion containing an undisclosed vulnerability.**

Use GitHub private vulnerability reporting for this repository:

https://github.com/gigabytegrove/npm-improved/security/advisories/new

Please include as much of the following as possible:

- affected commit, branch, or image identifier;
- affected component (control plane, backend API, frontend, Nginx configuration, certificate handling, authentication, etc.);
- vulnerability description;
- reproduction steps or proof of concept;
- expected security impact;
- relevant logs with credentials/tokens/private keys removed;
- any suggested mitigation.

## Secrets and sensitive data

Never include real credentials, DNS provider tokens, private certificate keys, JWT material, database passwords, or production access tokens in a public report.

## Upstream vulnerabilities

If the vulnerability exists unchanged in upstream Nginx Proxy Manager, reporters are encouraged to notify the upstream project as well. NPM Improved may still carry its own mitigation or patch when appropriate.

## Disclosure

Security issues will be investigated before public disclosure. Once a fix and reasonable upgrade path are available, the project may publish a GitHub Security Advisory describing the affected versions and remediation.

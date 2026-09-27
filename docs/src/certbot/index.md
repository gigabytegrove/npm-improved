---
outline: deep
---

# Certificates and Certbot

NPM Improved retains Certbot-based Let's Encrypt issuance and renewal from Nginx Proxy Manager.

## DNS plugins

DNS challenge providers are defined in the repository:

[backend/certbot/dns-plugins.json](https://github.com/gigabytegrove/npm-improved/blob/develop/backend/certbot/dns-plugins.json)

DNS plugins are maintained independently and can have Python dependency conflicts. Test provider changes before relying on them for production renewal.

## Credential handling

NPM Improved avoids recreating every DNS-provider credential file on backend startup.

For DNS-01 operations, provider credentials are written immediately before the Certbot operation that needs them and removed afterward. Credentials still exist in application/database state as required by the existing certificate workflow, so access to the persistent database remains security-sensitive.

## Certificate lifecycle

Certificates are classified as active or unused based on references from non-deleted:

- Proxy Hosts;
- Redirection Hosts;
- 404 Hosts;
- Streams.

Disabled hosts still count as references so their certificate cannot be purged underneath them.

Unused certificates enter quarantine before automatic purge. Configure the retention period and whether imported/custom certificates participate under **Settings → Certificate Lifecycle**.

## Renewal safety

A failed certificate operation must not be treated as a successful replacement. Verify certificate expiration and renewal history after changing DNS providers, credentials, or challenge methods.

## Troubleshooting a DNS plugin

1. review the container and Let's Encrypt logs in the Logs UI;
2. identify the provider package/version in `backend/certbot/dns-plugins.json`;
3. verify the provider credentials and required API permissions;
4. check the DNS provider's propagation behavior;
5. reproduce against a non-production certificate when possible.

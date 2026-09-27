# Certbot DNS plugins

NPM Improved retains the upstream Certbot DNS-plugin model.

Provider definitions live in `backend/certbot/dns-plugins.json` and describe plugins that follow the standard Certbot argument pattern:

```text
--authenticator <plugin-name>
--<plugin-name>-credentials <FILE>
--<plugin-name>-propagation-seconds <number>
```

Each provider entry can define:

```json
{
  "cloudflare": {
    "display_name": "Name displayed to the user",
    "package_name": "PyPI package name",
    "version_requirement": "Optional PEP 440 version constraint",
    "dependencies": "Additional pip dependencies",
    "credentials": "Credential-file template",
    "full_plugin_name": "Full Certbot plugin name"
  }
}
```

NPM Improved writes DNS credential files only for the duration of the Certbot operation that needs them and removes them afterward. Do not add provider logic that recreates plaintext credential files during normal backend startup.

When changing plugin definitions:

1. verify the package/version against current Certbot;
2. check dependency conflicts with other supported DNS plugins;
3. test issuance and renewal;
4. avoid logging credential contents;
5. update the user documentation in `docs/src/certbot/` when behavior changes.

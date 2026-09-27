---
outline: deep
---

# Third-Party Integrations

Most existing third-party integrations were written for upstream Nginx Proxy Manager, not NPM Improved.

NPM Improved preserves familiar REST/API behavior where practical, so some integrations may work unchanged, but they are **not considered verified NPM Improved integrations unless explicitly tested against this fork**.

Examples from the upstream NPM ecosystem include:

- Home Assistant add-ons;
- Unraid/Synology container wrappers;
- Proxmox helper scripts;
- dashboards and monitoring projects;
- external authentication/access-list automation.

Before deploying any integration:

1. confirm which NPM API endpoints it uses;
2. test it against a non-production NPM Improved instance;
3. verify that it does not assume the management UI is served by Nginx;
4. verify that it does not directly overwrite generated Nginx files;
5. verify behavior with transactional rollback and certificate lifecycle management.

The project does not currently maintain an official compatibility matrix for upstream third-party integrations.

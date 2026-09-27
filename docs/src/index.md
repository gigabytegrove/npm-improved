---
layout: home

hero:
  name: "NPM Improved"
  text: "Nginx Proxy Manager, with safer failure modes."
  tagline: Independent management, transactional rollback, certificate lifecycle management, security observability, and managed HTTP protection.
  image:
    src: /logo.svg
    alt: NPM Improved
  actions:
    - theme: brand
      text: Get Started
      link: /guide/
    - theme: alt
      text: Architecture
      link: /architecture/
    - theme: alt
      text: GitHub
      link: https://github.com/gigabytegrove/npm-improved

features:
  - title: Independent Control Plane
    details: Port 81 is served outside the Nginx traffic process so a broken site configuration does not have to take the management listener down with it.
  - title: Transactional Configuration
    details: New Nginx configurations are rendered, validated, activated, reloaded, and committed with automatic last-known-good rollback on failure.
  - title: Certificate Lifecycle
    details: Active and unused certificates are tracked separately, with quarantine and configurable cleanup instead of an undifferentiated certificate list.
  - title: Logs & Security Events
    details: Raw access/error logs and structured probe/attack-pattern events are visible from the management UI.
  - title: HTTP Protection
    details: Standard and Aggressive application-layer protection profiles add request, connection, and slow-client controls with per-host overrides.
  - title: NPM Compatibility
    details: Keeps familiar proxy hosts, redirects, streams, certificates, access lists, users, and API patterns where practical.
---

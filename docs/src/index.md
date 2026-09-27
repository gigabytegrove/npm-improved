---
layout: home

hero:
  name: "NPM Improved"
  text: "Nginx Proxy Manager, with safer failure modes."
  tagline: Independent management, transactional rollback, backend high availability, shared MySQL, multi-instance synchronization, recovery, observability, and managed protection.
  image:
    src: /npm-improved-logo.webp
    alt: Nginx Proxy Manager Improved
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
  - title: System Health
    details: Live component health and degraded-mode diagnostics remain available through the independent control plane even when the normal management API is unavailable.
  - title: Transactional Configuration
    details: New Nginx configurations are rendered, validated, activated, reloaded, and committed with automatic last-known-good rollback on failure.
  - title: Configuration History
    details: Durable Active, Superseded, and Failed revisions preserve database snapshots, generated Nginx configuration, activation errors, and safe restore points.
  - title: Native Recovery Console
    details: A separately authenticated Go recovery console remains available even if the Node API or normal admin application is unavailable.
  - title: Backup & Disaster Recovery
    details: Encrypted configuration/full-instance bundles can be inspected before restore, with local rollback if regenerated Nginx state fails validation.
  - title: Certificate Lifecycle
    details: Active and unused certificates are tracked separately, with quarantine and configurable cleanup instead of an undifferentiated certificate list.
  - title: Logs & Security Events
    details: Raw access/error logs and structured probe/attack-pattern events are visible from the management UI.
  - title: HTTP Protection
    details: Standard and Aggressive application-layer protection profiles add request, connection, and slow-client controls with per-host overrides.
  - title: Proxy Host High Availability
    details: One hostname can use multiple Nginx upstream targets with round-robin, least-connections, client-IP affinity, or primary/failover behavior.
  - title: Instance Synchronization
    details: Primary/secondary NPM Improved nodes replicate encrypted configuration so multiple proxy nodes can serve the same sites and a secondary can be promoted during a primary failure.
  - title: Database Mobility & Shared MySQL
    details: Start on SQLite, move to MySQL/MariaDB from the UI, move back when needed, or let multiple NPM Improved nodes share one coordinated MySQL database.
  - title: NPM Compatibility
    details: Keeps familiar proxy hosts, redirects, streams, certificates, access lists, users, and API patterns where practical.
---

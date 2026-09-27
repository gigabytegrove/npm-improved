---
outline: deep
---

# NPM Auth Gateway compatibility note

[NPM Auth Gateway](https://github.com/Mark0025/npm-auth-gateway) is an upstream-NPM companion project that automates access-list IP membership through the REST API.

It is **not currently a verified NPM Improved integration**.

Its documented API usage is conceptually compatible with the endpoints NPM Improved continues to expose:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/tokens` | Authentication |
| `GET /api/nginx/proxy-hosts` | List proxy hosts |
| `GET /api/nginx/access-lists` | List access lists |
| `PUT /api/nginx/access-lists/:id` | Update access list IPs |
| `POST /api/nginx/access-lists` | Create access list |
| `GET /api/nginx/certificates` | List certificates |

Before using it with NPM Improved, test authentication, access-list updates, and failure handling against the exact NPM Improved commit/release you plan to deploy.

NPM Improved's own Protection trusted-network list is separate from Access Lists. External tools should not treat Protection trust entries as user authorization.

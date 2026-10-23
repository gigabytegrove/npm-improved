ARG BASE_IMAGE=ghcr.io/gigabytegrove/npm-improved:v1.4.0

# Security runtime: use the upstream NGINX Open Source build containing the
# 2026-10-14 fixes (and subsequent 1.31.8 fixes). The inherited NPMi v1.4
# image contains OpenResty; overlaying application files alone cannot fix it.
FROM nginx:1.31.8-trixie AS patched-nginx

# Node.js 24.22.1 includes the October 21, 2026 security fixes.
# Replace the executable in the inherited application runtime, not just the
# frontend build-stage runtime. The base image's Node may be outdated.
FROM node:24.22.1-bookworm-slim AS patched-node

# Compile an updated native Go control plane instead of inheriting the
# security-outdated executable baked into the immutable v1.4.0 base.
FROM --platform=$BUILDPLATFORM golang:1.27.3-alpine AS patched-controlplane
ARG TARGETOS
ARG TARGETARCH
ARG TARGETVARIANT
WORKDIR /src
COPY controlplane/go.mod ./
COPY controlplane/*.go ./
RUN CGO_ENABLED=0 go test ./...
RUN set -eux; \
    if [ "$TARGETARCH" = "arm" ] && [ -n "${TARGETVARIANT:-}" ]; then export GOARM="${TARGETVARIANT#v}"; fi; \
    CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" \
      go build -trimpath -ldflags="-s -w" -o /out/npm-improved-control-plane .; \
    go version -m /out/npm-improved-control-plane | grep -F 'go1.27.3'

# Build GeoIP2 for the *same* NGINX core so that the NPMi configuration
# and optional MaxMind/stream integrations do not load an incompatible .so.
FROM debian:trixie-slim AS geoip2-builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates git build-essential libpcre2-dev libssl-dev \
      zlib1g-dev libmaxminddb-dev \
    && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
    git clone --depth 1 --branch release-1.31.8 https://github.com/nginx/nginx.git /src/nginx; \
    test "$(git -C /src/nginx rev-parse HEAD)" = "140aa942711868a8daeb95810bc9a81f272ada72"; \
    git clone --depth 1 --branch 3.4 https://github.com/leev/ngx_http_geoip2_module.git /src/geoip2; \
    test "$(git -C /src/geoip2 rev-parse HEAD)" = "cbaa35461c62a99d2577e6bae3273492502d8769"; \
    cd /src/nginx; \
    ./auto/configure --with-compat --with-stream=dynamic \
      --with-http_ssl_module --with-http_v2_module --with-threads \
      --add-dynamic-module=/src/geoip2; \
    make -j2 modules; \
    test -s objs/ngx_http_geoip2_module.so; \
    test -s objs/ngx_stream_geoip2_module.so

# NPM Improved v1.5.0 production runtime patch build.
# Inherits the verified, already-published NPMi v1.4.0 multi-architecture
# runtime, native control-plane binary, nginx templates and trusted CA.
# The base runtime is trusted and unchanged; updated Node and Nginx files
# are overlaid into the runtime. This avoids
# Docker Hub dependencies and rebuilds of unchanged Nginx/Go components.
# Future releases that change Go or base OS must restore the full builder.

FROM --platform=$BUILDPLATFORM ${BASE_IMAGE} AS frontend-builder
ENV NODE_ENV=development NODE_OPTIONS=--openssl-legacy-provider
WORKDIR /build/frontend
COPY frontend/package.json frontend/yarn.lock ./
RUN yarn install --frozen-lockfile
COPY frontend/ ./
RUN yarn build

FROM ${BASE_IMAGE}
# The image's native privileged listener must be rebuilt with the same
# patched Go standard library. Preserve the original bind capability.
COPY --from=patched-controlplane /out/npm-improved-control-plane /usr/local/bin/npm-improved-control-plane
RUN set -eux; \
    setcap 'cap_net_bind_service=+ep' /usr/local/bin/npm-improved-control-plane; \
    getcap /usr/local/bin/npm-improved-control-plane | grep -F cap_net_bind_service
# Secure the live application Node.js runtime. The official Node executable
# is copied into the image and verified immediately, failing the build if
# runtime dependencies or the expected security version are unavailable.
COPY --from=patched-node /usr/local/bin/node /usr/local/bin/node
RUN set -eux; \
    node -v; \
    test "$(node -p 'process.versions.node')" = '24.22.1'
# Replace the actual reverse-proxy executable and its dynamic modules. This is
# deliberately distinct from the application overlay and is required for the
# 2026-10 NGINX fixes to reach running installations.
COPY --from=patched-nginx /usr/sbin/nginx /usr/sbin/nginx
COPY --from=patched-nginx /usr/lib/nginx/modules/ /usr/lib/nginx/modules/
COPY --from=geoip2-builder /src/nginx/objs/ngx_http_geoip2_module.so /usr/lib/nginx/modules/
COPY --from=geoip2-builder /src/nginx/objs/ngx_stream_geoip2_module.so /usr/lib/nginx/modules/
RUN set -eux; \
    mkdir -p /etc/nginx/modules; \
    find /etc/nginx/modules -maxdepth 1 -type f -name '*.conf' -delete; \
    printf '%s\n' 'load_module /usr/lib/nginx/modules/ngx_http_geoip2_module.so;' \
      'load_module /usr/lib/nginx/modules/ngx_stream_geoip2_module.so;' \
      > /etc/nginx/modules/20-geoip2.conf; \
    /usr/sbin/nginx -v 2>&1 | grep -F 'nginx/1.31.8'
ARG BUILD_VERSION
ARG BUILD_COMMIT
ARG BUILD_DATE

ENV NPM_BUILD_VERSION="${BUILD_VERSION}" \
    NPM_BUILD_COMMIT="${BUILD_COMMIT}" \
    NPM_BUILD_DATE="${BUILD_DATE}"

# v1.5.0 changes HTTP logging and the s6 preparation process as well
# as the application. Copy these files into the ACTUAL runtime image.
COPY docker/rootfs/etc/nginx/nginx.conf /etc/nginx/nginx.conf
COPY docker/rootfs/etc/nginx/conf.d/include/log-proxy.conf /etc/nginx/conf.d/include/log-proxy.conf
COPY docker/rootfs/etc/nginx/conf.d/include/letsencrypt-acme-challenge.conf /etc/nginx/conf.d/include/letsencrypt-acme-challenge.conf
COPY docker/rootfs/etc/nginx/conf.d/include/force-ssl.conf /etc/nginx/conf.d/include/force-ssl.conf
COPY docker/rootfs/etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf
COPY docker/rootfs/etc/s6-overlay/s6-rc.d/prepare/00-all.sh /etc/s6-overlay/s6-rc.d/prepare/00-all.sh
COPY docker/rootfs/etc/s6-overlay/s6-rc.d/prepare/26-analytics.sh /etc/s6-overlay/s6-rc.d/prepare/26-analytics.sh
WORKDIR /app
COPY backend/ /app/
COPY --from=frontend-builder /build/frontend/dist/ /app/frontend/
RUN yarn install --frozen-lockfile \
    && yarn cache clean \
    && rm -f /usr/local/libexec/npm-improved/update-handoff.sh

LABEL org.opencontainers.image.title="NPM Improved" \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.revision="${BUILD_COMMIT}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://github.com/gigabytegrove/npm-improved"

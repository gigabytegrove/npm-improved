# NPM Improved v1.5.0 production runtime patch build.
# Inherits the verified, already-published NPMi v1.4.0 multi-architecture
# runtime, native control-plane binary, nginx templates and trusted CA.
# The base runtime is trusted and unchanged; updated Node and Nginx files
# are overlaid into the runtime. This avoids
# Docker Hub dependencies and rebuilds of unchanged Nginx/Go components.
# Future releases that change Go or base OS must restore the full builder.
ARG BASE_IMAGE=ghcr.io/gigabytegrove/npm-improved:v1.4.0

FROM --platform=$BUILDPLATFORM ${BASE_IMAGE} AS frontend-builder
ENV NODE_ENV=development NODE_OPTIONS=--openssl-legacy-provider
WORKDIR /build/frontend
COPY frontend/package.json frontend/yarn.lock ./
RUN yarn install --frozen-lockfile
COPY frontend/ ./
RUN yarn build

FROM ${BASE_IMAGE}
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

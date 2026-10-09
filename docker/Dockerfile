# NPM Improved v1.4.1 patch build.
# Inherits the verified, already-published NPMi v1.4.0 multi-architecture
# runtime, native control-plane binary, nginx templates and trusted CA.
# Only Node backend/frontend files changed in this patch. This avoids
# Docker Hub dependencies and rebuilds of unchanged Nginx/Go components.
# Future releases that change Go or base OS must restore the full builder.
ARG BASE_IMAGE=ghcr.io/gigabytegrove/npm-improved:v1.4.0

FROM --platform=$BUILDPLATFORM ${BASE_IMAGE} AS frontend-builder
ENV NODE_OPTIONS=--openssl-legacy-provider
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

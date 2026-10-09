# This is a Dockerfile intended to be built using Docker BuildKit/buildx.
# The build is self-contained: it compiles the frontend and control plane
# before assembling the production image.

ARG BASE_IMAGE=nginxproxymanager/nginx-full:certbot-node
ARG GO_IMAGE=golang:1.23-alpine

FROM --platform=$BUILDPLATFORM ${BASE_IMAGE} AS frontend-builder

ENV NODE_OPTIONS=--openssl-legacy-provider

WORKDIR /build/frontend

COPY frontend/package.json frontend/yarn.lock ./
RUN yarn install --frozen-lockfile

COPY frontend/ ./
RUN yarn build

FROM --platform=$BUILDPLATFORM ${GO_IMAGE} AS controlplane-builder
ARG TARGETOS
ARG TARGETARCH
ARG TARGETVARIANT

WORKDIR /src
COPY controlplane/go.mod ./
COPY controlplane/*.go ./

RUN CGO_ENABLED=0 go test ./...
RUN set -eux; \
	if [ "$TARGETARCH" = "arm" ] && [ -n "$TARGETVARIANT" ]; then export GOARM="${TARGETVARIANT#v}"; fi; \
	CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" \
	go build -trimpath -ldflags="-s -w" -o /out/npm-improved-control-plane .

FROM nginxproxymanager/testca AS testca
FROM ${BASE_IMAGE}

ARG TARGETPLATFORM
ARG BUILD_VERSION
ARG BUILD_COMMIT
ARG BUILD_DATE

# See: https://github.com/just-containers/s6-overlay/blob/master/README.md
ENV SUPPRESS_NO_CONFIG_WARNING=1 \
	S6_BEHAVIOUR_IF_STAGE2_FAILS=1 \
	S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
	S6_FIX_ATTRS_HIDDEN=1 \
	S6_KILL_FINISH_MAXTIME=10000 \
	S6_VERBOSITY=1 \
	NODE_ENV=production \
	NPM_BUILD_VERSION="${BUILD_VERSION}" \
	NPM_BUILD_COMMIT="${BUILD_COMMIT}" \
	NPM_BUILD_DATE="${BUILD_DATE}" \
	NODE_OPTIONS="--openssl-legacy-provider"

RUN echo "fs.file-max = 65535" > /etc/sysctl.conf \
	&& apt-get update \
	&& apt-get install -y --no-install-recommends jq logrotate libcap2-bin \
	&& apt-get clean \
	&& rm -rf /var/lib/apt/lists/*

# s6 overlay
COPY docker/scripts/install-s6 /tmp/install-s6
RUN /tmp/install-s6 "${TARGETPLATFORM}" && rm -f /tmp/install-s6

EXPOSE 80 81 443

COPY backend /app
COPY --from=frontend-builder /build/frontend/dist /app/frontend
COPY docker/rootfs /
COPY --from=controlplane-builder /out/npm-improved-control-plane /usr/local/bin/npm-improved-control-plane

# Port 81 is privileged. Give only the standalone control-plane binary the
# capability required to bind it when NPM is configured to run services as
# a non-root PUID.
RUN setcap 'cap_net_bind_service=+ep' /usr/local/bin/npm-improved-control-plane

# Copy test CA cert for use in container and add to trusted certs from a self-signed CA
COPY --from=testca /home/step/certs/root_ca.crt /etc/ssl/certs/NginxProxyManager.crt
WORKDIR /etc/ssl/certs
RUN ln -s NginxProxyManager.crt 1d0e3f10.0 && update-ca-certificates

WORKDIR /app
RUN yarn install --frozen-lockfile \
	&& yarn cache clean \

# Remove frontend service not required for prod, dev nginx config as well
RUN rm -rf /etc/s6-overlay/s6-rc.d/user/contents.d/frontend /etc/nginx/conf.d/dev.conf \
	&& chmod 644 /etc/logrotate.d/nginx-proxy-manager

VOLUME [ "/data" ]
ENTRYPOINT [ "/init" ]

LABEL org.label-schema.schema-version="1.0" \
	org.label-schema.license="MIT" \
	org.label-schema.name="npm-improved" \
	org.label-schema.description="NPM Improved - resilient Nginx proxy management with an independent control plane" \
	org.label-schema.url="https://github.com/gigabytegrove/npm-improved" \
	org.label-schema.vcs-url="https://github.com/gigabytegrove/npm-improved.git" \
	org.opencontainers.image.title="NPM Improved" \
	org.opencontainers.image.version="${BUILD_VERSION}" \
	org.opencontainers.image.revision="${BUILD_COMMIT}" \
	org.opencontainers.image.created="${BUILD_DATE}" \
	org.opencontainers.image.source="https://github.com/gigabytegrove/npm-improved"

# Compile on the build host, cross-compiling the static agent for the
# requested release architecture. Runtime is native to TARGETPLATFORM.
FROM --platform=$BUILDPLATFORM golang:1.27.4-alpine AS builder
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY docker/firewall/main.go docker/firewall/main_test.go ./
RUN CGO_ENABLED=0 go test main.go main_test.go \
    && CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" \
       go build -trimpath -ldflags="-s -w" -o /out/npm-firewall-agent main.go

FROM alpine:3.22
RUN apk add --no-cache nftables ca-certificates
COPY --from=builder /out/npm-firewall-agent /usr/local/bin/npm-firewall-agent
RUN mkdir -p /policy
USER 0
ENTRYPOINT ["/usr/local/bin/npm-firewall-agent"]

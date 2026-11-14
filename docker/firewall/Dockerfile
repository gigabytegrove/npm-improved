FROM golang:1.27.3-alpine AS builder
WORKDIR /src
COPY docker/firewall/main.go .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/npm-firewall-agent main.go

FROM alpine:3.22
RUN apk add --no-cache nftables ca-certificates
COPY --from=builder /out/npm-firewall-agent /usr/local/bin/npm-firewall-agent
RUN mkdir -p /policy
USER 0
ENTRYPOINT ["/usr/local/bin/npm-firewall-agent"]

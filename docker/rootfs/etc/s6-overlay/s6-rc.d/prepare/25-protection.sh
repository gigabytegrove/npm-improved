#!/command/with-contenv bash
# shellcheck shell=bash

set -e

log_info 'HTTP protection policy ...'

PROTECTION_DIR="/data/nginx/protection"
PROTECTION_FILE="$PROTECTION_DIR/policy.conf"

mkdir -p "$PROTECTION_DIR"

if [ ! -s "$PROTECTION_FILE" ]; then
	cat >"$PROTECTION_FILE" <<'EOF'
# NPM Improved managed protection policy.
# Initial safe default. The backend replaces this transactionally from Settings > Protection.

geo $npm_protection_trusted {
    default 0;
    127.0.0.1/32 1;
    ::1/128 1;
}

map $npm_protection_trusted $npm_protection_key {
    0 $binary_remote_addr;
    1 "";
}

map $host $npm_protection_off_key {
    default "";
}

limit_req_zone $npm_protection_key zone=npm_protection_standard:20m rate=30r/s;
limit_req_zone $npm_protection_key zone=npm_protection_aggressive:20m rate=10r/s;
limit_conn_zone $npm_protection_key zone=npm_protection_conn:20m;

limit_req_zone $npm_protection_off_key zone=npm_protection_off:1m rate=1r/s;
limit_conn_zone $npm_protection_off_key zone=npm_protection_off_conn:1m;

limit_req zone=npm_protection_standard burst=60 nodelay;
limit_conn npm_protection_conn 40;
limit_req_status 429;
limit_conn_status 429;
limit_req_log_level warn;
limit_conn_log_level warn;
client_header_timeout 15s;
client_body_timeout 30s;
send_timeout 30s;
reset_timedout_connection on;
EOF
fi

chown -R "$PUID:$PGID" "$PROTECTION_DIR"
chmod 750 "$PROTECTION_DIR"
chmod 640 "$PROTECTION_FILE"

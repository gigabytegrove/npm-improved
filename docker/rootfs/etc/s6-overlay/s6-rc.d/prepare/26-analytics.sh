#!/command/with-contenv bash
# shellcheck shell=bash
set -e

log_info 'Preparing node-local Analytics Center blocking policies ...'
ANALYTICS_POLICY_DIR="/data/nginx/analytics"
mkdir -p "$ANALYTICS_POLICY_DIR"

# The geo/map nginx modules require these files before nginx starts.
# Never overwrite existing rules on a restart or an image upgrade.
for type in ip ua; do
  file="$ANALYTICS_POLICY_DIR/blocked-$type-rules.conf"
  if [ ! -e "$file" ]; then
    printf '# NPM Improved local node blocking rules\n' > "$file"
  fi
done

chown -R "$PUID:$PGID" "$ANALYTICS_POLICY_DIR"
chmod 750 "$ANALYTICS_POLICY_DIR"
chmod 640 "$ANALYTICS_POLICY_DIR"/blocked-*-rules.conf

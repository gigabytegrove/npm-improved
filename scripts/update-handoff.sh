#!/bin/sh
set -eu

ACTION="${1:-}"
TARGET_IMAGE="${2:-}"
MODE="${3:-sqlite}"
SOURCE_VERSION="${4:-unknown}"
TARGET_VERSION="${5:-unknown}"
INITIATED_BY="${NPM_UPDATE_INITIATED_BY:-}"

ROOT="${NPM_UPDATE_PROJECT_DIR:-$(pwd)}"
STATUS_FILE="${NPM_UPDATE_STATUS_FILE:-$ROOT/data/update-status.json}"
ENV_FILE="$ROOT/.env"
PREVIOUS_ENV="$ROOT/.env.npm-update-previous"
ROLLBACK_SOURCE_ENV="$ROOT/.env.npm-update-rollback-source"

case "$MODE" in
	sqlite) COMPOSE_FILE="$ROOT/compose.yaml" ;;
	mysql) COMPOSE_FILE="$ROOT/compose.mysql.yaml" ;;
	postgres) COMPOSE_FILE="$ROOT/compose.postgres.yaml" ;;
	*)
		echo "Unsupported deployment mode: $MODE" >&2
		exit 2
		;;
esac

STATUS_OWNER="$(stat -c '%u:%g' "$STATUS_FILE" 2>/dev/null || true)"

json_escape() {
	printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; :a; N; $!ba; s/\n/\\n/g'
}

write_status() {
	state="$1"
	message="$2"
	error_text="${3:-}"
	previous_image="${4:-${PREVIOUS_IMAGE:-}}"
	previous_version="${5:-${PREVIOUS_VERSION:-$SOURCE_VERSION}}"
	target_image="${6:-$TARGET_IMAGE}"
	target_version="${7:-$TARGET_VERSION}"
	target_digest="${8:-${TARGET_DIGEST:-}}"
	completed="${9:-}"

	mkdir -p "$(dirname "$STATUS_FILE")"
	tmp="$STATUS_FILE.tmp"
	cat >"$tmp" <<EOF
{
  "state": "$(json_escape "$state")",
  "action": "$(json_escape "$ACTION")",
  "message": "$(json_escape "$message")",
  "started_at": "$(json_escape "${STARTED_AT:-$(date -u '+%Y-%m-%dT%H:%M:%SZ')}")",
  "completed_at": "$(json_escape "$completed")",
  "source_version": "$(json_escape "$SOURCE_VERSION")",
  "target_version": "$(json_escape "$target_version")",
  "previous_version": "$(json_escape "$previous_version")",
  "previous_image": "$(json_escape "$previous_image")",
  "target_image": "$(json_escape "$target_image")",
  "target_digest": "$(json_escape "$target_digest")",
  "error": "$(json_escape "$error_text")",
  "initiated_by": "$(json_escape "$INITIATED_BY")"
}
EOF
	chmod 600 "$tmp" 2>/dev/null || true
	mv "$tmp" "$STATUS_FILE"
	if [ -n "$STATUS_OWNER" ]; then
		chown "$STATUS_OWNER" "$STATUS_FILE" 2>/dev/null || true
	fi
}

get_env() {
	key="$1"
	awk -F= -v k="$key" '
		$1 == k {
			sub(/^[^=]*=/, "")
			gsub(/^["'"'"']|["'"'"']$/, "")
			print
			found=1
		}
		END { if (!found) exit 0 }
	' "$ENV_FILE" 2>/dev/null | tail -n 1
}

set_env() {
	key="$1"
	value="$2"
	if grep -q "^$key=" "$ENV_FILE"; then
		sed -i "s|^$key=.*|$key=$value|" "$ENV_FILE"
	else
		printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
	fi
}

compose() {
	docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

wait_healthy() {
	attempt=0
	while [ "$attempt" -lt 75 ]; do
		CID="$(compose ps -q app 2>/dev/null || true)"
		if [ -n "$CID" ]; then
			STATE="$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CID" 2>/dev/null || true)"
			case "$STATE" in
				*" healthy")
					printf '%s' "$CID"
					return 0
					;;
				exited*|dead*)
					return 1
					;;
			esac
		fi
		attempt=$((attempt + 1))
		sleep 2
	done
	return 1
}

restore_previous() {
	if [ ! -f "$PREVIOUS_ENV" ]; then
		return 1
	fi

	cp "$PREVIOUS_ENV" "$ENV_FILE"
	write_status "rolling_back" "The new container did not pass verification. Restoring the previous image." "$1"
	if ! compose config --quiet; then
		return 1
	fi
	if ! compose up -d --no-deps --no-build --force-recreate app; then
		return 1
	fi
	ROLLBACK_CID="$(wait_healthy || true)"
	[ -n "$ROLLBACK_CID" ]
}

STARTED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

if [ ! -S /var/run/docker.sock ]; then
	write_status "failed" "Automatic update is unavailable." "Docker socket is not available." "" "$SOURCE_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
	exit 1
fi

if [ ! -d "$ROOT" ] || [ ! -f "$ENV_FILE" ] || [ ! -f "$COMPOSE_FILE" ]; then
	write_status "failed" "Automatic update is unavailable." "The host NPM Improved project directory is incomplete or not mounted into the update handoff." "" "$SOURCE_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
	exit 1
fi

if ! docker info >/dev/null 2>&1; then
	write_status "failed" "Automatic update is unavailable." "The Docker daemon is not reachable." "" "$SOURCE_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
	exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
	write_status "failed" "Automatic update is unavailable." "The temporary update handoff does not include Docker Compose." "" "$SOURCE_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
	exit 1
fi

# Give the initiating HTTP request time to return before a restart or replacement
# can take the backend offline.
sleep 2

case "$ACTION" in
	update)
		case "$TARGET_IMAGE" in
			ghcr.io/gigabytegrove/npm-improved:v[0-9]*.[0-9]*.[0-9]*) ;;
			*)
				write_status "failed" "Update rejected." "Target image is not an official stable NPM Improved release image." "" "$SOURCE_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
				exit 1
				;;
		esac

		PREVIOUS_IMAGE="$(get_env NPM_IMAGE)"
		[ -n "$PREVIOUS_IMAGE" ] || PREVIOUS_IMAGE="npm-improved:local"
		PREVIOUS_VERSION="$SOURCE_VERSION"

		write_status "preflight" "Checking Docker, Compose, deployment state, and target release."
		if ! compose config --quiet; then
			write_status "failed" "Update preflight failed." "Current Docker Compose configuration is invalid." "$PREVIOUS_IMAGE" "$PREVIOUS_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
			exit 1
		fi

		if [ ! -d "$ROOT/data" ] || [ ! -d "$ROOT/letsencrypt" ]; then
			write_status "failed" "Update preflight failed." "Persistent data or certificate directories are missing." "$PREVIOUS_IMAGE" "$PREVIOUS_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
			exit 1
		fi

		FREE_KB="$(df -Pk "$ROOT" | awk 'NR == 2 {print $4}')"
		if [ -z "$FREE_KB" ] || [ "$FREE_KB" -lt 524288 ]; then
			write_status "failed" "Update preflight failed." "At least 512 MiB of free disk space is required to stage an update." "$PREVIOUS_IMAGE" "$PREVIOUS_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
			exit 1
		fi

		write_status "pulling" "Pulling $TARGET_VERSION from the official NPM Improved registry."
		if ! docker pull "$TARGET_IMAGE"; then
			write_status "failed" "Unable to pull the requested update." "Docker could not pull $TARGET_IMAGE." "$PREVIOUS_IMAGE" "$PREVIOUS_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
			exit 1
		fi

		TARGET_DIGEST="$(docker image inspect --format '{{index .RepoDigests 0}}' "$TARGET_IMAGE" 2>/dev/null || true)"
		cp "$ENV_FILE" "$PREVIOUS_ENV"
		chmod 600 "$PREVIOUS_ENV" 2>/dev/null || true
		set_env NPM_IMAGE "$TARGET_IMAGE"

		write_status "staging" "The update image is ready. Preparing the replacement container."
		if ! compose config --quiet; then
			cp "$PREVIOUS_ENV" "$ENV_FILE"
			write_status "failed" "The target deployment configuration is invalid." "Docker Compose rejected the updated image configuration." "$PREVIOUS_IMAGE" "$PREVIOUS_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "$TARGET_DIGEST" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
			exit 1
		fi

		write_status "restarting" "Replacing NPM Improved. The Control Center will reconnect automatically."
		if ! compose up -d --no-deps --no-build --force-recreate app; then
			if restore_previous "Docker Compose could not start the target image."; then
				write_status "rolled_back" "Update failed and the previous image was restored." "Docker Compose could not start the target image." "$PREVIOUS_IMAGE" "$PREVIOUS_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "$TARGET_DIGEST" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
			else
				write_status "failed" "Update failed and automatic rollback also failed." "Docker Compose could not start the target image." "$PREVIOUS_IMAGE" "$PREVIOUS_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "$TARGET_DIGEST" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
			fi
			exit 1
		fi

		write_status "verifying" "The new container is running. Verifying health and build identity."
		NEW_CID="$(wait_healthy || true)"
		if [ -z "$NEW_CID" ]; then
			if restore_previous "The target container did not become healthy in time."; then
				write_status "rolled_back" "The target did not become healthy; the previous image was restored." "Health verification timed out." "$PREVIOUS_IMAGE" "$PREVIOUS_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "$TARGET_DIGEST" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
			else
				write_status "failed" "The target did not become healthy and rollback failed." "Health verification timed out." "$PREVIOUS_IMAGE" "$PREVIOUS_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "$TARGET_DIGEST" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
			fi
			exit 1
		fi

		if ! docker exec "$NEW_CID" sh -c 'curl --fail --silent --show-error "http://127.0.0.1:${NPM_ADMIN_PORT:-81}/__npm_improved/health" | jq -e ".status == \"ok\" or .status == \"degraded\"" >/dev/null'; then
			if restore_previous "The independent control-plane health endpoint did not respond correctly."; then
				write_status "rolled_back" "Control-plane verification failed; the previous image was restored." "The independent control-plane health endpoint failed." "$PREVIOUS_IMAGE" "$PREVIOUS_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "$TARGET_DIGEST" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
			else
				write_status "failed" "Control-plane verification and automatic rollback failed." "The independent control-plane health endpoint failed." "$PREVIOUS_IMAGE" "$PREVIOUS_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "$TARGET_DIGEST" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
			fi
			exit 1
		fi

		LIVE_VERSION="$(docker exec "$NEW_CID" sh -c 'printf "%s" "$NPM_BUILD_VERSION"' 2>/dev/null || true)"
		EXPECTED_VERSION="${TARGET_VERSION#v}"
		if [ "$LIVE_VERSION" != "$EXPECTED_VERSION" ]; then
			if restore_previous "The live build identity did not match the requested release."; then
				write_status "rolled_back" "Build verification failed; the previous image was restored." "Expected $EXPECTED_VERSION but the new container reported ${LIVE_VERSION:-missing}." "$PREVIOUS_IMAGE" "$PREVIOUS_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "$TARGET_DIGEST" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
			else
				write_status "failed" "Build verification and automatic rollback failed." "Expected $EXPECTED_VERSION but the new container reported ${LIVE_VERSION:-missing}." "$PREVIOUS_IMAGE" "$PREVIOUS_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "$TARGET_DIGEST" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
			fi
			exit 1
		fi

		write_status "completed" "Updated successfully to $TARGET_VERSION." "" "$PREVIOUS_IMAGE" "$PREVIOUS_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "$TARGET_DIGEST" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
		;;

	rollback)
		case "$TARGET_IMAGE" in
			npm-improved:local|ghcr.io/gigabytegrove/npm-improved:v[0-9]*.[0-9]*.[0-9]*) ;;
			*)
				write_status "failed" "Rollback rejected." "The stored rollback image is not an allowed NPM Improved image." "" "$SOURCE_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
				exit 1
				;;
		esac

		CURRENT_IMAGE="$(get_env NPM_IMAGE)"
		[ -n "$CURRENT_IMAGE" ] || CURRENT_IMAGE="npm-improved:local"
		cp "$ENV_FILE" "$ROLLBACK_SOURCE_ENV"
		chmod 600 "$ROLLBACK_SOURCE_ENV" 2>/dev/null || true

		write_status "rolling_back" "Restoring $TARGET_VERSION." "" "$CURRENT_IMAGE" "$SOURCE_VERSION"
		if ! docker image inspect "$TARGET_IMAGE" >/dev/null 2>&1; then
			if ! docker pull "$TARGET_IMAGE"; then
				write_status "failed" "Rollback image is unavailable." "Docker could not make $TARGET_IMAGE available." "$CURRENT_IMAGE" "$SOURCE_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
				exit 1
			fi
		fi

		set_env NPM_IMAGE "$TARGET_IMAGE"
		if ! compose config --quiet || ! compose up -d --no-deps --no-build --force-recreate app; then
			cp "$ROLLBACK_SOURCE_ENV" "$ENV_FILE"
			compose up -d --no-deps --no-build --force-recreate app >/dev/null 2>&1 || true
			write_status "failed" "Rollback failed; the previous deployment setting was restored." "Docker Compose could not start the rollback image." "$CURRENT_IMAGE" "$SOURCE_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
			exit 1
		fi

		ROLLBACK_CID="$(wait_healthy || true)"
		if [ -z "$ROLLBACK_CID" ]; then
			cp "$ROLLBACK_SOURCE_ENV" "$ENV_FILE"
			compose up -d --no-deps --no-build --force-recreate app >/dev/null 2>&1 || true
			write_status "failed" "Rollback image did not become healthy; the previous deployment setting was restored." "Rollback health verification timed out." "$CURRENT_IMAGE" "$SOURCE_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
			exit 1
		fi

		cp "$ROLLBACK_SOURCE_ENV" "$PREVIOUS_ENV"
		write_status "rolled_back" "Rollback completed successfully." "" "$CURRENT_IMAGE" "$SOURCE_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
		;;

	restart)
		PREVIOUS_IMAGE="$(get_env NPM_IMAGE)"
		[ -n "$PREVIOUS_IMAGE" ] || PREVIOUS_IMAGE="npm-improved:local"
		PREVIOUS_VERSION="$SOURCE_VERSION"
		write_status "restarting" "Restarting NPM Improved. The Control Center will reconnect automatically." "" "$PREVIOUS_IMAGE" "$PREVIOUS_VERSION" "$PREVIOUS_IMAGE" "$SOURCE_VERSION"
		if ! compose restart app; then
			write_status "failed" "Restart failed." "Docker Compose could not restart the application container." "$PREVIOUS_IMAGE" "$PREVIOUS_VERSION" "$PREVIOUS_IMAGE" "$SOURCE_VERSION" "" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
			exit 1
		fi
		RESTART_CID="$(wait_healthy || true)"
		if [ -z "$RESTART_CID" ]; then
			write_status "failed" "NPM Improved restarted but did not become healthy." "Health verification timed out." "$PREVIOUS_IMAGE" "$PREVIOUS_VERSION" "$PREVIOUS_IMAGE" "$SOURCE_VERSION" "" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
			exit 1
		fi
		write_status "completed" "NPM Improved restarted successfully." "" "$PREVIOUS_IMAGE" "$PREVIOUS_VERSION" "$PREVIOUS_IMAGE" "$SOURCE_VERSION" "" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
		;;

	*)
		write_status "failed" "Unsupported update operation." "Unknown action: $ACTION" "" "$SOURCE_VERSION" "$TARGET_IMAGE" "$TARGET_VERSION" "" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
		exit 2
		;;
esac

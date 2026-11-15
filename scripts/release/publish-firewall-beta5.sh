#!/usr/bin/env bash
# Local dockeradm incremental v1.8.0-beta.5 release; stable remains untouched.
set -Eeuo pipefail
umask 077

REPO='gigabytegrove/npm-improved'
STABLE_BRANCH='unused'
BETA_BRANCH='release/1.8.0-beta.5-npmx-identity'
STABLE_TAG='v1.7.9'
BETA_TAG='v1.8.0-beta.5'
BASE_TAG='v1.8.0-beta.4'
BETA_REV="${1:-}"
EXPECTED_STABLE_REV="$BETA_REV"

[[ "$EXPECTED_STABLE_REV" =~ ^[0-9a-f]{40}$ ]] || {
  echo 'Usage: publish-firewall-beta5.sh EXACT_PINNED_BETA_COMMIT_SHA' >&2
  exit 2
}

for cmd in gh git docker python3 sha256sum gzip tar flock; do
  command -v "$cmd" >/dev/null || { echo "Missing required command: $cmd" >&2; exit 1; }
done
docker info >/dev/null
docker buildx version >/dev/null
gh auth status -h github.com >/dev/null

# Keep reusable release inputs and disposable build work under /root.
# The source checkout is managed separately by the operator; published
# releases remain on GitHub, and the isolated BuildKit cache is persistent.
BUILD_ROOT='/root/npm-improved-build'
CACHE="$BUILD_ROOT/cache"
WORK_PARENT="${NPMI_WORK_PARENT:-$BUILD_ROOT/tmp}"
mkdir -p -- "$BUILD_ROOT" "$CACHE"
[[ -d "$BUILD_ROOT" && ! -L "$BUILD_ROOT" && -d "$CACHE" && ! -L "$CACHE" ]] || {
  echo 'NPMi build root/cache must be real directories, not symlinks.' >&2; exit 1;
}
# An explicit alternate work parent must already exist; the default /root
# scratch directory may be created automatically.
if [[ -z "${NPMI_WORK_PARENT:-}" ]]; then
  mkdir -p -- "$WORK_PARENT"
fi
[[ -d "$WORK_PARENT" && ! -L "$WORK_PARENT" ]] || {
  echo 'NPMI_WORK_PARENT must be an existing non-symlink directory.' >&2; exit 1;
}
exec 9>"$CACHE/.release.lock"
flock -n 9 || { echo 'Another NPMi release is running.' >&2; exit 1; }
WORK="$(mktemp -d "$WORK_PARENT/npmi-release-recovery.XXXXXXXX")"
CREATED_APP=''
CREATED_FW=''
cleanup() {
  result=$?
  trap - EXIT
  if [[ -n "$CREATED_APP" ]]; then docker image rm "$CREATED_APP" >/dev/null 2>&1 || true; fi
  if [[ -n "$CREATED_FW" ]]; then docker image rm "$CREATED_FW" >/dev/null 2>&1 || true; fi
  if [[ "$result" == 0 ]]; then
    rm -rf --one-file-system -- "$WORK"
  else
    # The OCI directory holds fully disposable, multi-gigabyte converted
    # image layers. Never strand these when a release fails partway through.
    if [[ -d "$WORK/oci" && ! -L "$WORK/oci" ]]; then
      rm -rf --one-file-system -- "$WORK/oci"
    fi
    echo "Failed: $WORK retained (generated OCI layers removed)" >&2
  fi
  exit "$result"
}
trap cleanup EXIT
mkdir -p "$WORK/source" "$WORK/dist" "$WORK/oci"
# These two architectures need compressed OCI contexts, four release image
# bundles, and intermediate beta packaging. This is a conservative, bounded
# minimum for a shared host; never discover a full disk during extraction.
free_bytes="$(df -B1 --output=avail "$WORK" | tail -n 1 | tr -d '[:space:]')"
min_bytes=$((10 * 1024 * 1024 * 1024))
if [[ ! "$free_bytes" =~ ^[0-9]+$ || "$free_bytes" -lt "$min_bytes" ]]; then
  echo "Insufficient build workspace: need 10 GiB free before starting." >&2
  df -h "$WORK" >&2
  echo "Set NPMI_WORK_PARENT to an existing filesystem with sufficient space." >&2
  exit 1
fi
export GIT_TERMINAL_PROMPT=0

echo '=== Validate source and release state ==='
for spec in "beta:$BETA_BRANCH:$BETA_REV"; do
  IFS=: read -r key branch revision <<< "$spec"
  git clone --quiet --depth 1 --single-branch --branch "$branch" \
    "https://github.com/$REPO.git" "$WORK/source/$key"
  [[ "$(git -C "$WORK/source/$key" rev-parse HEAD)" == "$revision" ]] || {
    echo "Unexpected $key source commit" >&2; exit 1;
  }
  tag="$STABLE_TAG"
  [[ "$key" == beta ]] && tag="$BETA_TAG"
  [[ "$(<"$WORK/source/$key/.version")" == "${tag#v}" ]] || { echo "Version mismatch: $tag" >&2; exit 1; }
  [[ -s "$WORK/source/$key/.github/release-notes/$tag.md" ]] || { echo "Release notes missing: $tag" >&2; exit 1; }
  if gh release view "$tag" -R "$REPO" >/dev/null 2>&1; then
    echo "Release $tag exists: refusing to overwrite" >&2; exit 1
  fi
  if [[ -n "$(git -C "$WORK/source/$key" ls-remote --tags origin "refs/tags/$tag")" ]]; then
    echo "Tag $tag exists: refusing to overwrite" >&2; exit 1
  fi
  bash -n "$WORK/source/$key/scripts/install-host-updater"
  sh -n "$WORK/source/$key/scripts/update-handoff.sh"
  python3 -m py_compile "$WORK/source/$key/scripts/host-update-dispatch.py" "$WORK/source/$key/scripts/host-update-maintenance.py"
  ( cd "$WORK/source/$key" && python3 -m unittest discover -s scripts -p 'test_host_updater*.py' -v )
done

echo '=== Regression test: OCI streaming conversion ==='
( cd "$WORK/source/beta/scripts/ci" && python3 -m unittest test_docker_release_to_oci.py -v )

echo '=== Reuse checksum-verified NPMi stable runtime ==='
BASE_CACHE="$CACHE/$BASE_TAG"
mkdir -p "$BASE_CACHE"
BASE_SUM="npm-improved-$BASE_TAG-SHA256SUMS.txt"
BASE_AMD64="npm-improved-$BASE_TAG-linux-amd64.tar.gz"
BASE_ARM64="npm-improved-$BASE_TAG-linux-arm64.tar.gz"

# The published checksum manifest also lists the small host-updater archive,
# but this stage deliberately downloads ONLY the two runtime image archives.
# Verify each selected asset against the exact, published SHA-256 entry.
verify_base_images() (
  cd "$1"
  [[ -s "$BASE_SUM" && -s "$BASE_AMD64" && -s "$BASE_ARM64" ]] || return 1
  awk -v amd64="$BASE_AMD64" -v arm64="$BASE_ARM64" '
    $2 == amd64 || $2 == arm64 {
      if ($1 !~ /^[0-9a-fA-F]{64}$/ && (length($1) != 64 || $1 ~ /[^0-9a-fA-F]/)) exit 1
      if ($2 == amd64) na++
      if ($2 == arm64) nb++
      print
    }
    END { if (na != 1 || nb != 1) exit 1 }
  ' "$BASE_SUM" | sha256sum -c -
)
if [[ -n "${NPMI_BASE_ARCHIVE_DIR:-}" ]]; then
  # Reuse the retained, already-downloaded base images from an interrupted run.
  # Explicit paths are read-only here; reject an invalid cache instead of
  # overwriting its contents or silently downloading 1.2 GB again.
  [[ -d "$NPMI_BASE_ARCHIVE_DIR" ]] || {
    echo "Retained archive directory does not exist: $NPMI_BASE_ARCHIVE_DIR" >&2; exit 1;
  }
  verify_base_images "$NPMI_BASE_ARCHIVE_DIR" || {
    echo "Retained base archives failed SHA-256 verification; nothing overwritten." >&2; exit 1;
  }
  BASE_CACHE="$NPMI_BASE_ARCHIVE_DIR"
elif ! verify_base_images "$BASE_CACHE"; then
  mkdir -p "$WORK/base-download"
  gh release download "$BASE_TAG" -R "$REPO" -D "$WORK/base-download" \
    -p "$BASE_AMD64" -p "$BASE_ARM64" -p "$BASE_SUM"
  verify_base_images "$WORK/base-download"
  for arch in amd64 arm64; do
    mv -f "$WORK/base-download/npm-improved-$BASE_TAG-linux-$arch.tar.gz" "$BASE_CACHE/"
  done
  mv -f "$WORK/base-download/$BASE_SUM" "$BASE_CACHE/"
fi
verify_base_images "$BASE_CACHE"
python3 "$WORK/source/beta/scripts/ci/docker-release-to-oci.py" "$BASE_CACHE" "$WORK/oci" "$BASE_TAG"

echo '=== Select persistent, isolated NPMi BuildKit builder ==='
BUILDER='npm-improved-release'
if docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  docker buildx inspect "$BUILDER" | grep -Eiq 'Driver:[[:space:]]+docker-container' || {
    echo 'The NPMi-named builder is not an isolated Docker-container builder.' >&2
    exit 1
  }
else
  cat > "$WORK/buildkitd.toml" <<'TOML'
[worker.oci]
  max-parallelism = 2
TOML
  docker buildx create --name "$BUILDER" --driver docker-container \
    --driver-opt 'memory=4g' --driver-opt 'cpu-quota=200000' \
    --buildkitd-config "$WORK/buildkitd.toml" >/dev/null
fi
docker buildx inspect "$BUILDER" --bootstrap >/dev/null
DATE="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

check_docker_tar() {
  python3 - "$1" "$2" "$3" "$4" "$5" <<'PY'
import json,sys,tarfile
archive,tag,arch,revision,version=sys.argv[1:]
with tarfile.open(archive, 'r:gz') as tf:
    manifest=json.load(tf.extractfile('manifest.json'))
    assert len(manifest)==1, 'Docker image archive must contain one image'
    assert tag in manifest[0]['RepoTags'], 'Image tag does not match'
    cfg=json.load(tf.extractfile(manifest[0]['Config']))
    assert cfg['architecture']==arch and cfg['os']=='linux', 'Image platform mismatch'
    labels=cfg['config'].get('Labels') or {}
    assert labels.get('org.opencontainers.image.version')==version, 'Version label mismatch'
    assert labels.get('org.opencontainers.image.revision')==revision, 'Revision label mismatch'
print('Verified',tag,arch)
PY
}

for arch in amd64 arm64; do
  for key in beta; do
    version='1.7.9'; revision="$EXPECTED_STABLE_REV"; tag="$STABLE_TAG"
    if [[ "$key" == beta ]]; then version='1.8.0-beta.4'; revision="$BETA_REV"; tag="$BETA_TAG"; fi
    src="$WORK/source/$key"
    app="ghcr.io/gigabytegrove/npm-improved:$tag"
    out="$WORK/dist/$key-$arch-app.tar.gz"
    echo "=== Incremental $tag linux/$arch ==="
    docker buildx build --builder "$BUILDER" --progress plain --pull=false \
      --platform "linux/$arch" \
      --build-context "npmi_host_base=oci-layout://$WORK/oci:amd64" \
      --build-context "npmi_target_base=oci-layout://$WORK/oci:$arch" \
      --build-arg "BUILD_VERSION=$version" \
      --build-arg "BUILD_COMMIT=$revision" \
      --build-arg "BUILD_DATE=$DATE" \
      -f "$src/docker/Dockerfile.incremental-release" \
      -t "$app" --output "type=docker,dest=-" "$src" | gzip -1 > "$out"
    check_docker_tar "$out" "$app" "$arch" "$revision" "$version"
    if [[ "$key" == stable ]]; then
      echo "=== Package stable $arch ==="
      mv -f "$out" "$WORK/dist/npm-improved-$tag-linux-$arch.tar.gz"
      # Keep the packaged release archive until checksum verification and upload.
      # Do not repoint the temporary variable to the final asset (cleanup below).
      :
    else
      fw="ghcr.io/gigabytegrove/npm-improved-firewall:$tag"
      fw_tar="$WORK/dist/beta-$arch-firewall.tar.gz"
      echo "=== Cross-compile and test beta firewall $arch ==="
      docker buildx build --builder "$BUILDER" --progress plain \
        --platform "linux/$arch" -f "$src/docker/firewall/Dockerfile" \
        -t "$fw" --output "type=docker,dest=-" "$src" | gzip -1 > "$fw_tar"
      if docker image inspect "$app" >/dev/null 2>&1 || docker image inspect "$fw" >/dev/null 2>&1; then
        echo 'Existing release tag on Docker daemon; refusing overwrite.' >&2
        exit 1
      fi
      docker load -i "$out" >/dev/null
      CREATED_APP="$app"
      docker load -i "$fw_tar" >/dev/null
      CREATED_FW="$fw"
      [[ "$(docker image inspect --format '{{.Architecture}}' "$app")" == "$arch" ]]
      [[ "$(docker image inspect --format '{{.Architecture}}' "$fw")" == "$arch" ]]
      echo "=== Package beta $arch with firewall companion ==="
      docker save "$app" "$fw" | gzip -1 > "$WORK/dist/npm-improved-$tag-linux-$arch.tar.gz"
      docker image rm "$fw" "$app" >/dev/null
      CREATED_APP=''; CREATED_FW=''
    fi
    gzip -t "$WORK/dist/npm-improved-$tag-linux-$arch.tar.gz"
    if [[ "$key" == beta ]]; then
      rm -f -- "$out" "$fw_tar"
    fi
  done
done

echo '=== Package legacy-compatible stable and beta native host agents ==='
for key in beta; do
  tag="$STABLE_TAG"; [[ "$key" == beta ]] && tag="$BETA_TAG"
  src="$WORK/source/$key"
  ( cd "$src" && tar -czf "$WORK/dist/npm-improved-$tag-host-updater.tar.gz" \
    scripts/install-host-updater scripts/host-update-dispatch.py \
    scripts/host-update-maintenance.py scripts/update-handoff.sh .version \
    $([[ "$key" == beta ]] && printf 'compose.firewall.yaml') )
  ( cd "$WORK/dist" && sha256sum \
    "npm-improved-$tag-linux-amd64.tar.gz" \
    "npm-improved-$tag-linux-arm64.tar.gz" \
    "npm-improved-$tag-host-updater.tar.gz" \
    > "npm-improved-$tag-SHA256SUMS.txt" )
  ( cd "$WORK/dist" && sha256sum -c "npm-improved-$tag-SHA256SUMS.txt" )
  python3 - "$src/scripts/host-update-maintenance.py" "$WORK/dist" "$tag" <<'PY'
import importlib.util,sys,tempfile
from pathlib import Path
file,assets,tag=sys.argv[1:]
spec=importlib.util.spec_from_file_location('host_maintenance',file)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
assets=Path(assets)
with tempfile.TemporaryDirectory() as d:
    mod.verify_and_extract(tag.removeprefix('v'),
        (assets/f'npm-improved-{tag}-SHA256SUMS.txt').read_bytes(),
        (assets/f'npm-improved-{tag}-host-updater.tar.gz').read_bytes(),Path(d))
print('Verified native updater archive',tag)
PY
done

echo '=== Final state check; do not publish partial assets ==='
for tag in "$BETA_TAG"; do
  if gh release view "$tag" -R "$REPO" >/dev/null 2>&1; then
    echo "A draft or release already exists for $tag." >&2; exit 1
  fi
done

echo '=== Upload drafts (both versions fully qualified) ==='
for key in beta; do
  tag="$STABLE_TAG"; revision="$EXPECTED_STABLE_REV"
  if [[ "$key" == beta ]]; then tag="$BETA_TAG"; revision="$BETA_REV"; fi
  args=()
  [[ "$key" == beta ]] && args+=(--prerelease)
  gh release create "$tag" -R "$REPO" --target "$revision" \
    --title "NPM Improved $tag" --draft "${args[@]}" \
    --notes-file "$WORK/source/$key/.github/release-notes/$tag.md" \
    "$WORK/dist/npm-improved-$tag-linux-amd64.tar.gz" \
    "$WORK/dist/npm-improved-$tag-linux-arm64.tar.gz" \
    "$WORK/dist/npm-improved-$tag-host-updater.tar.gz" \
    "$WORK/dist/npm-improved-$tag-SHA256SUMS.txt"
  assets="$(gh release view "$tag" -R "$REPO" --json assets --jq '.assets[].name')"
  for expected in "npm-improved-$tag-linux-amd64.tar.gz" \
                  "npm-improved-$tag-linux-arm64.tar.gz" \
                  "npm-improved-$tag-host-updater.tar.gz" \
                  "npm-improved-$tag-SHA256SUMS.txt"; do
    grep -Fxq "$expected" <<< "$assets" || { echo "Missing uploaded $expected" >&2; exit 1; }
  done
done

echo '=== Publish beta only; stable release is untouched ==='
gh release edit "$BETA_TAG" -R "$REPO" --draft=false --prerelease
[[ "$(gh api "repos/$REPO/releases/latest" --jq .tag_name)" == "$STABLE_TAG" ]]
[[ "$(gh api "repos/$REPO/releases/tags/$BETA_TAG" --jq .prerelease)" == true ]]
echo "Beta:   https://github.com/$REPO/releases/tag/$BETA_TAG"
echo 'Beta release includes AMD64 and ARM64 application and firewall companion.'
echo 'No proxy installation, other project builder, or shared Docker settings changed.'

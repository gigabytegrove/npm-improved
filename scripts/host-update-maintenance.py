#!/usr/bin/env python3
"""Maintain the native updater from verified NPMi GitHub release assets.

Runs as a root-owned systemd service on the Docker HOST. Never starts a
helper Docker container and never executes unverified downloaded scripts.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

PROGRAMS = (
    "scripts/install-host-updater",
    "scripts/host-update-dispatch.py",
    "scripts/host-update-maintenance.py",
    "scripts/update-handoff.sh",
    ".version",
)
RELEASE_BASE = "https://github.com/gigabytegrove/npm-improved/releases/download"
VERSION_PATTERN = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
MAX_PACKAGE_BYTES = 1024 * 1024


def fetch(url):
    """Retry temporary host-side resolver/network failures without hiding them."""
    for attempt in range(3):
        try:
            with urlopen(url, timeout=20) as response:
                result = response.read(MAX_PACKAGE_BYTES + 1)
            if len(result) > MAX_PACKAGE_BYTES:
                raise ValueError("Native updater asset exceeds the size limit")
            return result
        except HTTPError as error:
            if attempt == 2 or error.code not in (429, 500, 502, 503, 504):
                raise
        except (URLError, TimeoutError):
            if attempt == 2:
                raise
        time.sleep((2, 5)[attempt])


def explain_maintenance_error(error):
    """Provide actionable operator status without exposing raw download URLs."""
    reason = error.reason if isinstance(error, URLError) else error
    if isinstance(reason, socket.gaierror) or (
        isinstance(error, URLError) and
        ("name resolution" in str(reason).lower() or
         "temporary failure in name resolution" in str(reason).lower())
    ):
        return (
            "The Docker host cannot resolve GitHub or its configured proxy through DNS. "
            "The NPMi application keeps running, but native host updater maintenance "
            "will retry after host DNS recovers. Check DNS on the Docker host."
        )
    if isinstance(error, HTTPError):
        return (
            f"GitHub release download returned HTTP {error.code}. "
            "The NPMi application keeps running; native updater maintenance "
            "will retry on its next scheduled run."
        )
    if isinstance(error, (URLError, TimeoutError)):
        return (
            "The Docker host could not reach the GitHub release downloads. "
            "The NPMi application keeps running; check host networking and try again."
        )
    return str(error)


def verify_and_extract(version, checksum_text, package, dest):
    """A pinned release checksum must cover the exact archive being installed."""
    if not VERSION_PATTERN.fullmatch(version):
        raise ValueError("Native updater requires a stable semantic version")
    filename = f"npm-improved-v{version}-host-updater.tar.gz"
    expected = None
    for line in checksum_text.decode("utf-8").splitlines():
        match = re.fullmatch(r"([0-9a-fA-F]{64})  (\S+)", line)
        if match and match.group(2) == filename:
            expected = match.group(1).lower()
            break
    if expected is None or hashlib.sha256(package).hexdigest() != expected:
        raise ValueError("Host updater SHA-256 verification failed")
    with tarfile.open(fileobj=io.BytesIO(package), mode="r:gz") as archive:
        members = archive.getmembers()
        found = {member.name for member in members}
        if found != set(PROGRAMS) or any(not member.isfile() for member in members):
            raise ValueError("Host updater package has unexpected paths or entries")
        for member in members:
            value = archive.extractfile(member)
            if value is None or member.size > MAX_PACKAGE_BYTES:
                raise ValueError("Invalid updater archive member")
            contents = value.read(MAX_PACKAGE_BYTES + 1)
            if len(contents) != member.size:
                raise ValueError("Updater archive member length mismatch")
            output = dest / member.name
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(contents)
            output.chmod(0o755 if member.name != ".version" else 0o644)
    if (dest / ".version").read_text(encoding="utf-8").strip() != version:
        raise ValueError("Updater bundle version does not match the release")


def read_ready(root):
    try:
        return json.loads((root / "data/host-updater-ready.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def app_version(root):
    environment = root / ".env"
    if not environment.is_file():
        raise ValueError("NPM Improved project .env was not found")
    mode = "sqlite"
    for line in environment.read_text(encoding="utf-8").splitlines():
        if line.startswith("NPM_DEPLOYMENT_MODE="):
            mode = line.partition("=")[2].strip().strip("\"'")
    if mode not in ("sqlite", "mysql", "postgres"):
        raise ValueError("Unknown NPM Improved deployment mode")
    compose = {
        "sqlite": "compose.yaml", "mysql": "compose.mysql.yaml",
        "postgres": "compose.postgres.yaml",
    }[mode]
    cid = subprocess.check_output(
        ["docker", "compose", "-f", str(root / compose), "--env-file",
         str(environment), "ps", "-q", "app"],
        text=True, timeout=15,
    ).strip()
    if not cid:
        raise ValueError("No running NPM Improved application")
    version = subprocess.check_output(
        ["docker", "inspect", "--format",
         "{{range .Config.Env}}{{println .}}{{end}}", cid],
        text=True, timeout=15,
    )
    for entry in version.splitlines():
        if entry.startswith("NPM_BUILD_VERSION="):
            result = entry.partition("=")[2]
            if VERSION_PATTERN.fullmatch(result):
                return result
    raise ValueError("Running application has no stable NPMi version")


def newer_than(version, current):
    return tuple(map(int, version.split("."))) > tuple(
        map(int, current.split("."))) if VERSION_PATTERN.fullmatch(current) else True


def maintain(root, version, downloader=fetch):
    root = Path(root).resolve()
    if not VERSION_PATTERN.fullmatch(version):
        raise ValueError("Untrusted or unsupported requested release version")
    ready = read_ready(root)
    if ready.get("mode") != "native-host-service" or ready.get("project_dir") != str(root):
        raise ValueError("Host updater is not initialized for this project")
    current = ready.get("component_version", "0.0.0")
    if not newer_than(version, current):
        return False
    base = f"{RELEASE_BASE}/v{version}"
    asset = f"npm-improved-v{version}-host-updater.tar.gz"
    sums = f"npm-improved-v{version}-SHA256SUMS.txt"
    with tempfile.TemporaryDirectory(prefix="npm-improved-host-updater-") as temp:
        stage = Path(temp)
        verify_and_extract(version, downloader(f"{base}/{sums}"),
                           downloader(f"{base}/{asset}"), stage)
        # The package installer only changes root-owned native program files,
        # systemd units and the readiness marker; never the NPMi container.
        subprocess.run(
            ["/bin/bash", str(stage / "scripts/install-host-updater"), str(root)],
            check=True, timeout=45,
        )
    verified = read_ready(root)
    if verified.get("component_version") != version:
        raise RuntimeError("Native updater installation did not report target version")
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("project")
    parser.add_argument("--version", default=None)
    args = parser.parse_args()
    root = Path(args.project).resolve()
    version = args.version or app_version(root)
    try:
        changed = maintain(root, version)
    except Exception as error:
        message = f"Host updater maintenance: {explain_maintenance_error(error)}"
        print(message, file=sys.stderr)
        status = root / "data/host-updater-maintenance.json"
        if status.parent.is_dir():
            with tempfile.NamedTemporaryFile(
                mode="w", dir=status.parent, prefix=".maintenance-", delete=False
            ) as handle:
                json.dump({"status": "failed", "target_version": version,
                           "error": explain_maintenance_error(error)}, handle)
                handle.write("\n")
                temporary = Path(handle.name)
            temporary.chmod(0o644)
            temporary.replace(status)
        return 1
    status = root / "data/host-updater-maintenance.json"
    if status.parent.is_dir():
        status.write_text(json.dumps(
            {"status": "current", "target_version": version, "updated": changed}
        ) + "\n", encoding="utf-8")
    print(f"Native updater {'refreshed' if changed else 'current'} at {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

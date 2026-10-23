#!/usr/bin/env python3
"""systemd-launched, root-owned in-place updater. Creates NO containers."""
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

def main():
    if len(sys.argv) != 2:
        raise SystemExit("Project path required")
    root = Path(sys.argv[1]).resolve()
    if not root.is_absolute() or not (root / ".env").is_file():
        raise SystemExit("Invalid NPMi project directory")
    data = root / "data"
    if data.is_symlink() or not data.is_dir():
        raise SystemExit("Invalid native updater data directory")
    if data.stat().st_mode & stat.S_IWOTH:
        raise SystemExit("Native updater data directory is world-writable")
    queue = data / "host-update-request.json"
    script = Path(__file__).resolve().with_name("update-handoff.sh")
    maintenance = script.with_name("host-update-maintenance.py")
    if not script.is_file() or not os.access(script, os.X_OK):
        raise SystemExit("Native update runner not installed")
    with (data / ".host-update.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        if queue.is_symlink() or not queue.is_file():
            return
        processing = data / (".host-update-processing-" + str(os.getpid()) + ".json")
        queue.replace(processing)
        try:
            file_flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
            fd = os.open(processing, file_flags)
            with os.fdopen(fd, "r", encoding="utf-8") as request_file:
                metadata = os.fstat(request_file.fileno())
                if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 16384:
                    raise ValueError("Native updater request must be a bounded regular file")
                raw = request_file.read(16385)
                if len(raw) > 16384:
                    raise ValueError("Native updater request exceeds its size limit")
                request = json.loads(raw)
            if not isinstance(request, dict):
                raise ValueError("Invalid request")
            action = request.get("action")
            mode = request.get("mode")
            source = request.get("source_version")
            version = request.get("target_version")
            target = request.get("target_image", "")
            initiator = str(request.get("initiated_by", ""))
            reinstall = request.get("reinstall", False)
            if not isinstance(reinstall, bool) or (reinstall and action != "update"):
                raise ValueError("Invalid reinstall request")
            stable = r"ghcr\.io/gigabytegrove/npm-improved:v[0-9]+\.[0-9]+\.[0-9]+"
            if action not in {"update", "restart", "rollback"}:
                raise ValueError("Unsupported operation")
            if mode not in {"sqlite", "mysql", "postgres"}:
                raise ValueError("Invalid database mode")
            if request.get("project_dir") != str(root):
                raise ValueError("Project mismatch")
            if not re.fullmatch(r"[0-9]{1,12}", initiator):
                raise ValueError("Invalid administrator identity")
            if not isinstance(source, str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,40}", source):
                raise ValueError("Invalid source version")
            if not isinstance(version, str) or not re.fullmatch(
                r"(?:v?[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]{1,20})?|previous|unknown|local)", version
            ):
                raise ValueError("Invalid destination version")
            if not isinstance(target, str):
                raise ValueError("Invalid target image")
            if action == "update" and not re.fullmatch(stable, target):
                raise ValueError("Only official stable releases may be installed")
            if action == "update" and target.rsplit(":", 1)[1] != "v" + version.lstrip("v"):
                raise ValueError("Requested image tag and version do not match")
            if action == "rollback" and target != "npm-improved:local" and not re.fullmatch(stable, target):
                raise ValueError("Invalid rollback image")
            if action == "rollback" and target != "npm-improved:local" and target.rsplit(":", 1)[1] != "v" + version.lstrip("v"):
                raise ValueError("Rollback image tag and version do not match")
            if action == "restart" and target:
                raise ValueError("Restart may not replace the image")
            env = dict(os.environ,
                NPM_UPDATE_PROJECT_DIR=str(root),
                NPM_UPDATE_STATUS_FILE=str(data / "update-status.json"),
                NPM_UPDATE_INITIATED_BY=initiator,
                NPM_UPDATE_REINSTALL="1" if reinstall else "0",
            )
            result = subprocess.run(
                [str(script), action, target, mode, source, version],
                cwd=root, env=env, check=False,
            )
            if result.returncode:
                raise SystemExit(result.returncode)

            # Application replacement is verified. Update the native host
            # programs from the *published* matching release in-place.
            # An unreachable GitHub release must never undo a healthy app.
            # The host's periodic maintenance timer retries failed refreshes.
            app_release = version if action == "update" else source
            if re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", app_release.lstrip("v")):
                try:
                    command = [str(maintenance), str(root), "--version", app_release.lstrip("v")]
                    if reinstall:
                        command.append("--force")
                    subprocess.run(command, check=True, timeout=110)
                except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
                    print(f"Native updater will retry maintenance: {error}", file=sys.stderr)
        except (ValueError, TypeError, OSError, json.JSONDecodeError) as error:
            status_path = data / "update-status.json"
            try:
                status = json.loads(status_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                status = {}
            status.update(state="failed", message="Native host updater rejected request.",
                          error=str(error))
            temp = data / (".host-update-status-" + str(os.getpid()))
            descriptor = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                output.write(json.dumps(status, indent=2) + "\n")
            temp.replace(status_path)
            raise SystemExit(str(error))
        finally:
            processing.unlink(missing_ok=True)

if __name__ == "__main__":
    main()

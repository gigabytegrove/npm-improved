#!/usr/bin/env python3
"""systemd-launched, root-owned in-place updater. Creates NO containers."""
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys

def main():
    if len(sys.argv) != 2:
        raise SystemExit("Project path required")
    root = Path(sys.argv[1]).resolve()
    if not root.is_absolute() or not (root / ".env").is_file():
        raise SystemExit("Invalid NPMi project directory")
    data = root / "data"
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
        if not queue.is_file() or queue.is_symlink():
            return
        processing = data / (".host-update-processing-" + str(os.getpid()) + ".json")
        queue.replace(processing)
        try:
            request = json.loads(processing.read_text(encoding="utf-8"))
            if not isinstance(request, dict):
                raise ValueError("Invalid request")
            action = request.get("action")
            mode = request.get("mode")
            source = request.get("source_version")
            version = request.get("target_version")
            target = request.get("target_image", "")
            initiator = str(request.get("initiated_by", ""))
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
            if action == "rollback" and target != "npm-improved:local" and not re.fullmatch(stable, target):
                raise ValueError("Invalid rollback image")
            if action == "restart" and target:
                raise ValueError("Restart may not replace the image")
            env = dict(os.environ,
                NPM_UPDATE_PROJECT_DIR=str(root),
                NPM_UPDATE_STATUS_FILE=str(data / "update-status.json"),
                NPM_UPDATE_INITIATED_BY=initiator,
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
                    subprocess.run(
                        [str(maintenance), str(root), "--version", app_release.lstrip("v")],
                        check=True, timeout=110,
                    )
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
            temp.write_text(json.dumps(status, indent=2) + "\n", encoding="utf-8")
            os.chmod(temp, 0o600)
            temp.replace(status_path)
            raise SystemExit(str(error))
        finally:
            processing.unlink(missing_ok=True)

if __name__ == "__main__":
    main()

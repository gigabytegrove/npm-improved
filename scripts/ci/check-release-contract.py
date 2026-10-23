#!/usr/bin/env python3
"""Fail-closed static checks on NPM Improved release publishing contracts."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
workflow = (ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")
maintenance = (ROOT / "scripts/host-update-maintenance.py").read_text(encoding="utf-8")
dispatch = (ROOT / "scripts/host-update-dispatch.py").read_text(encoding="utf-8")
handoff = (ROOT / "scripts/update-handoff.sh").read_text(encoding="utf-8")
issues = []
def require(condition, message):
    if not condition:
        issues.append(message)

require("git push --force" not in workflow and "git tag -f" not in workflow,
        "Mutable published Git tags are forbidden")
require("gh release upload" not in workflow or "--clobber" not in workflow,
        "Replacing published release assets is forbidden")
require("republish_current" not in workflow, "Same-version republishing is forbidden")
require('RELEASE_EXISTS=false' in workflow and 'releases/tags/$TAG' in workflow,
        "Release existence must be initialized and checked")
require('exit 1' in workflow.split('Release $TAG already exists;')[1].split("RELEASE_EXISTS=false")[0]
        if 'Release $TAG already exists;' in workflow else False,
        "Existing release must fail closed")
require("provenance: mode=max" in workflow and "sbom: true" in workflow,
        "Container provenance or SBOM attestations missing")
require("python3 scripts/ci/check-release-contract.py" in workflow,
        "Release must execute this contract test")
require("verify_and_extract(" in maintenance and "hashlib.sha256(package)" in maintenance,
        "Updater archive checksum verification was removed")
require("len(members) != len(PROGRAMS)" in maintenance and "sum(member.size for member in members)" in maintenance,
        "Duplicate and oversized extracted updater archive protection missing")
require("MAX_PACKAGE_BYTES" in maintenance and "member.isfile()" in maintenance,
        "Host updater archive path and type guards missing")

require("O_NOFOLLOW" in dispatch and "stat.S_ISREG" in dispatch and "request_file.read(16385)" in dispatch,
        "Native queued request must be opened without following symlinks")
require("Requested image tag and version do not match" in dispatch,
        "Native updater must reject image-version mismatches")
require('if [ -L "$stage_dir" ]' in handoff and 'gzip -t "$bundle"' in handoff,
        "Release fallback must reject symlink staging and test gzip integrity")
require("Native host updater downgrade is not permitted" in maintenance, "Forced native updater downgrades must fail")
require("temporary.chmod(0o600)" in maintenance,
        "Updater maintenance status must not be world-readable")
if issues:
    for issue in issues:
        print("FAIL:", issue, file=sys.stderr)
    sys.exit(1)
print("PASS: release publishing and native updater static contracts")

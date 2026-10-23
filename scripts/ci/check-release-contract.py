#!/usr/bin/env python3
"""Fail-closed static checks on NPM Improved release publishing contracts."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
workflow = (ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")
maintenance = (ROOT / "scripts/host-update-maintenance.py").read_text(encoding="utf-8")
issues = []
def require(condition, message):
    if not condition:
        issues.append(message)

require("git push --force" not in workflow and "git tag -f" not in workflow,
        "Mutable published Git tags are forbidden")
require("gh release upload" not in workflow or "--clobber" not in workflow,
        "Replacing published release assets is forbidden")
require("republish_current" not in workflow, "Same-version republishing is forbidden")
require('RELEASE_EXISTS=false' in workflow and 'gh release view "$TAG"' in workflow,
        "Release existence must be initialized and checked")
require('exit 1' in workflow.split('Release $TAG already exists;')[1].split("RELEASE_EXISTS=false")[0]
        if 'Release $TAG already exists;' in workflow else False,
        "Existing release must fail closed")
require("python3 scripts/ci/check-release-contract.py" in workflow,
        "Release must execute this contract test")
require("verify_and_extract(" in maintenance and "hashlib.sha256(package)" in maintenance,
        "Updater archive checksum verification was removed")
require("MAX_PACKAGE_BYTES" in maintenance and "member.isfile()" in maintenance,
        "Host updater archive path and type guards missing")

if issues:
    for issue in issues:
        print("FAIL:", issue, file=sys.stderr)
    sys.exit(1)
print("PASS: release publishing and native updater static contracts")

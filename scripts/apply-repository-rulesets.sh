#!/usr/bin/env bash
set -euo pipefail

API_VERSION="2026-03-10"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
RULESET_DIR="${ROOT_DIR}/.github/rulesets"

for cmd in gh jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: required command '$cmd' is not installed." >&2
    exit 1
  fi
done

if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI is not authenticated. Run: gh auth login" >&2
  exit 1
fi

REPO="${GH_REPO:-}"
if [[ -z "$REPO" ]]; then
  REPO="$(cd "$ROOT_DIR" && gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)"
fi
if [[ -z "$REPO" ]]; then
  REPO="gigabytegrove/npm-improved"
fi

echo "Applying repository rulesets to ${REPO}"

apply_ruleset() {
  local file="$1"
  local name
  local existing_id

  name="$(jq -r '.name' "$file")"
  if [[ -z "$name" || "$name" == "null" ]]; then
    echo "ERROR: $file does not contain a ruleset name." >&2
    exit 1
  fi

  existing_id="$(
    gh api       -H "Accept: application/vnd.github+json"       -H "X-GitHub-Api-Version: ${API_VERSION}"       --paginate       "repos/${REPO}/rulesets"       --jq ".[] | select(.name == \"$name\") | .id"       | head -n1
  )"

  if [[ -n "$existing_id" ]]; then
    echo "Updating ruleset: $name (id: $existing_id)"
    gh api       --method PUT       -H "Accept: application/vnd.github+json"       -H "X-GitHub-Api-Version: ${API_VERSION}"       "repos/${REPO}/rulesets/${existing_id}"       --input "$file" >/dev/null
  else
    echo "Creating ruleset: $name"
    gh api       --method POST       -H "Accept: application/vnd.github+json"       -H "X-GitHub-Api-Version: ${API_VERSION}"       "repos/${REPO}/rulesets"       --input "$file" >/dev/null
  fi
}

shopt -s nullglob
files=("${RULESET_DIR}"/*.json)
if (( ${#files[@]} == 0 )); then
  echo "ERROR: no ruleset JSON files found in ${RULESET_DIR}" >&2
  exit 1
fi

for file in "${files[@]}"; do
  apply_ruleset "$file"
done

echo
echo "Active repository rulesets:"
gh api   -H "Accept: application/vnd.github+json"   -H "X-GitHub-Api-Version: ${API_VERSION}"   "repos/${REPO}/rulesets"   --jq '.[] | "\(.name)\t\(.target)\t\(.enforcement)"'

echo
echo "Repository protection rulesets are applied."

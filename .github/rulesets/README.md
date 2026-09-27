# Repository protection

NPM Improved stores its intended GitHub repository rulesets here so protection is versioned with the project.

## Rulesets

- **Protect develop**: blocks deletion and force pushes, requires pull requests, requires resolved review threads, and requires the `Required Checks` GitHub Actions check to pass against the latest `develop` revision.
- **Protect release tags**: prevents published `v*` release tags from being deleted, moved, or rewritten.

The branch ruleset intentionally requires a pull request but does not require an approving review count. This keeps the repository safe from direct pushes while still allowing a single maintainer to operate the project without creating an impossible self-approval requirement.

Dependency review is not currently enforced because GitHub reports the repository Dependency Graph as disabled. Enable the Dependency Graph in the repository security settings before adding dependency review to the required merge gate.

## Applying the live GitHub rulesets

The JSON files are the canonical policy, but GitHub does not activate repository settings simply because the files exist in the repository.

Apply or reconcile the live rulesets with:

```bash
./scripts/apply-repository-rulesets.sh
```

The script is idempotent: existing rulesets with the same names are updated, otherwise they are created.

Requirements: GitHub CLI (`gh`), `jq`, and an authenticated account/token with repository Administration write permission.

After applying, verify the live rulesets with:

```bash
gh api \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  repos/gigabytegrove/npm-improved/rulesets \
  --jq '.[] | [.name, .target, .enforcement] | @tsv'
```

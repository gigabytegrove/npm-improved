# Repository protection

NPM Improved stores its intended GitHub repository rulesets here so protection is versioned with the project.

## Rulesets

- **Protect develop**: blocks deletion and force pushes, requires pull requests, requires resolved review threads, and requires the `Required Checks` GitHub Actions check to pass against the latest `develop` revision.
- **Protect release tags**: prevents published `v*` release tags from being deleted or rewritten.

The branch ruleset intentionally requires a pull request but does not require an approving review count. This keeps the repository safe from direct pushes while still allowing a single maintainer to operate the project without creating an impossible self-approval requirement.

Apply or reconcile the rulesets with:

```bash
./scripts/apply-repository-rulesets.sh
```

The script is idempotent: existing rulesets with the same names are updated, otherwise they are created.

Requirements: GitHub CLI (`gh`), `jq`, and an authenticated account/token with repository Administration write permission.

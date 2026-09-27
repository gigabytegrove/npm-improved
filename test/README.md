# Test suites

NPM Improved inherits and extends the upstream automated test structure.

## Frontend/backend required checks

The repository's `Required Checks` workflow runs:

- Go control-plane tests, race detector, vet, and build;
- backend unit tests, lint, and API schema validation;
- frontend tests, lint, and production build;
- documentation build.

## Cypress development tests

The Cypress test project lives under `test/`.

For local dependency installation:

```bash
cd test
yarn install
```

The repository development Docker stack includes Cypress-related services and fixtures. Prefer the repository scripts and compose files over assumptions copied from upstream NPM documentation.

## Adding tests

Changes to transactional configuration, protection policy, certificate lifecycle behavior, authentication, or security parsing should include focused regression tests whenever the behavior can be exercised without external infrastructure.

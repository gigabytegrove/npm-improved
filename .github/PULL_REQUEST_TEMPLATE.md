## Why

Describe the problem and why this change belongs in NPM Improved.

## What changed

Summarize the implementation.

## Failure / rollback behavior

For changes that affect Nginx, certificates, settings, persistent state, or deployment, explain what happens on validation/reload/runtime failure.

## Compatibility

- [ ] Preserves expected upstream NPM compatibility where practical
- [ ] API changes are documented
- [ ] Persistent-state / migration impact is documented
- [ ] Upgrade/downgrade implications are documented

## Validation

List the tests/checks actually run.

- [ ] Backend tests
- [ ] Frontend tests
- [ ] Control-plane Go tests
- [ ] API schema validation
- [ ] Documentation build
- [ ] Nginx/container behavior validated where applicable

## Documentation

- [ ] Root README updated if user-visible behavior changed
- [ ] VitePress docs updated if user/admin behavior changed
- [ ] SECURITY.md updated if security support/reporting changed
- [ ] Secondary contributor/backend READMEs updated where applicable

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation
- [ ] Refactor
- [ ] API change
- [ ] Performance
- [ ] Security hardening
- [ ] Tests

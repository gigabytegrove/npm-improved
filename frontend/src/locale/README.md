# Internationalisation support

## Development environment

Start the NPM Improved development stack:

```bash
git clone https://github.com/gigabytegrove/npm-improved.git
cd npm-improved
./scripts/start-dev -f
```

The development admin UI is exposed on port `3081` by default.

## Adding or updating translations

Edit files under:

```text
frontend/src/locale/src/
```

The development environment recompiles locale data during normal frontend work.

If you are not running the development stack, compile locales from the `frontend` directory:

```bash
yarn locale-compile
```

## Adding a language

A new language may require updates to:

- `frontend/src/locale/src/<language>.json`
- `frontend/src/locale/src/lang-list.json`
- `frontend/src/locale/src/HelpDoc/<language>/`
- `frontend/src/locale/src/HelpDoc/index.tsx`
- `frontend/src/locale/IntlProvider.tsx`
- `frontend/check-locales.cjs`

## Missing translations

From the `frontend` directory:

```bash
node check-locales.cjs
```

Inherited translation completeness gaps are currently reported by CI without blocking releases. New/modified English strings should still be added deliberately and kept understandable without relying on upstream branding.

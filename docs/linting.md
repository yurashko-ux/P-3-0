# Linting

The frontend in [`web/`](../web) is configured to use ESLint with the `next/core-web-vitals` ruleset.

Run lint checks locally before opening a pull request:

```bash
cd web
npm run lint
```

The same command runs in CI, so the lint step will fail if there are outstanding ESLint errors.

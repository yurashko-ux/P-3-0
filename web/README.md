# Web App Development Notes

## Linting

The web workspace uses Next.js and relies on the bundled ESLint configuration. To run the lint check locally:

1. Install dependencies with `npm install` (or `pnpm install`).
2. Run `npm run lint`.

> **Note:** CI environments without access to the npm registry will need a registry mirror or pre-installed Next.js/ESLint binaries, otherwise `npm run lint` will fail with `next: not found`.

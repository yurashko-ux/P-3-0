# P-3-0 Platform — Backend bootstrap

This document summarises the minimum configuration required to run the data-sync layer that powers the ManiChat → Alteg.io flows.

## 1. Environment variables

Copy `.env.example` to `.env` (or configure the secrets provider used by your runtime) and update the values:

| Variable | Description |
| --- | --- |
| `ALTEGRIO_BASE_URL` | Base URL for the Alteg.io API. |
| `ALTEGRIO_API_KEY` / `ALTEGRIO_API_SECRET` | Credentials issued by Alteg.io. Validate that the key pair is active before the first sync. |
| `MANICHAT_BASE_URL` / `MANICHAT_API_KEY` | ManiChat REST endpoint and API key for webhook operations. |
| `DATABASE_URL` | PostgreSQL connection string (Supabase is recommended; add `?sslmode=require` when using their hosted instance). |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Optional Supabase helpers if you prefer to manage the database via Supabase tooling. |
| `LOG_LEVEL` | Logger verbosity (`info` by default). |

> ℹ️ Both Alteg.io and ManiChat credentials have been double-checked with the client team. Rotate them in case of doubt and store the fresh values in your deployment platform (Vercel/Render/etc.).

## 2. Database

We use PostgreSQL (Supabase-compatible) for structured data. The migration scripts live in `lib/db/migrations`. Apply the initial schema with your preferred migration runner, for example:

```bash
psql "$DATABASE_URL" -f lib/db/migrations/0001_initial.sql
```

The schema provisions the following tables:

* `salons`, `clients`, `employees`, `services` — master data for the Alteg.io domain.
* `appointments`, `payments` — transactional entities.
* `sync_runs` — audit trail of raw payloads fetched from Alteg.io.

A thin database client is provided in `lib/db/client.ts` and exposes `query`, `getPool`, and `withConnection` helpers.

## 3. Integrations

`lib/integrations/altegrio` ships with a basic Axios client that handles retries and cursor-based pagination. Inject it into services as needed:

```ts
import { AltegrioClient } from '@/lib/integrations/altegrio';

const alteg = new AltegrioClient();
for await (const page of alteg.paginate('/clients')) {
  // Persist page.data
}
```

## 4. Logging & ETL skeleton

A shared logger lives in `lib/logger.ts` (Pino with pretty-printing in development).

The initial ETL loop (`lib/etl/index.ts`) stores the raw responses from Alteg.io into the `sync_runs` table. At this stage no transformations are applied; extend the module once the downstream models are ready.

Run a test sync after configuring the environment:

```ts
import { runAltegrioSync } from '@/lib/etl';

await runAltegrioSync({ endpoint: '/clients' });
```

Check the `sync_runs` table to inspect the captured payloads.

## 5. Additional references

* [Functional specification](./SPEC-P-3-0.md)
* Supabase docs — <https://supabase.com/docs>
* Alteg.io API reference — internal shared drive (see product brief)
* ManiChat API docs — <https://docs.mani.chat>

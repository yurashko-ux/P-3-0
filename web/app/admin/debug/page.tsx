// web/app/admin/debug/page.tsx
import { kv } from "@vercel/kv";
import { headers } from "next/headers";

import { KeycrmCardSearchWidget } from "@/components/admin/keycrm-card-search-widget";
import { ManychatMessageInbox } from "@/components/admin/manychat-message-inbox";
import { ManychatCampaignRouter } from "@/components/admin/manychat-campaign-router";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const IDS_KEY = "cmp:ids";
const ITEM_KEY = (id: string) => `cmp:item:${id}`;

type KvSnapshot = {
  env: {
    url: boolean;
    token: boolean;
    readOnly: boolean;
  };
  ids: string[];
  items: unknown[];
  error: string | null;
};

type ApiSnapshot = {
  ok: boolean;
  items: unknown[];
  meta: Record<string, unknown> | null;
  error: string | null;
};

type MemorySnapshot = {
  ids: string[];
  items: unknown[];
};

type KvRuntimeState = {
  disabled: boolean;
  error: string | null;
};

function readKvRuntimeState(): KvRuntimeState {
  const globalAny = globalThis as typeof globalThis & {
    __campaignKvState?: { disabled: boolean; error: Error | null };
  };
  const state = globalAny.__campaignKvState;
  return {
    disabled: Boolean(state?.disabled),
    error: state?.error?.message ?? null,
  };
}

function readMemorySnapshot(): MemorySnapshot {
  const globalAny = globalThis as typeof globalThis & {
    __campaignMemoryStore?: { ids: string[]; items: Record<string, unknown> };
  };
  const store = globalAny.__campaignMemoryStore;
  if (!store) {
    return { ids: [], items: [] };
  }
  const ids = Array.from(new Set(store.ids)).filter(Boolean);
  const items = ids
    .map((id) => store.items?.[id])
    .filter((value): value is unknown => value !== undefined && value !== null);
  return { ids, items };
}

async function readKvSnapshot(): Promise<KvSnapshot> {
  const env = {
    url: Boolean(process.env.KV_REST_API_URL),
    token: Boolean(process.env.KV_REST_API_TOKEN),
    readOnly: Boolean(process.env.KV_REST_API_READ_ONLY_TOKEN),
  };

  const base: KvSnapshot = { env, ids: [], items: [], error: null };

  if (!env.url || !env.token) {
    base.error = "KV середовище не налаштоване";
    return base;
  }

  try {
    const ids = await kv.lrange<string>(IDS_KEY, 0, -1);
    base.ids = Array.isArray(ids) ? ids.filter(Boolean) : [];
  } catch (err) {
    base.error = `kv.lrange: ${formatError(err)}`;
    return base;
  }

  if (!base.ids.length) {
    return base;
  }

  try {
    const values = await kv.mget(...base.ids.map(ITEM_KEY));
    base.items = Array.isArray(values)
      ? values.filter((item) => item !== null && item !== undefined)
      : [];
  } catch (err) {
    base.error = `kv.mget: ${formatError(err)}`;
  }

  return base;
}

async function readApiSnapshot(): Promise<ApiSnapshot> {
  const base: ApiSnapshot = { ok: false, items: [], meta: null, error: null };
  try {
    const h = headers();
    const proto = h.get("x-forwarded-proto") ?? "https";
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
    const res = await fetch(`${proto}://${host}/api/campaigns`, {
      cache: "no-store",
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      base.error = `HTTP ${res.status}`;
      return base;
    }
    const json: unknown = await res.json().catch(() => null);
    if (Array.isArray(json)) {
      base.ok = true;
      base.items = json;
      base.meta = { source: "array" };
      return base;
    }
    if (json && typeof json === "object") {
      const anyJson = json as Record<string, unknown>;
      const items = Array.isArray(anyJson.items) ? anyJson.items : [];
      base.ok = Boolean(anyJson.ok ?? true);
      base.items = items;
      base.meta = {
        ...("meta" in anyJson && typeof anyJson.meta === "object" ? (anyJson.meta as Record<string, unknown>) : {}),
      };
      return base;
    }
    base.error = "Невідомий формат відповіді";
  } catch (err) {
    base.error = formatError(err);
  }
  return base;
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function json(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    return `<< serialization error: ${formatError(err)} >>`;
  }
}

export default async function DebugPage() {
  const [kvSnapshot, apiSnapshot] = await Promise.all([readKvSnapshot(), readApiSnapshot()]);
  const memorySnapshot = readMemorySnapshot();
  const kvState = readKvRuntimeState();

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Адмін • Тестова сторінка</h1>
        <p className="text-sm text-slate-500">
          Допоміжна діагностика KV / fallback. Дані оновлюються при кожному запиті.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-800">Пошук карток KeyCRM</h2>
        <p className="mt-2 text-sm text-slate-500">
          Шукає card_id за повним ім&rsquo;ям або social_id контакту/клієнта. За потреби звузьте запит
          фільтрами pipeline_id та status_id, щоб уникнути rate limit.
        </p>
        <KeycrmCardSearchWidget />
      </section>

      <ManychatMessageInbox />

      <ManychatCampaignRouter />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-800">Статус KV</h2>
        <div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
          <div>
            <span className="font-medium text-slate-700">KV_REST_API_URL:</span> {kvSnapshot.env.url ? "налаштовано" : "немає"}
          </div>
          <div>
            <span className="font-medium text-slate-700">KV_REST_API_TOKEN:</span> {kvSnapshot.env.token ? "налаштовано" : "немає"}
          </div>
          <div>
            <span className="font-medium text-slate-700">Read-only token:</span> {kvSnapshot.env.readOnly ? "так" : "ні"}
          </div>
          <div>
            <span className="font-medium text-slate-700">KV disabled (runtime):</span> {kvState.disabled ? "так" : "ні"}
          </div>
          {kvState.error && (
            <div className="sm:col-span-2 text-red-600">
              Runtime error: <code>{kvState.error}</code>
            </div>
          )}
          {kvSnapshot.error && (
            <div className="sm:col-span-2 text-red-600">
              KV error: <code>{kvSnapshot.error}</code>
            </div>
          )}
          <div>
            <span className="font-medium text-slate-700">IDs (KV):</span> {kvSnapshot.ids.length}
          </div>
          <div>
            <span className="font-medium text-slate-700">Items (KV):</span> {kvSnapshot.items.length}
          </div>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="font-medium text-slate-700">KV ids</h3>
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
              {json(kvSnapshot.ids)}
            </pre>
          </div>
          <div>
            <h3 className="font-medium text-slate-700">KV items</h3>
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
              {json(kvSnapshot.items)}
            </pre>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-800">Fallback / API</h2>
        <div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
          <div>
            <span className="font-medium text-slate-700">API status:</span> {apiSnapshot.ok ? "ok" : "error"}
          </div>
          <div>
            <span className="font-medium text-slate-700">Items (API):</span> {apiSnapshot.items.length}
          </div>
          {apiSnapshot.meta && (
            <div className="sm:col-span-2">
              <span className="font-medium text-slate-700">Meta:</span>
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-slate-100 p-3 text-xs text-slate-700">
                {json(apiSnapshot.meta)}
              </pre>
            </div>
          )}
          {apiSnapshot.error && (
            <div className="sm:col-span-2 text-red-600">
              API error: <code>{apiSnapshot.error}</code>
            </div>
          )}
        </div>
        <div className="mt-4">
          <h3 className="font-medium text-slate-700">API items</h3>
          <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
            {json(apiSnapshot.items)}
          </pre>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-800">In-memory fallback</h2>
        <p className="mt-2 text-sm text-slate-500">
          Використовується, якщо KV недоступне під час обробки /api/campaigns. Дані живуть лише у процесі.
        </p>
        <div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
          <div>
            <span className="font-medium text-slate-700">IDs (memory):</span> {memorySnapshot.ids.length}
          </div>
          <div>
            <span className="font-medium text-slate-700">Items (memory):</span> {memorySnapshot.items.length}
          </div>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="font-medium text-slate-700">Memory ids</h3>
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
              {json(memorySnapshot.ids)}
            </pre>
          </div>
          <div>
            <h3 className="font-medium text-slate-700">Memory items</h3>
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
              {json(memorySnapshot.items)}
            </pre>
          </div>
        </div>
      </section>
    </main>
  );
}

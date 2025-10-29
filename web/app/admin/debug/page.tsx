// web/app/admin/debug/page.tsx
// Повноцінна діагностична сторінка (як у попередній адмінці).
// Дає зрозуміти стан інтеграцій, KV та останніх ManyChat подій.

import { headers } from 'next/headers';
import Link from 'next/link';
import { kvRead, campaignKeys } from '@/lib/kv';
import { store } from '@/lib/store';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

type KeycrmPing = {
  ok: boolean;
  status?: number;
  url?: string;
  authHeaderPreview?: string;
  startsWithBearer?: boolean;
  jsonKeys?: string[];
  snippet?: string;
  error?: string;
};

type KvCampaignItem = {
  id: string;
  raw: string | null;
  parsed: any;
};

type KvSnapshot = {
  indexIds: string[];
  items: KvCampaignItem[];
  legacyItemsRaw: any[];
  roIds: string[];
  wrIds: string[];
  env: {
    url: boolean;
    token: boolean;
    roToken: boolean;
  };
};

type ManyChatSnapshot = {
  simple: { key: string; raw: string | null; parsed: any }[];
  lists: { key: string; values: string[] }[];
};

type ApiCampaigns = {
  ok: boolean;
  status: number;
  items: any[];
  error?: string;
};

function safeParse(raw: string | null): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function jsonPreview(value: any) {
  if (value == null) return 'null';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function fetchKeycrmPing(baseUrl: string): Promise<KeycrmPing | null> {
  try {
    const res = await fetch(`${baseUrl}/api/keycrm/ping`, {
      cache: 'no-store',
      headers: {
        'x-admin-pass': process.env.ADMIN_PASS || '',
      },
    });
    const json = await res.json();
    return { ...json, status: res.status } as KeycrmPing;
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function fetchKvSnapshot(): Promise<KvSnapshot> {
  const env = {
    url: Boolean(process.env.KV_REST_API_URL || process.env.KV_URL),
    token: Boolean(process.env.KV_REST_API_TOKEN),
    roToken: Boolean(process.env.KV_REST_API_READ_ONLY_TOKEN),
  };

  const [indexIds, legacyItemsRaw, roIds, wrIds] = await Promise.all([
    kvRead.lrange(campaignKeys.INDEX_KEY, 0, 19).catch(() => [] as string[]),
    kvRead.lrange('cmp:list:items', 0, 19).catch(() => [] as string[]),
    kvRead.lrange('cmp:list:ids:RO', 0, 19).catch(() => [] as string[]),
    kvRead.lrange('cmp:list:ids:WR', 0, 19).catch(() => [] as string[]),
  ]);

  const limitedIds = indexIds.slice(0, 5);
  const items = await Promise.all(
    limitedIds.map(async (id): Promise<KvCampaignItem> => {
      const raw = await kvRead.getRaw(campaignKeys.ITEM_KEY(id));
      return { id, raw, parsed: safeParse(raw) };
    }),
  );

  return { indexIds, legacyItemsRaw, roIds, wrIds, items, env };
}

async function fetchManyChatSnapshot(): Promise<ManyChatSnapshot> {
  const simpleKeys = [
    'manychat:last-request',
    'manychat:last-feed',
    'manychat:last-trace',
    'manychat:last-raw',
    'manychat:last-json',
    'manychat:last-webhook',
    'manychat:last-payload',
    'manychat:last-response',
  ];

  const simple = await Promise.all(
    simpleKeys.map(async (key) => {
      const raw = await kvRead.getRaw(key);
      return { key, raw, parsed: safeParse(raw) };
    }),
  );

  const today = new Date();
  const dayKey = `logs:mc:${today.toISOString().slice(0, 10)}`;
  const prev = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const prevKey = `logs:mc:${prev.toISOString().slice(0, 10)}`;

  const listKeys = ['manychat:automation:journal', 'manychat:automation:trace', dayKey, prevKey];

  const lists = await Promise.all(
    listKeys.map(async (key) => {
      const values = await kvRead.lrange(key, 0, 19).catch(() => [] as string[]);
      return { key, values };
    }),
  );

  return { simple, lists };
}

async function fetchApiCampaigns(baseUrl: string): Promise<ApiCampaigns> {
  try {
    const res = await fetch(`${baseUrl}/api/campaigns`, {
      cache: 'no-store',
      headers: {
        cookie: headers().get('cookie') ?? '',
      },
    });
    const json = await res.json();
    return { ok: res.ok, status: res.status, items: Array.isArray(json) ? json : [] };
  } catch (e: any) {
    return { ok: false, status: 500, items: [], error: e?.message || String(e) };
  }
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="mb-4 space-y-1">
        <h2 className="text-xl font-semibold">{title}</h2>
        {description && <p className="text-sm text-slate-500">{description}</p>}
      </header>
      <div className="space-y-4 text-sm">{children}</div>
    </section>
  );
}

function KeyValue({ label, value, tone = 'default' }: { label: string; value: React.ReactNode; tone?: 'default' | 'success' | 'danger' | 'warning' }) {
  const toneClass =
    tone === 'success'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : tone === 'danger'
      ? 'bg-rose-50 text-rose-700 border-rose-200'
      : tone === 'warning'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-slate-50 text-slate-700 border-slate-200';
  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: any }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-600">{title}</h3>
      <pre className="max-h-72 overflow-auto rounded-2xl bg-slate-900 p-4 text-xs text-slate-100">
        {jsonPreview(value)}
      </pre>
    </div>
  );
}

async function loadDebugData() {
  const hdrs = headers();
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  const host = hdrs.get('host') ?? process.env.VERCEL_URL ?? 'localhost:3000';
  const baseUrl = `${proto}://${host}`;

  const [keycrmPing, kvSnapshot, manychat, apiCampaigns, fallbackItems] = await Promise.all([
    fetchKeycrmPing(baseUrl),
    fetchKvSnapshot(),
    fetchManyChatSnapshot(),
    fetchApiCampaigns(baseUrl),
    store.getAll().catch(() => [] as any[]),
  ]);

  return {
    baseUrl,
    keycrmPing,
    kvSnapshot,
    manychat,
    apiCampaigns,
    fallbackItems,
  };
}

export default async function AdminDebugPage() {
  const data = await loadDebugData();
  const { keycrmPing, kvSnapshot, manychat, apiCampaigns, fallbackItems } = data;

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Адмін • Тестова сторінка</h1>
        <p className="text-sm text-slate-500">
          Допоміжна діагностика KV / fallback. Дані оновлюються при кожному запиті.{' '}
          <Link href="/admin" className="underline">← До адмінки</Link>
        </p>
      </header>

      <Section
        title="Статус KeyCRM API"
        description="Перевіряємо налаштування токенів та фактичний доступ до REST." >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <KeyValue label="KEYCRM_API_URL" value={kvSnapshot.env.url ? 'вказано' : 'не задано'} tone={kvSnapshot.env.url ? 'success' : 'danger'} />
          <KeyValue label="KEYCRM_BEARER / KEYCRM_API_TOKEN" value={kvSnapshot.env.token ? 'наявний' : 'відсутній'} tone={kvSnapshot.env.token ? 'success' : 'danger'} />
          <KeyValue
            label="Ping"
            value={keycrmPing?.ok ? `OK (${keycrmPing?.status ?? 200})` : `Помилка${keycrmPing?.status ? ` (${keycrmPing.status})` : ''}`}
            tone={keycrmPing?.ok ? 'success' : 'danger'}
          />
        </div>
        {keycrmPing?.url && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <div><span className="font-semibold">URL:</span> {keycrmPing.url}</div>
            {keycrmPing.authHeaderPreview && (
              <div><span className="font-semibold">Auth:</span> {keycrmPing.authHeaderPreview}</div>
            )}
            {keycrmPing.jsonKeys?.length ? (
              <div><span className="font-semibold">Keys:</span> {keycrmPing.jsonKeys.join(', ')}</div>
            ) : null}
            {keycrmPing.snippet && (
              <div className="mt-2">
                <div className="font-semibold">Snippet</div>
                <pre className="mt-1 max-h-48 overflow-auto rounded-xl bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{keycrmPing.snippet}</pre>
              </div>
            )}
            {keycrmPing.error && (
              <div className="mt-2 text-rose-600">Помилка: {keycrmPing.error}</div>
            )}
          </div>
        )}
      </Section>

      <Section
        title="Очищення кампаній у KV"
        description="Перевіряємо індекси LIST та можливі застарілі ключі. Після тестів можна видалити через API /api/debug/migrate-campaigns." >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KeyValue label="LIST index" value={`${kvSnapshot.indexIds.length} ids`} tone={kvSnapshot.indexIds.length ? 'success' : 'warning'} />
          <KeyValue label="cmp:list:items" value={`${kvSnapshot.legacyItemsRaw.length} записів`} tone={kvSnapshot.legacyItemsRaw.length ? 'warning' : 'success'} />
          <KeyValue label="cmp:list:ids:RO" value={`${kvSnapshot.roIds.length}`} tone="default" />
          <KeyValue label="cmp:list:ids:WR" value={`${kvSnapshot.wrIds.length}`} tone="default" />
        </div>
        <p className="text-xs text-slate-500">
          Для повного очищення виконай <code className="rounded bg-slate-100 px-1 py-0.5">POST /api/debug/migrate-campaigns</code> з токеном <code>ADMIN_PASS</code> або ручно видали ключі <code>{campaignKeys.INDEX_KEY}</code> та <code>campaign:*.</code>
        </p>
        {kvSnapshot.items.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {kvSnapshot.items.map((it) => (
              <JsonBlock key={it.id} title={`campaign:${it.id}`} value={it.parsed ?? it.raw} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">У списку індексу немає активних кампаній.</p>
        )}
      </Section>

      <Section
        title="Журнал ManyChat-повідомлень"
        description="Відображаємо останні збережені ключі у KV та журнали логів." >
        <div className="grid gap-4 md:grid-cols-2">
          {manychat.simple.map((entry) => (
            <JsonBlock key={entry.key} title={entry.key} value={entry.parsed ?? entry.raw} />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {manychat.lists.map((entry) => (
            <div key={entry.key} className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-600">{entry.key}</h3>
              {entry.values.length ? (
                <pre className="max-h-64 overflow-auto rounded-2xl bg-slate-900 p-4 text-xs text-slate-100">
                  {entry.values.join('\n')}
                </pre>
              ) : (
                <p className="text-xs text-slate-500">Порожньо.</p>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="KV / API стан"
        description="Порівняння збережених кампаній у KV, відповіді API та in-memory fallback." >
        <div className="grid gap-4 lg:grid-cols-3">
          <JsonBlock title={`KV ids (${campaignKeys.INDEX_KEY})`} value={kvSnapshot.indexIds} />
          <JsonBlock title="KV items (cmp:list:items)" value={kvSnapshot.legacyItemsRaw} />
          <JsonBlock title="RO ids (cmp:list:ids:RO)" value={kvSnapshot.roIds} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <JsonBlock title={`API items (/api/campaigns) – ${apiCampaigns.ok ? 'ok' : 'error'}`} value={apiCampaigns.ok ? apiCampaigns.items : apiCampaigns.error} />
          <JsonBlock title="In-memory fallback (store.getAll)" value={fallbackItems} />
        </div>
      </Section>

      <Section
        title="Додаткові ресурси"
        description="Швидкі посилання на службові ендпоінти (відкриваються у новій вкладці)." >
        <div className="flex flex-wrap gap-3 text-sm">
          <a
            className="rounded-full border border-slate-200 px-4 py-2 text-slate-700 hover:bg-slate-50"
            href="/api/debug/kv"
            target="_blank"
            rel="noreferrer"
          >
            /api/debug/kv
          </a>
          <a
            className="rounded-full border border-slate-200 px-4 py-2 text-slate-700 hover:bg-slate-50"
            href="/api/campaigns/_debug"
            target="_blank"
            rel="noreferrer"
          >
            /api/campaigns/_debug
          </a>
          <a
            className="rounded-full border border-slate-200 px-4 py-2 text-slate-700 hover:bg-slate-50"
            href="/api/mc/manychat"
            target="_blank"
            rel="noreferrer"
          >
            /api/mc/manychat
          </a>
          <a
            className="rounded-full border border-slate-200 px-4 py-2 text-slate-700 hover:bg-slate-50"
            href="/api/keycrm/ping"
            target="_blank"
            rel="noreferrer"
          >
            /api/keycrm/ping
          </a>
        </div>
      </Section>
    </main>
  );
}

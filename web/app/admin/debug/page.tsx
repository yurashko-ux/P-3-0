// web/app/admin/debug/page.tsx
// Оригінальна тестова панель: діагностика ManyChat ↔ KeyCRM та KV.
// Сторінка живе лише на сервері (force-dynamic) і збирає дані щоразу при завантаженні.

import { headers } from 'next/headers';
import Link from 'next/link';
import {
  KeycrmSearchPanel,
  KeycrmInspectPanel,
  KeycrmManualMovePanel,
  ManychatNormalizePanel,
} from './client-panels';
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
  legacyItemsRaw: any[];
  roIds: string[];
  wrIds: string[];
  items: KvCampaignItem[];
  env: {
    url: boolean;
    token: boolean;
    roToken: boolean;
  };
  normalized: any[];
};

type ManyChatSimple = { key: string; raw: string | null; parsed: any };

type ManyChatList = {
  key: string;
  values: string[];
  parsed: any[];
};

type ManyChatSnapshot = {
  simple: ManyChatSimple[];
  lists: ManyChatList[];
};

type ApiCampaigns = {
  ok: boolean;
  status: number;
  items: any[];
  error?: string;
};

type DebugData = {
  baseUrl: string;
  envFlags: Record<string, boolean>;
  keycrmPing: KeycrmPing | null;
  kvSnapshot: KvSnapshot;
  manychat: ManyChatSnapshot;
  apiCampaigns: ApiCampaigns;
  fallbackItems: any[];
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
  const adminPass = process.env.ADMIN_PASS || '';
  try {
    const res = await fetch(`${baseUrl}/api/keycrm/ping`, {
      cache: 'no-store',
      headers: {
        ...(adminPass ? { Authorization: `Bearer ${adminPass}` } : {}),
        'x-admin-pass': adminPass,
      },
    });
    const json = await res.json().catch(() => ({}));
    return { ...json, status: res.status } as KeycrmPing;
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function fetchKvSnapshot(): Promise<KvSnapshot> {
  const env = {
    url: Boolean(process.env.KV_REST_API_URL || process.env.KV_URL),
    token: Boolean(process.env.KV_REST_API_TOKEN || process.env.KV_REST_TOKEN),
    roToken: Boolean(process.env.KV_REST_API_READ_ONLY_TOKEN),
  };

  const [indexIds, legacyItemsRaw, roIds, wrIds] = await Promise.all([
    kvRead.lrange(campaignKeys.INDEX_KEY, 0, 49).catch(() => [] as string[]),
    kvRead.lrange('cmp:list:items', 0, 19).catch(() => [] as string[]),
    kvRead.lrange('cmp:list:ids:RO', 0, 19).catch(() => [] as string[]),
    kvRead.lrange('cmp:list:ids:WR', 0, 19).catch(() => [] as string[]),
  ]);

  const limitedIds = indexIds.slice(0, 6);
  const items = await Promise.all(
    limitedIds.map(async (id): Promise<KvCampaignItem> => {
      const raw = await kvRead.getRaw(campaignKeys.ITEM_KEY(id));
      return { id, raw, parsed: safeParse(raw) };
    }),
  );

  let normalized: any[] = [];
  try {
    normalized = await kvRead.listCampaigns();
  } catch {
    normalized = [];
  }

  return { indexIds, legacyItemsRaw, roIds, wrIds, items, env, normalized };
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
      return { key, raw, parsed: safeParse(raw) } as ManyChatSimple;
    }),
  );

  const today = new Date();
  const prev = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const listKeys = [
    'manychat:automation:journal',
    'manychat:automation:trace',
    `logs:mc:${today.toISOString().slice(0, 10)}`,
    `logs:mc:${prev.toISOString().slice(0, 10)}`,
  ];

  const lists = await Promise.all(
    listKeys.map(async (key) => {
      const values = await kvRead.lrange(key, 0, 19).catch(() => [] as string[]);
      const parsed = values.map((value) => {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      });
      return { key, values, parsed } as ManyChatList;
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
    const json = await res.json().catch(() => []);
    return { ok: res.ok, status: res.status, items: Array.isArray(json) ? json : [], error: res.ok ? undefined : json?.error };
  } catch (e: any) {
    return { ok: false, status: 500, items: [], error: e?.message || String(e) };
  }
}

function Section({ title, description, children }: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
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

function KeyValue({ label, value, tone = 'default' }: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'success' | 'danger' | 'warning';
}) {
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

function CampaignTable({ items }: { items: any[] }) {
  if (!items.length) {
    return <p className="text-sm text-slate-500">У KV немає жодної кампанії.</p>;
  }

  return (
    <div className="overflow-hidden rounded-2xl border">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2 text-left">ID</th>
            <th className="px-4 py-2 text-left">Назва</th>
            <th className="px-4 py-2 text-left">Pipeline / Status</th>
            <th className="px-4 py-2 text-left">V1/V2/EXP</th>
            <th className="px-4 py-2 text-left">Створено</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item) => (
            <tr key={item.id} className="bg-white">
              <td className="px-4 py-2 font-mono text-xs">{item.id}</td>
              <td className="px-4 py-2">{item.name || <span className="text-slate-400">(без назви)</span>}</td>
              <td className="px-4 py-2 text-xs text-slate-600">
                <div>Pipeline: {item.base_pipeline_id ?? item.base?.pipeline ?? '—'}</div>
                <div>Status: {item.base_status_id ?? item.base?.status ?? '—'}</div>
              </td>
              <td className="px-4 py-2 text-xs text-slate-600">
                <div>v1: {item.v1_count ?? item.counters?.v1 ?? 0}</div>
                <div>v2: {item.v2_count ?? item.counters?.v2 ?? 0}</div>
                <div>exp: {item.exp_count ?? item.counters?.exp ?? 0}</div>
              </td>
              <td className="px-4 py-2 text-xs text-slate-600">
                {item.created_at ? new Date(Number(item.created_at)).toLocaleString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ManyChatLogs({ lists }: { lists: ManyChatList[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {lists.map((entry) => (
        <div key={entry.key} className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-600">{entry.key}</h3>
          {entry.parsed.length ? (
            <pre className="max-h-80 overflow-auto rounded-2xl bg-slate-900 p-4 text-xs text-slate-100">
              {jsonPreview(entry.parsed)}
            </pre>
          ) : (
            <p className="text-xs text-slate-500">Порожньо.</p>
          )}
        </div>
      ))}
    </div>
  );
}

async function loadDebugData(): Promise<DebugData> {
  const hdrs = headers();
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  const host = hdrs.get('host') ?? process.env.VERCEL_URL ?? 'localhost:3000';
  const baseUrl = `${proto}://${host}`;

  const envFlags = {
    ADMIN_PASS: Boolean(process.env.ADMIN_PASS),
    KEYCRM_TOKEN: Boolean(process.env.KEYCRM_API_TOKEN || process.env.KEYCRM_BEARER || process.env.KEYCRM_TOKEN),
    KEYCRM_URL: Boolean(process.env.KEYCRM_API_URL || process.env.KEYCRM_BASE_URL),
    MC_TOKEN: Boolean(process.env.MC_TOKEN || process.env.MANYCHAT_TOKEN),
    KV_URL: Boolean(process.env.KV_REST_API_URL || process.env.KV_URL),
    KV_TOKEN: Boolean(process.env.KV_REST_API_TOKEN || process.env.KV_REST_TOKEN),
    KV_RO_TOKEN: Boolean(process.env.KV_REST_API_READ_ONLY_TOKEN),
  };

  const [keycrmPing, kvSnapshot, manychat, apiCampaigns, fallbackItems] = await Promise.all([
    fetchKeycrmPing(baseUrl),
    fetchKvSnapshot(),
    fetchManyChatSnapshot(),
    fetchApiCampaigns(baseUrl),
    store.getAll().catch(() => [] as any[]),
  ]);

  return {
    baseUrl,
    envFlags,
    keycrmPing,
    kvSnapshot,
    manychat,
    apiCampaigns,
    fallbackItems,
  };
}

export default async function AdminDebugPage() {
  const data = await loadDebugData();
  const { keycrmPing, kvSnapshot, manychat, apiCampaigns, fallbackItems, envFlags } = data;

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Адмін • Тестова сторінка</h1>
        <p className="text-sm text-slate-500">
          Діагностика інтеграцій ManyChat ↔ KeyCRM, KV та службових API. Дані оновлюються при кожному завантаженні.
          <span className="ml-2" />
          <Link href="/admin" className="underline">
            ← До адмінки
          </Link>
        </p>
      </header>

      <Section
        title="ENV та доступи"
        description="Швидка перевірка наявності секретів у Vercel."
      >
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {Object.entries(envFlags).map(([key, value]) => (
            <KeyValue
              key={key}
              label={key}
              value={value ? 'налаштовано' : 'відсутній'}
              tone={value ? 'success' : 'danger'}
            />
          ))}
        </div>
      </Section>

      <Section
        title="Статус KeyCRM API"
        description="Перевіряємо налаштування токенів та фактичний доступ до REST."
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <KeyValue
            label="KEYCRM_API_URL / BASE"
            value={envFlags.KEYCRM_URL ? 'вказано' : 'не задано'}
            tone={envFlags.KEYCRM_URL ? 'success' : 'danger'}
          />
          <KeyValue
            label="Bearer"
            value={envFlags.KEYCRM_TOKEN ? 'наявний' : 'відсутній'}
            tone={envFlags.KEYCRM_TOKEN ? 'success' : 'danger'}
          />
          <KeyValue
            label="Ping"
            value={keycrmPing?.ok ? `OK (${keycrmPing?.status ?? 200})` : `Помилка${keycrmPing?.status ? ` (${keycrmPing.status})` : ''}`}
            tone={keycrmPing?.ok ? 'success' : 'danger'}
          />
        </div>
        {keycrmPing?.url && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <div>
              <span className="font-semibold">URL:</span> {keycrmPing.url}
            </div>
            {keycrmPing.authHeaderPreview && (
              <div>
                <span className="font-semibold">Auth:</span> {keycrmPing.authHeaderPreview}
              </div>
            )}
            {keycrmPing.jsonKeys?.length ? (
              <div>
                <span className="font-semibold">Keys:</span> {keycrmPing.jsonKeys.join(', ')}
              </div>
            ) : null}
            {keycrmPing.snippet && (
              <div className="mt-2">
                <div className="font-semibold">Snippet</div>
                <pre className="mt-1 max-h-48 overflow-auto rounded-xl bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
                  {keycrmPing.snippet}
                </pre>
              </div>
            )}
            {keycrmPing.error && (
              <div className="mt-2 text-rose-600">Помилка: {keycrmPing.error}</div>
            )}
          </div>
        )}
      </Section>

      <Section
        title="KV кампанії"
        description="Звірка LIST-індексів, нормалізованих кампаній та бекових fallback-даних."
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KeyValue
            label={`Index (${campaignKeys.INDEX_KEY})`}
            value={`${kvSnapshot.indexIds.length} ids`}
            tone={kvSnapshot.indexIds.length ? 'success' : 'warning'}
          />
          <KeyValue
            label="cmp:list:items"
            value={`${kvSnapshot.legacyItemsRaw.length} записів`}
            tone={kvSnapshot.legacyItemsRaw.length ? 'warning' : 'success'}
          />
          <KeyValue label="cmp:list:ids:RO" value={`${kvSnapshot.roIds.length}`} tone="default" />
          <KeyValue label="cmp:list:ids:WR" value={`${kvSnapshot.wrIds.length}`} tone="default" />
        </div>
        <p className="text-xs text-slate-500">
          Для повного очищення виконай <code className="rounded bg-slate-100 px-1 py-0.5">POST /api/debug/migrate-campaigns</code> з
          токеном <code>ADMIN_PASS</code> або вручну видали ключі <code>{campaignKeys.INDEX_KEY}</code> та <code>campaign:*.</code>
        </p>
        <CampaignTable items={kvSnapshot.normalized.slice(0, 8)} />
        {kvSnapshot.items.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {kvSnapshot.items.map((it) => (
              <JsonBlock key={it.id} title={`campaign:${it.id}`} value={it.parsed ?? it.raw} />
            ))}
          </div>
        ) : null}
      </Section>

      <Section
        title="ManyChat журнали"
        description="Останні payload / відповіді та журнали автоматизацій."
      >
        <div className="grid gap-4 md:grid-cols-2">
          {manychat.simple.map((entry) => (
            <JsonBlock key={entry.key} title={entry.key} value={entry.parsed ?? entry.raw} />
          ))}
        </div>
        <ManyChatLogs lists={manychat.lists} />
      </Section>

      <Section
        title="Порівняння API / fallback"
        description="Якщо /api/campaigns віддає помилку — дивимось на in-memory store."
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <JsonBlock
            title={`API items (/api/campaigns) – ${apiCampaigns.ok ? 'ok' : 'error'}`}
            value={apiCampaigns.ok ? apiCampaigns.items : apiCampaigns.error}
          />
          <JsonBlock title="In-memory fallback (store.getAll)" value={fallbackItems} />
        </div>
      </Section>

      <Section
        title="Інтерактивні інструменти"
        description="Нижче — форми для ручної перевірки ManyChat payload та пошуку карток у KeyCRM."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4 lg:col-span-2">
            <h3 className="text-base font-semibold text-slate-700">KeyCRM • Ручний пошук і переміщення картки</h3>
            <KeycrmManualMovePanel />
          </div>
          <div className="space-y-4">
            <h3 className="text-base font-semibold text-slate-700">KeyCRM • Пошук картки за Instagram</h3>
            <KeycrmSearchPanel />
          </div>
          <div className="space-y-4">
            <h3 className="text-base font-semibold text-slate-700">KeyCRM • Inspect card</h3>
            <KeycrmInspectPanel />
          </div>
          <div className="space-y-4 lg:col-span-2">
            <h3 className="text-base font-semibold text-slate-700">ManyChat • Нормалізація пейлоада</h3>
            <ManychatNormalizePanel />
          </div>
        </div>
      </Section>

      <Section
        title="Додаткові ресурси"
        description="Швидкі посилання на службові ендпоінти (відкриваються у новій вкладці)."
      >
        <div className="flex flex-wrap gap-3 text-sm">
          <a className="rounded-full border border-slate-200 px-4 py-2 text-slate-700 hover:bg-slate-50" href="/api/debug/kv" target="_blank" rel="noreferrer">
            /api/debug/kv
          </a>
          <a className="rounded-full border border-slate-200 px-4 py-2 text-slate-700 hover:bg-slate-50" href="/api/campaigns/_debug" target="_blank" rel="noreferrer">
            /api/campaigns/_debug
          </a>
          <a className="rounded-full border border-slate-200 px-4 py-2 text-slate-700 hover:bg-slate-50" href="/api/mc/manychat" target="_blank" rel="noreferrer">
            /api/mc/manychat
          </a>
          <a className="rounded-full border border-slate-200 px-4 py-2 text-slate-700 hover:bg-slate-50" href="/api/keycrm/ping" target="_blank" rel="noreferrer">
            /api/keycrm/ping
          </a>
          <a className="rounded-full border border-slate-200 px-4 py-2 text-slate-700 hover:bg-slate-50" href="/api/keycrm/inspect-card?card_id=123" target="_blank" rel="noreferrer">
            /api/keycrm/inspect-card
          </a>
          <a className="rounded-full border border-slate-200 px-4 py-2 text-slate-700 hover:bg-slate-50" href="/api/keycrm/card/by-social?social_id=test&pipeline_id=1&status_id=1" target="_blank" rel="noreferrer">
            /api/keycrm/card/by-social
          </a>
          <a className="rounded-full border border-slate-200 px-4 py-2 text-slate-700 hover:bg-slate-50" href="/api/map/ig" target="_blank" rel="noreferrer">
            /api/map/ig
          </a>
        </div>
      </Section>
    </main>
  );
}

// web/app/admin/campaigns/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type Any = Record<string, any>;
type Campaign = Any & {
  id?: string | number;
  name?: string;
  enabled?: boolean;
  base_pipeline_id?: string;
  base_status_id?: string;
  v1_to_pipeline_id?: string;
  v1_to_status_id?: string;
  exp_days?: number;
};

type FetchMeta = {
  url: string;
  ok: boolean;
  status: number;
  text: string;
  json: any;
};

const LIST_URLS = [
  '/api/campaigns',
  '/api/admin/campaigns',
  '/api/campaigns/list',
  '/api/list/campaigns',
  '/api/campaign/list',
];

function normalizeArray(x: any): any[] {
  // прямий масив
  if (Array.isArray(x)) return x;

  // поширені обгортки
  const tryKeys = [
    'items', 'data', 'result', 'rows', 'list', 'campaigns',
    ['data', 'items'],
    ['data', 'result'],
    ['data', 'list'],
    ['data', 'rows'],
    ['data', 'campaigns'],
  ];

  for (const k of tryKeys) {
    if (Array.isArray(k)) {
      let cur: any = x;
      for (const seg of k) cur = cur?.[seg];
      if (Array.isArray(cur)) return cur;
    } else {
      const v = x?.[k];
      if (Array.isArray(v)) return v;
    }
  }

  // словник {id: {...}, id2: {...}}
  if (x && typeof x === 'object') {
    const vals = Object.values(x);
    if (vals.length && vals.every(v => v && typeof v === 'object')) return vals as any[];
  }

  return [];
}

async function fetchWithMeta(url: string): Promise<FetchMeta> {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    const text = await r.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    return { url, ok: r.ok, status: r.status, text, json };
  } catch {
    return { url, ok: false, status: 0, text: '', json: null };
  }
}

async function loadList(): Promise<{ items: Campaign[]; meta: FetchMeta[] }> {
  const meta: FetchMeta[] = [];
  for (const u of LIST_URLS) {
    const m = await fetchWithMeta(u);
    meta.push(m);
    if (m.ok && (Array.isArray(m.json) || (m.json && typeof m.json === 'object'))) {
      const arr = normalizeArray(m.json);
      if (Array.isArray(arr)) return { items: arr as Campaign[], meta };
    }
  }
  return { items: [], meta };
}

// ------- утиліти для лічильників -------

const pickNum = (o: Any | null, keys: string[], d = 0): number => {
  const val = o ? keys.map(k => o[k]).find(v => Number.isFinite(+v)) : undefined;
  return (val ?? d) as number;
};
const pickDate = (o: Any | null, keys: string[]) => {
  if (!o) return '';
  for (const k of keys) {
    const d = new Date(o[k]);
    if (!isNaN(+d)) return d.toLocaleString();
  }
  return '';
};
const idOf = (c: Campaign) => String(c?.id ?? c?._id ?? c?.uuid ?? '');

// ------- сторінка -------

export default function CampaignsPage() {
  const [all, setAll] = useState<Campaign[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [meta, setMeta] = useState<FetchMeta[] | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  // toolbar
  const [q, setQ] = useState('');
  const [onlyEnabled, setOnlyEnabled] = useState<'all' | 'on' | 'off'>('all');
  const [sort, setSort] = useState<'name' | 'updated' | 'created'>('name');

  useEffect(() => {
    (async () => {
      const res = await loadList();
      setMeta(res.meta);
      setAll(res.items);
      // якщо всі відповіді неок або json не містить список — покажемо err тільки якщо була явна 5xx
      const first = res.meta.find(m => m.ok || m.status);
      if (!res.items.length && first && first.status >= 500) setErr(String(first.status));
    })();
  }, []);

  const items = useMemo(() => {
    let r = Array.isArray(all) ? [...all] : [];
    if (q.trim()) {
      const qq = q.trim().toLowerCase();
      r = r.filter(c =>
        (c?.name ?? '').toLowerCase().includes(qq) ||
        idOf(c).toLowerCase().includes(qq)
      );
    }
    if (onlyEnabled !== 'all') {
      const flag = onlyEnabled === 'on';
      r = r.filter(c => (c?.enabled ?? true) === flag);
    }
    if (sort === 'name') {
      r.sort((a,b) => String(a?.name ?? '').localeCompare(String(b?.name ?? '')));
    }
    return r;
  }, [all, q, onlyEnabled, sort]);

  const createdMsg = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('created') ? 'Кампанію створено успішно.' : '';
  }, []);

  // чи є підозра, що бек віддає не той формат
  const maybeWrongShape = useMemo(() => {
    if (!meta) return false;
    // якщо був бодай один 200/201/204 але масиву не дістали — показати підказку
    return !items.length && meta.some(m => m.ok);
  }, [meta, items.length]);

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">Кампанії</h1>
        <Link href="/admin/campaigns/new" className="rounded-2xl px-4 py-2 border bg-blue-600 text-white">
          Нова кампанія
        </Link>
      </div>

      {createdMsg && (
        <div className="rounded-2xl border border-green-300 bg-green-50 px-4 py-3 text-sm">
          {createdMsg}
        </div>
      )}

      {err && (
        <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm">
          Не вдалося завантажити список ({err}). Сторінка працює, можна створювати нові.
        </div>
      )}

      <div className="rounded-2xl border p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          className="rounded-xl border px-3 py-2"
          placeholder="Пошук по назві або ID…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="rounded-xl border px-3 py-2"
          value={onlyEnabled}
          onChange={(e) => setOnlyEnabled(e.target.value as any)}
        >
          <option value="all">Статус: усі</option>
          <option value="on">Тільки увімкнені</option>
          <option value="off">Тільки вимкнені</option>
        </select>
        <select
          className="rounded-xl border px-3 py-2"
          value={sort}
          onChange={(e) => setSort(e.target.value as any)}
        >
          <option value="name">Сортування: за назвою</option>
          <option value="updated">Сортування: за оновленням</option>
          <option value="created">Сортування: за створенням</option>
        </select>
      </div>

      {/* підказка, якщо відповідь є, але формат не список */}
      {maybeWrongShape && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
          Отримали відповідь від API, але не змогли знайти список кампаній у полі
          <code className="mx-1">items / data.items / campaigns / rows</code>.  
          Можеш натиснути “Показати debug”, щоб побачити сирі відповіді.
          <button
            className="ml-3 rounded-xl border px-3 py-1"
            onClick={() => setShowDebug(v => !v)}
          >
            {showDebug ? 'Сховати debug' : 'Показати debug'}
          </button>
        </div>
      )}

      {showDebug && meta && (
        <div className="rounded-2xl border p-4 text-xs space-y-3 overflow-auto">
          {meta.map((m, i) => (
            <div key={i} className="border rounded-lg p-3">
              <div><b>URL:</b> {m.url}</div>
              <div><b>Status:</b> {m.status} {m.ok ? 'OK' : ''}</div>
              <div className="mt-2">
                <b>Body:</b>
                <pre className="whitespace-pre-wrap break-words">
                  {m.text?.slice(0, 2000) || '(empty)'}
                </pre>
              </div>
            </div>
          ))}
        </div>
      )}

      {items === null ? (
        <div>Завантаження…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-500">Поки що порожньо.</div>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          {items.map((c, i) => <CampaignCard key={idOf(c) || i} campaign={c} />)}
        </div>
      )}
    </div>
  );
}

// ---- картка кампанії ----
function CampaignCard({ campaign }: { campaign: Campaign }) {
  const [stats, setStats] = useState<Any | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const cid = idOf(campaign);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      const meta = await Promise.all([
        fetchWithMeta(`/api/campaigns/${encodeURIComponent(cid)}/stats`),
        fetchWithMeta(`/api/campaigns/stats?id=${encodeURIComponent(cid)}`),
        fetchWithMeta(`/api/campaigns/stats?campaign_id=${encodeURIComponent(cid)}`),
        fetchWithMeta(`/api/stats/campaign?id=${encodeURIComponent(cid)}`),
      ]);
      const ok = meta.find(m => m.ok);
      const parsed = ok?.json ?? null;
      if (live) { setStats(parsed); setLoading(false); }
    })();
    return () => { live = false; };
  }, [cid]);

  const cnt = {
    base:      pickNum(stats, ['base','base_count','baseTotal','in_base'], 0),
    v1:        pickNum(stats, ['v1','v1_matches','variant1','matched_v1'], 0),
    v2:        pickNum(stats, ['v2','v2_matches','variant2','matched_v2'], 0),
    queued:    pickNum(stats, ['queued','queue','pending'], 0),
    moved:     pickNum(stats, ['moved','processed','updated','migrations'], 0),
    expiring:  pickNum(stats, ['expiring','exp_due','to_expire'], 0),
    success:   pickNum(stats, ['success','ok'], 0),
    failed:    pickNum(stats, ['failed','errors','error'], 0),
    lastRun:   pickDate(stats, ['last_run','lastRun','updated_at','last_update']),
  };

  async function toggle(next: boolean) {
    if (toggling) return;
    setToggling(true);
    try {
      const body = { id: cid, enabled: next };
      const reqs: [string, RequestInit][] = [
        ['/api/campaigns/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }],
        [`/api/campaigns/${encodeURIComponent(cid)}/toggle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }],
        [`/api/campaigns/${encodeURIComponent(cid)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }],
      ];
      let ok = false;
      for (const [u, init] of reqs) {
        try { const r = await fetch(u, init); if (r.ok) { ok = true; break; } } catch {}
      }
      if (ok) (campaign as any).enabled = next;
      else alert('Не вдалося змінити стан кампанії.');
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="rounded-2xl border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-medium truncate">{campaign?.name ?? `Кампанія #${cid || '—'}`}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            База: {campaign?.base_pipeline_id ?? '—'}/{campaign?.base_status_id ?? '—'} ·{' '}
            Куди (V1): {campaign?.v1_to_pipeline_id ?? '—'}/{campaign?.v1_to_status_id ?? '—'} ·{' '}
            Expire: {campaign?.exp_days ?? '—'} дн.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm">{(campaign?.enabled ?? true) ? 'Увімкнена' : 'Вимкнена'}</span>
          <button
            onClick={() => toggle(!(campaign?.enabled ?? true))}
            disabled={toggling}
            className="rounded-xl border px-3 py-1 text-sm disabled:opacity-50"
          >
            {(campaign?.enabled ?? true) ? 'Вимкнути' : 'Увімкнути'}
          </button>
          {cid && (
            <>
              <a href={`/admin/campaigns/${encodeURIComponent(cid)}`} className="rounded-xl border px-3 py-1 text-sm">Відкрити</a>
              <a href={`/admin/campaigns/${encodeURIComponent(cid)}/edit`} className="rounded-xl border px-3 py-1 text-sm">Редагувати</a>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <Stat label="У базі" value={cnt.base} loading={loading} />
        <Stat label="V1 збігів" value={cnt.v1} loading={loading} />
        <Stat label="V2 збігів" value={cnt.v2} loading={loading} />
        <Stat label="У черзі" value={cnt.queued} loading={loading} />
        <Stat label="Перенесено" value={cnt.moved} loading={loading} />
        <Stat label="До експайру" value={cnt.expiring} loading={loading} />
        <Stat label="Успіхів" value={cnt.success} loading={loading} />
        <Stat label="Помилок" value={cnt.failed} loading={loading} />
      </div>

      <div className="mt-3 text-xs text-gray-500">Останній запуск: {cnt.lastRun || '—'}</div>
    </div>
  );
}

function Stat({ label, value, loading }: { label: string; value: number | string; loading: boolean }) {
  return (
    <div className="rounded-xl border p-3 text-center">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold mt-1">{loading ? '…' : (value === 0 ? '0' : (value || '—'))}</div>
    </div>
  );
}

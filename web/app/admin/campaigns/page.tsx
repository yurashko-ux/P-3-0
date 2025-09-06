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

function arr(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') {
    for (const k of ['items', 'data', 'result', 'rows', 'list']) {
      if (Array.isArray((x as any)[k])) return (x as any)[k];
    }
  }
  return [];
}
async function tryJson(urls: string | string[]) {
  const list = Array.isArray(urls) ? urls : [urls];
  for (const u of list) {
    try {
      const r = await fetch(u, { cache: 'no-store' });
      if (!r.ok) continue;
      const t = await r.text();
      try { return JSON.parse(t); } catch {}
    } catch {}
  }
  return null;
}
const pickNum = (o: Any | null, keys: string[], d = 0) =>
  (o && keys.map(k => o[k]).find(v => Number.isFinite(+v)) ?? d) as number;
const pickDate = (o: Any | null, keys: string[]) => {
  if (!o) return '';
  for (const k of keys) {
    const d = new Date(o[k]);
    if (!isNaN(+d)) return d.toLocaleString();
  }
  return '';
};
const idOf = (c: Campaign) => String(c?.id ?? c?._id ?? c?.uuid ?? '');

export default function CampaignsPage() {
  const [all, setAll] = useState<Campaign[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // toolbar
  const [q, setQ] = useState('');
  const [onlyEnabled, setOnlyEnabled] = useState<'all' | 'on' | 'off'>('all');
  const [sort, setSort] = useState<'name' | 'updated' | 'created'>('name');

  // load list
  useEffect(() => {
    (async () => {
      try {
        const j = await tryJson(['/api/campaigns', '/api/campaigns/list']);
        const list = arr(j);
        setAll(list);
        if (!Array.isArray(list)) throw new Error('500');
      } catch (e: any) {
        setErr(e?.message || '500');
        setAll([]); // все одно рендеримо
      }
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

      {/* toolbar */}
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

      {err && (
        <div className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm">
          Не вдалося завантажити список ({err}). Сторінка працює, можна створювати нові.
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

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const [stats, setStats] = useState<Any | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const cid = idOf(campaign);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true);
      const s = await tryJson([
        `/api/campaigns/${encodeURIComponent(cid)}/stats`,
        `/api/campaigns/stats?id=${encodeURIComponent(cid)}`,
        `/api/campaigns/stats?campaign_id=${encodeURIComponent(cid)}`,
        `/api/stats/campaign?id=${encodeURIComponent(cid)}`,
      ]);
      if (live) { setStats(s); setLoading(false); }
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

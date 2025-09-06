// web/app/admin/campaigns/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type AnyObj = Record<string, any>;
type Campaign = AnyObj & { id?: string | number; name?: string; enabled?: boolean };

function toArray(x: any): any[] {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') {
    for (const k of ['items', 'data', 'result', 'rows', 'list']) {
      if (Array.isArray((x as any)[k])) return (x as any)[k];
    }
  }
  return [];
}

async function tryFetchJson(urls: string | string[]) {
  const list = Array.isArray(urls) ? urls : [urls];
  for (const u of list) {
    try {
      const r = await fetch(u, { cache: 'no-store' });
      if (!r.ok) continue;
      const t = await r.text();
      try { return JSON.parse(t); } catch { /* sometimes HTML */ }
    } catch { /* ignore */ }
  }
  return null;
}

function pick(obj: AnyObj | null, keys: string[], def: any = 0) {
  if (!obj) return def;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() && !isNaN(Number(v))) return Number(v);
  }
  return def;
}

function pickDate(obj: AnyObj | null, keys: string[]) {
  if (!obj) return '';
  for (const k of keys) {
    const v = obj[k];
    if (!v) continue;
    const d = new Date(v);
    if (!isNaN(+d)) return d.toLocaleString();
  }
  return '';
}

function idOf(c: Campaign) {
  return String(c?.id ?? c?._id ?? c?.uuid ?? '');
}

export default function CampaignsPage() {
  const [items, setItems] = useState<Campaign[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // завантаження списку
  useEffect(() => {
    (async () => {
      try {
        const j = await tryFetchJson(['/api/campaigns', '/api/campaigns/list']);
        const arr = toArray(j);
        setItems(arr);
        if (!Array.isArray(arr)) throw new Error('500');
      } catch (e: any) {
        setErr(e?.message || '500');
        setItems([]); // все одно рендеримо
      }
    })();
  }, []);

  // banner "створено"
  const createdMsg = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('created') ? 'Кампанію створено успішно.' : '';
  }, [typeof window]);

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Кампанії</h1>
        <Link href="/admin/campaigns/new" className="rounded-xl px-4 py-2 border bg-blue-600 text-white">
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

      {items === null ? (
        <div>Завантаження…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-500">Поки що порожньо.</div>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          {items.map((c: Campaign, idx: number) => (
            <CampaignCard key={idOf(c) || idx} campaign={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const [stats, setStats] = useState<AnyObj | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggleBusy, setToggleBusy] = useState(false);

  const cid = idOf(campaign);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const s = await tryFetchJson([
        `/api/campaigns/${encodeURIComponent(cid)}/stats`,
        `/api/campaigns/stats?id=${encodeURIComponent(cid)}`,
        `/api/campaigns/stats?campaign_id=${encodeURIComponent(cid)}`,
        `/api/stats/campaign?id=${encodeURIComponent(cid)}`
      ]);
      if (alive) { setStats(s); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [cid]);

  const counts = {
    base:        pick(stats, ['base','base_count','baseTotal','base_total','in_base'], 0),
    v1Matches:   pick(stats, ['v1_matches','v1','variant1','matched_v1'], 0),
    v2Matches:   pick(stats, ['v2_matches','v2','variant2','matched_v2'], 0),
    moved:       pick(stats, ['moved','updated','processed','migrations'], 0),
    expiring:    pick(stats, ['exp_due','expiring','to_expire'], 0),
    success:     pick(stats, ['success','ok'], 0),
    failed:      pick(stats, ['failed','errors','error'], 0),
    queued:      pick(stats, ['queue','queued','pending'], 0),
    lastRun:     pickDate(stats, ['last_run','lastRun','updated_at','last_update']),
  };

  async function toggleEnabled(next: boolean) {
    if (toggleBusy) return;
    setToggleBusy(true);
    try {
      const body = { id: cid, enabled: next };
      const targets = [
        ['/api/campaigns/toggle', 'POST'],
        [`/api/campaigns/${encodeURIComponent(cid)}/toggle`, 'POST'],
        [`/api/campaigns/${encodeURIComponent(cid)}`, next ? 'PATCH' : 'PATCH'],
      ] as const;

      let ok = false;
      for (const [u, m] of targets) {
        try {
          const r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          if (r.ok) { ok = true; break; }
        } catch { /* ignore */ }
      }
      if (ok) {
        // відобразити локально
        (campaign as any).enabled = next;
      } else {
        alert('Не вдалося змінити стан кампанії (toggle).');
      }
    } finally {
      setToggleBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border p-5">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-medium truncate">{campaign?.name ?? `Кампанія #${cid || '—'}`}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            База: {campaign?.base_pipeline_id ?? '—'}/{campaign?.base_status_id ?? '—'} ·
            {' '}Куди (V1): {campaign?.v1_to_pipeline_id ?? '—'}/{campaign?.v1_to_status_id ?? '—'} ·
            {' '}Expire: {campaign?.exp_days ?? '—'} дн.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm">{(campaign?.enabled ?? true) ? 'Увімкнена' : 'Вимкнена'}</span>
          <button
            onClick={() => toggleEnabled(!(campaign?.enabled ?? true))}
            disabled={toggleBusy}
            className="rounded-xl border px-3 py-1 text-sm disabled:opacity-50"
          >
            {(campaign?.enabled ?? true) ? 'Вимкнути' : 'Увімкнути'}
          </button>
          {/* дії (лінки-«гачки» — підлаштуються під твої маршрути) */}
          {String(cid) && (
            <>
              <a href={`/admin/campaigns/${encodeURIComponent(cid)}`} className="rounded-xl border px-3 py-1 text-sm">Відкрити</a>
              <a href={`/admin/campaigns/${encodeURIComponent(cid)}/edit`} className="rounded-xl border px-3 py-1 text-sm">Редагувати</a>
            </>
          )}
        </div>
      </div>

      {/* counters */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <Stat label="У базі"      value={counts.base}      loading={loading} />
        <Stat label="V1 збігів"   value={counts.v1Matches} loading={loading} />
        <Stat label="V2 збігів"   value={counts.v2Matches} loading={loading} />
        <Stat label="У черзі"     value={counts.queued}    loading={loading} />
        <Stat label="Перенесено"  value={counts.moved}     loading={loading} />
        <Stat label="До експайру" value={counts.expiring}  loading={loading} />
        <Stat label="Успіхів"     value={counts.success}   loading={loading} />
        <Stat label="Помилок"     value={counts.failed}    loading={loading} />
      </div>

      {/* footer */}
      <div className="mt-3 text-xs text-gray-500">
        Останній запуск: {counts.lastRun || '—'}
      </div>
    </div>
  );
}

function Stat({ label, value, loading }: { label: string; value: number | string; loading: boolean }) {
  return (
    <div className="rounded-xl border p-3 text-center">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold mt-1">
        {loading ? '…' : (value === 0 ? '0' : (value || '—'))}
      </div>
    </div>
  );
}

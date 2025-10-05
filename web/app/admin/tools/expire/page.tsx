// web/app/admin/tools/expire/page.tsx
'use client';

import React from 'react';

type IdName = {
  pipeline?: string;
  status?: string;
  pipelineName?: string;
  statusName?: string;
};

type CampaignItem = {
  id: string;
  name: string;
  base?: IdName;
  texp?: IdName;
  expDays?: number;
  exp?: number;
  expireDays?: number;
  expire?: number;
  vexp?: number;
};

type BaseCard = {
  cardId: string;
  enteredAt: number | null;
  enteredAtRaw?: string | null;
  fetchedAt: number;
};

type CollectResult = {
  ok: boolean;
  campaignId: string;
  pipelineId?: string;
  statusId?: string;
  updatedAt?: number;
  listed: number;
  detailFetched: number;
  cards: BaseCard[];
  errors: string[];
  message?: string;
};

const fmtDate = (ts?: number | null) => {
  if (!ts || !Number.isFinite(ts)) return '—';
  try {
    const d = new Date(ts);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  } catch {
    return String(ts);
  }
};

function getExpDays(c: CampaignItem): number | null {
  const candidates = [c.expDays, c.exp, c.expireDays, c.expire, c.vexp];
  for (const value of candidates) {
    if (value == null) continue;
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return null;
}

export default function ExpireToolPage() {
  const [campaigns, setCampaigns] = React.useState<CampaignItem[]>([]);
  const [selectedId, setSelectedId] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<CollectResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function loadCampaigns() {
      try {
        const res = await fetch('/api/campaigns', {
          cache: 'no-store',
          credentials: 'include',
        });
        const json = (await res.json().catch(() => [])) as CampaignItem[];
        if (cancelled) return;
        const withExp = json.filter((c) => getExpDays(c) && c.base?.pipeline && c.base?.status);
        setCampaigns(withExp);
        if (withExp.length && !selectedId) {
          setSelectedId(withExp[0].id);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Не вдалося завантажити кампанії');
      }
    }
    loadCampaigns();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const current = campaigns.find((c) => c.id === selectedId) || null;

  async function runCollect() {
    if (!selectedId) {
      setError('Оберіть кампанію');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/tools/campaign-exp/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ campaign_id: selectedId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        const err = json?.error || res.statusText || 'Не вдалося виконати запит';
        setError(err);
        return;
      }
      const resultData = json.result as CollectResult;
      setResult(resultData);
      console.log('collectBaseCards', {
        campaignId: selectedId,
        cards: resultData?.cards?.map((c) => ({
          cardId: c.cardId,
          enteredAt: c.enteredAt,
          enteredAtRaw: c.enteredAtRaw,
        })),
        updatedAt: resultData?.updatedAt,
      });
    } catch (e: any) {
      setError(e?.message || 'Помилка виконання');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Manual EXP collect</h1>
        <p className="text-sm text-slate-500">
          Запускає helper, що тягне картки з базової воронки/статусу кампанії та оновлює кеш
          <code className="ml-1">
            cmp:base-entered:{'{'}campaignId{'}'}
          </code>
          .
        </p>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <label className="block text-sm font-semibold text-slate-600">Кампанія</label>
        <select
          className="w-full rounded border px-3 py-2"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">— Оберіть кампанію з EXP —</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} (#{c.id})
            </option>
          ))}
        </select>

        {current && (
          <div className="text-sm text-slate-600 space-y-1">
            <div>
              <span className="font-semibold">База:</span>{' '}
              {current.base?.pipelineName || current.base?.pipeline || '—'} →{' '}
              {current.base?.statusName || current.base?.status || '—'}
            </div>
            <div>
              <span className="font-semibold">Expire →</span>{' '}
              {current.texp?.pipelineName || current.texp?.pipeline || '—'} →{' '}
              {current.texp?.statusName || current.texp?.status || '—'}
            </div>
            <div>
              <span className="font-semibold">Днів до експірації:</span>{' '}
              {getExpDays(current) ?? '—'}
            </div>
          </div>
        )}

        <button
          onClick={runCollect}
          disabled={loading || !selectedId}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {loading ? 'Збираємо…' : 'Зібрати базові картки'}
        </button>

        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>

      {result && (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Результат</h2>
            <span className="text-sm text-slate-500">Оновлено: {fmtDate(result.updatedAt)}</span>
          </div>
          <div className="text-sm text-slate-700">
            <div>Карток у списку: <strong>{result.listed}</strong></div>
            <div>Деталей отримано: <strong>{result.detailFetched}</strong></div>
          </div>

          {result.errors?.length ? (
            <details className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <summary className="cursor-pointer font-semibold">Попередження ({result.errors.length})</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {result.errors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-600">Картки</h3>
            {result.cards.length === 0 ? (
              <div className="text-sm text-slate-500">Не знайдено активних карток у базовому статусі.</div>
            ) : (
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="w-1/4 px-2 py-1">Card ID</th>
                    <th className="w-1/4 px-2 py-1">Entered at</th>
                    <th className="w-1/4 px-2 py-1">Raw</th>
                    <th className="w-1/4 px-2 py-1">Fetched</th>
                  </tr>
                </thead>
                <tbody>
                  {result.cards.map((card) => (
                    <tr key={card.cardId} className="border-t">
                      <td className="px-2 py-1 font-mono text-xs">{card.cardId}</td>
                      <td className="px-2 py-1">{fmtDate(card.enteredAt)}</td>
                      <td className="px-2 py-1 text-xs text-slate-500">{card.enteredAtRaw || '—'}</td>
                      <td className="px-2 py-1 text-xs text-slate-500">{fmtDate(card.fetchedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

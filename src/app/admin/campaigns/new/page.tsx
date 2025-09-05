// src/app/admin/campaigns/new/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';

type Pipeline = { id: string; title: string };
type Status = { id: string; pipeline_id: string; title: string };

function pickArray(json: any): any[] {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.data?.data)) return json.data.data;
  if (Array.isArray(json?.items)) return json.items;
  return [];
}

export default function NewCampaignPage() {
  const [loading, setLoading] = useState(true);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [fromPipeline, setFromPipeline] = useState('');
  const [fromStatus, setFromStatus] = useState('');
  const [toPipeline, setToPipeline] = useState('');
  const [toStatus, setToStatus] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [note, setNote] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [pRes, sRes] = await Promise.all([
          fetch('/api/keycrm/pipelines', { cache: 'no-store' }),
          fetch('/api/keycrm/statuses', { cache: 'no-store' }),
        ]);
        const pJson = await pRes.json().catch(() => ({}));
        const sJson = await sRes.json().catch(() => ({}));
        const ps = pickArray(pJson).map((p: any) => ({ id: String(p.id), title: String(p.title ?? p.name ?? p.alias ?? p.id) }));
        const ss = pickArray(sJson).map((s: any) => ({
          id: String(s.id),
          pipeline_id: String(s.pipeline_id ?? s.pipelineId ?? s.pipeline ?? ''),
          title: String(s.title ?? s.name ?? s.alias ?? s.id),
        }));
        setPipelines(ps);
        setStatuses(ss);
      } catch {
        setError('Не вдалося завантажити воронки/статуси');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const fromStatusOptions = useMemo(
    () => statuses.filter((s) => !fromPipeline || s.pipeline_id === fromPipeline),
    [statuses, fromPipeline]
  );
  const toStatusOptions = useMemo(
    () => statuses.filter((s) => !toPipeline || s.pipeline_id === toPipeline),
    [statuses, toPipeline]
  );

  useEffect(() => setFromStatus(''), [fromPipeline]);
  useEffect(() => setToStatus(''), [toPipeline]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from_pipeline_id: fromPipeline,
          from_status_id: fromStatus,
          to_pipeline_id: toPipeline,
          to_status_id: toStatus,
          expires_at: expiresAt || null,
          note: note || null,
          enabled,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Не вдалося зберегти кампанію');

      alert('Кампанію збережено ✅');
      // Якщо сторінки списку ще немає — можеш залишитись на цій сторінці
      // або зміни лінк нижче, коли зробимо список:
      if (typeof window !== 'undefined') {
        window.location.href = '/admin/campaigns';
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6">Завантаження…</div>;

  return (
    <div className="max-w-3xl p-6 mx-auto">
      <h1 className="text-2xl font-semibold mb-4">New Campaign</h1>

      {error && (
        <div className="mb-4 rounded-md border border-red-300 p-3 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <fieldset className="border rounded-md p-4">
          <legend className="px-2 text-sm font-medium">Звідки</legend>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm">From Pipeline</span>
              <select className="border rounded-md p-2" required value={fromPipeline} onChange={(e) => setFromPipeline(e.target.value)}>
                <option value="">— Оберіть —</option>
                {pipelines.map((p) => <option key={`fp-${p.id}`} value={p.id}>{p.title}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm">From Status</span>
              <select className="border rounded-md p-2" required value={fromStatus} onChange={(e) => setFromStatus(e.target.value)} disabled={!fromPipeline}>
                <option value="">— Оберіть —</option>
                {fromStatusOptions.map((s) => <option key={`fs-${s.id}`} value={s.id}>{s.title}</option>)}
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset className="border rounded-md p-4">
          <legend className="px-2 text-sm font-medium">Куди</legend>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm">To Pipeline</span>
              <select className="border rounded-md p-2" required value={toPipeline} onChange={(e) => setToPipeline(e.target.value)}>
                <option value="">— Оберіть —</option>
                {pipelines.map((p) => <option key={`tp-${p.id}`} value={p.id}>{p.title}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm">To Status</span>
              <select className="border rounded-md p-2" required value={toStatus} onChange={(e) => setToStatus(e.target.value)} disabled={!toPipeline}>
                <option value="">— Оберіть —</option>
                {toStatusOptions.map((s) => <option key={`ts-${s.id}`} value={s.id}>{s.title}</option>)}
              </select>
            </label>
          </div>
        </fieldset>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm">Expires at (optional)</span>
            <input type="date" className="border rounded-md p-2" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 mt-6">
            <input type="checkbox" className="h-4 w-4" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span className="text-sm">Enabled</span>
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Note (optional)</span>
          <textarea className="border rounded-md p-2 min-h-[80px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Коментар до кампанії…" />
        </label>

        <div className="flex gap-3">
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-md border bg-black text-white disabled:opacity-60">
            {saving ? 'Збереження…' : 'Зберегти'}
          </button>
          <a href="/admin/campaigns" className="px-4 py-2 rounded-md border">Скасувати</a>
        </div>
      </form>
    </div>
  );
}

// web/app/(admin)/campaigns/new/page.tsx
'use client';

import React from 'react';

type Op = 'contains' | 'equals';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(
    new RegExp('(?:^|;\\s*)' + name.replace(/[-[\]{}()*+?^$|\\]/g, '\\$&') + '=([^;]*)')
  );
  return m ? decodeURIComponent(m[1]) : null;
}

function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get('token');
  if (fromQuery) {
    try {
      document.cookie = `admin_token=${encodeURIComponent(fromQuery)}; Path=/; SameSite=Lax`;
    } catch {}
    return fromQuery;
  }
  const fromCookie = readCookie('admin_token');
  if (fromCookie) return fromCookie;

  // як тимчасовий резерв — localStorage
  try {
    const fromLS = localStorage.getItem('admin_token');
    if (fromLS) return fromLS;
  } catch {}
  return null;
}

export default function NewCampaignPage() {
  const [name, setName] = React.useState('UI-created');
  const [pipeline, setPipeline] = React.useState<string>('111');
  const [status, setStatus] = React.useState<string>('222');

  const [v1op, setV1op] = React.useState<Op>('contains');
  const [v1val, setV1val] = React.useState('ціна');

  const [v2op, setV2op] = React.useState<Op>('equals');
  const [v2val, setV2val] = React.useState('привіт');

  const [submitting, setSubmitting] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMsg(null);
    setErr(null);

    const token = getAdminToken();
    if (!token) {
      setErr('Немає admin токена. Додай ?token=11111 в URL, або встанови cookie "admin_token".');
      setSubmitting(false);
      return;
    }

    const payload = {
      name,
      base_pipeline_id: Number.isNaN(Number(pipeline)) ? pipeline : Number(pipeline),
      base_status_id: Number.isNaN(Number(status)) ? status : Number(status),
      rules: {
        v1: { op: v1op, value: v1val },
        v2: { op: v2op, value: v2val },
      },
    };

    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': token,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let detail = '';
        try {
          const j = await res.json();
          detail = j?.error || JSON.stringify(j);
        } catch {}
        throw new Error(`${res.status} ${detail}`.trim());
      }

      const data = await res.json();
      setMsg(`Готово! Створено id=${data?.id ?? '—'}`);
    } catch (e: any) {
      setErr(`Не вдалося зберегти: ${e?.message ?? e}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Нова кампанія</h1>

      {err && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-700">
          {err}
        </div>
      )}
      {msg && (
        <div className="mb-4 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-green-700">
          {msg}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4 bg-white rounded-lg border p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Назва</span>
            <input
              className="border rounded-lg px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Назва кампанії"
              required
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Pipeline ID</span>
            <input
              className="border rounded-lg px-3 py-2"
              value={pipeline}
              onChange={(e) => setPipeline(e.target.value)}
              placeholder="наприклад 111"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-gray-600">Status ID</span>
            <input
              className="border rounded-lg px-3 py-2"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder="наприклад 222"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <fieldset className="border rounded-lg p-3">
            <legend className="px-1 text-sm text-gray-700">V1 правило</legend>
            <div className="flex gap-2 items-center">
              <select
                className="border rounded-lg px-2 py-2"
                value={v1op}
                onChange={(e) => setV1op(e.target.value as Op)}
              >
                <option value="contains">contains</option>
                <option value="equals">equals</option>
              </select>
              <input
                className="border rounded-lg px-3 py-2 flex-1"
                value={v1val}
                onChange={(e) => setV1val(e.target.value)}
                placeholder="значення"
              />
            </div>
          </fieldset>

          <fieldset className="border rounded-lg p-3">
            <legend className="px-1 text-sm text-gray-700">V2 правило</legend>
            <div className="flex gap-2 items-center">
              <select
                className="border rounded-lg px-2 py-2"
                value={v2op}
                onChange={(e) => setV2op(e.target.value as Op)}
              >
                <option value="contains">contains</option>
                <option value="equals">equals</option>
              </select>
              <input
                className="border rounded-lg px-3 py-2 flex-1"
                value={v2val}
                onChange={(e) => setV2val(e.target.value)}
                placeholder="значення"
              />
            </div>
          </fieldset>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg px-4 py-2 border bg-black text-white disabled:opacity-50"
          >
            {submitting ? 'Зберігаю…' : 'Зберегти'}
          </button>
          <a href="/admin/campaigns" className="rounded-lg px-4 py-2 border">
            До списку
          </a>
        </div>

        <p className="text-xs text-gray-500">
          Підказка: можна відкрити сторінку так — <code>/admin/campaigns/new?token=11111</code>,
          щоб токен автоматично підхопився та записався в cookie.
        </p>
      </form>
    </main>
  );
}

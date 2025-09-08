// web/app/admin/tools/ingest/page.tsx
'use client';

import React, { useEffect, useState } from 'react';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border p-4 md:p-6">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Field({
  label, value, setValue, placeholder, type = 'text',
}: {
  label: string; value: string; setValue: (v: string) => void;
  placeholder?: string; type?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm text-gray-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="rounded-lg border px-3 py-2 text-sm outline-none"
      />
    </label>
  );
}

export default function ToolsIngestPage() {
  // Ingest
  const [mcToken, setMcToken] = useState('');
  const [username, setUsername] = useState('');
  const [text, setText] = useState('');
  const [cardId, setCardId] = useState('');
  const [ingestResp, setIngestResp] = useState<any>(null);
  const [ingestLoading, setIngestLoading] = useState(false);

  // Move
  const [moveCardId, setMoveCardId] = useState('');
  const [toPipeline, setToPipeline] = useState('');
  const [toStatus, setToStatus] = useState('');
  const [moveResp, setMoveResp] = useState<any>(null);
  const [moveLoading, setMoveLoading] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('mc_token') || '';
    if (saved) setMcToken(saved);
  }, []);
  useEffect(() => {
    if (mcToken) localStorage.setItem('mc_token', mcToken);
  }, [mcToken]);

  async function onIngestSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIngestLoading(true);
    setIngestResp(null);
    try {
      const qs = new URLSearchParams();
      if (mcToken) qs.set('token', mcToken);
      if (cardId) qs.set('card_id', cardId);
      const r = await fetch(`/api/mc/ingest?${qs.toString()}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, text }),
      });
      const j = await r.json();
      setIngestResp(j);
    } catch (err) {
      setIngestResp({ ok: false, error: String(err) });
    } finally {
      setIngestLoading(false);
    }
  }

  async function onMoveSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMoveLoading(true);
    setMoveResp(null);
    try {
      const r = await fetch('/api/keycrm/card/move', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_id: moveCardId,
          to_pipeline_id: toPipeline,
          to_status_id: toStatus,
        }),
      });
      const j = await r.json();
      setMoveResp(j);
    } catch (err) {
      setMoveResp({ ok: false, error: String(err) });
    } finally {
      setMoveLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin Tools</h1>
        <a href="/admin/campaigns" className="rounded-full border px-3 py-1.5 text-sm">← До кампаній</a>
      </div>

      <div className="grid gap-6">
        <Section title="ManiChat → /api/mc/ingest (POST)">
          <form onSubmit={onIngestSubmit} className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="MC_TOKEN" value={mcToken} setValue={setMcToken} placeholder="секрет токен" />
              <Field label="card_id (опц., для швидкого тесту)" value={cardId} setValue={setCardId} placeholder="CARD_ID" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="username (IG)" value={username} setValue={setUsername} placeholder="ig_login" />
              <Field label="text" value={text} setValue={setText} placeholder="yes / ключове слово" />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={ingestLoading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                Відправити ingest
              </button>
              <button
                type="button"
                className="rounded-lg border px-3 py-2 text-sm"
                onClick={() => setIngestResp(null)}
              >
                Очистити
              </button>
            </div>
          </form>
          {ingestResp && (
            <pre className="mt-3 overflow-auto rounded-lg border bg-gray-50 p-3 text-xs">
              {JSON.stringify(ingestResp, null, 2)}
            </pre>
          )}
        </Section>

        <Section title="KeyCRM Move → /api/keycrm/card/move (POST)">
          <form onSubmit={onMoveSubmit} className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="card_id" value={moveCardId} setValue={setMoveCardId} placeholder="CARD_ID" />
              <Field label="to_pipeline_id" value={toPipeline} setValue={setToPipeline} placeholder="PID" />
              <Field label="to_status_id" value={toStatus} setValue={setToStatus} placeholder="SID" />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={moveLoading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                Тест move
              </button>
              <button
                type="button"
                className="rounded-lg border px-3 py-2 text-sm"
                onClick={() => setMoveResp(null)}
              >
                Очистити
              </button>
            </div>
          </form>
          {moveResp && (
            <pre className="mt-3 overflow-auto rounded-lg border bg-gray-50 p-3 text-xs">
              {JSON.stringify(moveResp, null, 2)}
            </pre>
          )}
        </Section>
      </div>
    </div>
  );
}

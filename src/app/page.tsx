// src/app/page.tsx
'use client';

import { useState } from 'react';

export default function Home() {
  const [postResult, setPostResult] = useState<string>('');

  async function testPost() {
    setPostResult('Виконую POST…');
    try {
      const res = await fetch('/api/public/mc/ingest-proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ping: true }),
      });
      const json = await res.json().catch(() => ({}));
      setPostResult(`HTTP ${res.status} · ${JSON.stringify(json)}`);
    } catch (e: any) {
      setPostResult(`Помилка: ${String(e?.message || e)}`);
    }
  }

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-4xl font-bold">P-3-0: головна</h1>
      <p className="text-gray-500">
        Ця сторінка існує, щоб не було 404 і щоб швидко перевірити публічний ендпоїнт.
      </p>

      <h2 className="text-xl font-semibold">/api/public/mc/ingest-proxy → GET</h2>
      <pre className="bg-black text-green-400 p-4 rounded-xl overflow-auto">
{`{
  "ok": true,
  "route": "public/mc/ingest-proxy",
  "allow": [
    "GET",
    "POST",
    "OPTIONS"
  ]
}`}
      </pre>

      <button
        onClick={testPost}
        className="px-4 py-2 rounded-md bg-neutral-900 text-white"
      >
        Тестовий POST на /api/public/mc/ingest-proxy
      </button>
      {postResult && (
        <div className="text-sm text-gray-700 border rounded-md p-3">{postResult}</div>
      )}

      {/* НОВИЙ блок навігації в адмінку */}
      <div className="pt-6 border-t mt-6">
        <h2 className="text-xl font-semibold mb-3">Адмінка → Кампанії</h2>
        <div className="flex gap-3 flex-wrap">
          <a
            href="/admin/campaigns"
            className="px-4 py-2 rounded-md bg-black text-white"
          >
            Відкрити «Кампанії» (список)
          </a>
          <a
            href="/admin/campaigns/new"
            className="px-4 py-2 rounded-md border"
          >
            Створити нову кампанію
          </a>
        </div>
      </div>
    </main>
  );
}

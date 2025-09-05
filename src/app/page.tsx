// src/app/page.tsx
export default function Home() {
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
  "allow": ["GET","POST","OPTIONS"]
}`}
      </pre>

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
    </main>
  );
}

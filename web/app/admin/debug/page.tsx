// web/app/admin/debug/page.tsx
// Server-only debug: показує стан KV та кілька останніх кампаній.

import { kvGet, kvZRevRange } from "../../../lib/kv";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export default async function DebugPage() {
  const envOk = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

  let ids: string[] = [];
  let firstCampaign: any = null;
  let error: string | null = null;

  try {
    ids = await kvZRevRange("campaigns:index", 0, 9);
    if (ids[0]) {
      firstCampaign = await kvGet(`campaigns:${ids[0]}`);
    }
  } catch (e: any) {
    error = String(e?.message || e);
  }

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Admin / Debug</h1>

      <section className="space-y-1">
        <div>
          <b>KV env configured:</b> {envOk ? "yes" : "no"}
        </div>
        {error && (
          <div className="text-red-500">
            <b>KV error:</b> {error}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Останні campaign IDs (campaigns:index)</h2>
        <pre className="bg-gray-900 text-gray-100 p-3 rounded">
          {JSON.stringify(ids, null, 2)}
        </pre>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Перша кампанія</h2>
        <pre className="bg-gray-900 text-gray-100 p-3 rounded">
          {JSON.stringify(firstCampaign, null, 2)}
        </pre>
      </section>
    </main>
  );
}

// web/app/admin/debug/page.tsx
// Server-only debug: читає KV без /api, показує ENV, індекс і перший елемент.
import { kvGet, kvZrevrange } from "../../../lib/kv";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export default async function AdminDebug() {
  const env = {
    KV_REST_API_URL: !!process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
  };

  let ids: string[] = [];
  let first: any = null;
  let error: string | null = null;

  try {
    ids = await kvZrevrange("campaigns:index", 0, 50);
    first = ids[0] ? await kvGet(`campaigns:${ids[0]}`) : null;
  } catch (e: any) {
    error = e?.message ?? "kv error";
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Admin Debug</h1>

      <div className="rounded-2xl border border-gray-200 p-4 bg-white">
        <h2 className="text-lg font-medium mb-2">ENV (present)</h2>
        <pre className="text-sm bg-slate-50 p-3 rounded-xl overflow-x-auto">
{JSON.stringify(env, null, 2)}
        </pre>
      </div>

      <div className="rounded-2xl border border-gray-200 p-4 bg-white">
        <h2 className="text-lg font-medium mb-2">Index</h2>
        <p className="text-sm text-slate-600 mb-2">campaigns:index — {ids.length} item(s)</p>
        <pre className="text-sm bg-slate-50 p-3 rounded-xl overflow-x-auto">
{JSON.stringify(ids, null, 2)}
        </pre>
      </div>

      <div className="rounded-2xl border border-gray-200 p-4 bg-white">
        <h2 className="text-lg font-medium mb-2">First item</h2>
        <pre className="text-sm bg-slate-50 p-3 rounded-xl overflow-x-auto">
{JSON.stringify(first, null, 2)}
        </pre>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-300 p-4 bg-red-50 text-red-700">
          <b>KV Error:</b> {error}
        </div>
      )}
    </div>
  );
}

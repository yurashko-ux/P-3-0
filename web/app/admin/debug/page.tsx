// web/app/admin/debug/page.tsx
// Server-only debug: показує стан KV та кілька останніх кампаній.

import { kvGet, kvZRange } from '@/lib/kv';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

type Campaign = {
  id: string;
  name?: string | null;
  created_at?: number;
  base_pipeline_id?: number;
  base_status_id?: number;
  rules?: any;
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

async function fetchLatestCampaigns(limit = 10) {
  // останні id (реверсований ZSET)
  const ids: string[] = await kvZRange(INDEX, 0, -1, { rev: true });
  const latest = ids.slice(0, limit);
  const items: Campaign[] = [];
  for (const id of latest) {
    const c = await kvGet<Campaign>(KEY(id));
    if (c) items.push(c);
  }
  return { ids, items };
}

export default async function Page() {
  const { ids, items } = await fetchLatestCampaigns(10);

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Admin • Debug (KV)</h1>

      <section className="space-y-2">
        <div className="text-sm text-gray-500">ZSET: {INDEX}</div>
        <div className="text-sm">Всього в індексі: <b>{ids.length}</b></div>
        <div className="text-sm">Останні {items.length} елементів:</div>
        <ul className="list-disc pl-6">
          {items.map((c) => (
            <li key={c.id} className="text-sm">
              <code>{c.id}</code>&nbsp;—&nbsp;
              <b>{c.name ?? '(без назви)'}</b>
              {typeof c.created_at === 'number' && (
                <span className="text-gray-500">
                  &nbsp;• {new Date(c.created_at).toLocaleString()}
                </span>
              )}
            </li>
          ))}
          {!items.length && <li className="text-sm text-gray-500">порожньо</li>}
        </ul>
      </section>
    </main>
  );
}

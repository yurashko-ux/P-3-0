// web/app/admin/campaigns/page.tsx
import { kv } from '@vercel/kv';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';

type Campaign = {
  id: string;
  title?: string;
  source: { pipeline_id: string; status_id: string };
  target: { pipeline_id: string; status_id: string };
  expire_at?: number | null;
  created_at: number;
};

async function getCampaigns(): Promise<Campaign[]> {
  const ids = (await kv.lrange<string>('campaign:ids', 0, -1)) ?? [];
  const itemsRaw = await Promise.all(ids.map((id) => kv.get<Campaign>(`campaign:${id}`)));
  const items = (itemsRaw.filter(Boolean) as Campaign[]).sort((a, b) => b.created_at - a.created_at);
  return items;
}

async function deleteCampaign(id: string) {
  'use server';
  if (!id) return;
  await kv.del(`campaign:${id}`);
  await kv.lrem('campaign:ids', 0, String(id));
  revalidatePath('/admin/campaigns');
}

export default async function CampaignsPage() {
  const items = await getCampaigns();

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Кампанії</h1>
        {/* Створення нової зробимо наступним кроком */}
        <a
          href="/admin/campaigns/new"
          className="px-4 py-2 rounded-xl bg-black text-white"
        >
          Нова кампанія
        </a>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border p-6 text-gray-600">
          Поки що немає жодної кампанії.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left">
                <th className="p-3">ID</th>
                <th className="p-3">Створено</th>
                <th className="p-3">Заголовок</th>
                <th className="p-3">Звідки</th>
                <th className="p-3">Куди</th>
                <th className="p-3">Експірація</th>
                <th className="p-3">Дії</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="p-3 font-mono">{c.id}</td>
                  <td className="p-3">{new Date(c.created_at).toLocaleString()}</td>
                  <td className="p-3">{c.title || '—'}</td>
                  <td className="p-3">
                    pipeline {c.source.pipeline_id} • status {c.source.status_id}
                  </td>
                  <td className="p-3">
                    pipeline {c.target.pipeline_id} • status {c.target.status_id}
                  </td>
                  <td className="p-3">
                    {c.expire_at ? new Date(c.expire_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <a
                        href={`/admin/campaigns/${c.id}/edit`}
                        className="px-3 py-1 rounded-lg border"
                      >
                        Редагувати
                      </a>
                      <form action={deleteCampaign.bind(null, c.id)}>
                        <button
                          type="submit"
                          className="px-3 py-1 rounded-lg border text-red-600"
                        >
                          Видалити
                        </button>
                      </form>
                      <a
                        href={`/admin/campaigns/${c.id}/test`}
                        className="px-3 py-1 rounded-lg border"
                      >
                        Тест
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-500 mt-4">
        Дані зберігаються у Vercel KV: ключі <code>campaign:ids</code> та <code>campaign:&#123;id&#125;</code>.
      </p>
    </main>
  );
}

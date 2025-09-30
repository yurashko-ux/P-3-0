// web/app/(admin)/admin/campaigns/page.tsx
export const dynamic = 'force-dynamic';

type Campaign = {
  id: string;
  name?: string;
  created_at?: number;
  base_pipeline_name?: string;
  base_status_name?: string;
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

function getOrigin() {
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

async function safeApiJson<T>(path: string): Promise<T | null> {
  const url =
    `${getOrigin()}${path.startsWith('/') ? path : `/${path}`}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    // інколи API може повернути не JSON
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

async function loadCampaigns(): Promise<Campaign[]> {
  // 1) основний виклик
  const res1 = await safeApiJson<{ ok: boolean; items?: Campaign[]; count?: number }>('/api/campaigns');
  if (res1?.items && Array.isArray(res1.items)) return res1.items;

  // 2) спроба підсіяти одну кампанію, якщо база порожня
  await safeApiJson('/api/campaigns?seed=1');

  // 3) повторний виклик
  const res2 = await safeApiJson<{ ok: boolean; items?: Campaign[]; count?: number }>('/api/campaigns');
  if (res2?.items && Array.isArray(res2.items)) return res2.items;

  // 4) останній захист
  return [];
}

export default async function CampaignsPage() {
  const items = await loadCampaigns();

  return (
    <div className="px-6 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-extrabold tracking-tight">Кампанії</h1>
        <a
          href="/admin/campaigns/new"
          className="rounded-lg bg-blue-600 px-4 py-2 text-white shadow hover:bg-blue-700"
        >
          + Нова кампанія
        </a>
      </div>

      <p className="mt-3 text-gray-500">Всього: {items.length}</p>

      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Дата/ID</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Назва</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Сутність</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Воронка</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Лічильник</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                  Кампаній поки немає
                </td>
              </tr>
            ) : (
              items.map((c) => {
                const created =
                  c.created_at ? new Date(c.created_at).toLocaleString() : '—';
                const counts = `v1: ${c.v1_count ?? 0} · v2: ${c.v2_count ?? 0} · exp: ${c.exp_count ?? 0}`;
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      <div className="flex flex-col">
                        <span>{created}</span>
                        <span className="text-gray-400">ID: {c.id}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">{c.name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {c.base_status_name ? `статус: ${c.base_status_name}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {c.base_pipeline_name || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{counts}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

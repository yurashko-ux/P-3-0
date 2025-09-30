// web/app/(admin)/admin/campaigns/page.tsx
import { cookies } from 'next/headers';

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
  // 1) Явно виставлений BASE_URL
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;
  // 2) Vercel: VERCEL_URL => https://<domain>
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  // 3) локально
  return 'http://localhost:3000';
}

async function apiJson<T>(path: string, init?: RequestInit) {
  const origin = getOrigin();
  const url = `${origin}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, { cache: 'no-store', ...init });
  // щоб легше дебажити 5xx
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status} ${res.statusText} at ${url}: ${text}`);
  }
  return (await res.json()) as T;
}

async function loadCampaigns(seedIfEmpty = false) {
  const token =
    cookies().get('admin_token')?.value ||
    cookies().get('admin_pass')?.value ||
    '';

  type Resp = { ok: boolean; items?: Campaign[]; count?: number };

  // 1) основний запит
  let res = await apiJson<Resp>('/api/campaigns', {
    headers: token ? { 'x-admin-token': token } : {},
  });

  // 2) якщо пусто — один раз підсіяти
  if (seedIfEmpty && (res.count ?? res.items?.length ?? 0) === 0) {
    await apiJson<Resp>('/api/campaigns?seed=1', {
      headers: token ? { 'x-admin-token': token } : {},
    }).catch(() => {});
    res = await apiJson<Resp>('/api/campaigns', {
      headers: token ? { 'x-admin-token': token } : {},
    });
  }

  return res.items ?? [];
}

export default async function CampaignsPage() {
  // пробуємо підсіяти, якщо порожньо
  const items = await loadCampaigns(true);

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

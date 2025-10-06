// web/app/(admin)/campaigns/page.tsx
import { cookies } from 'next/headers';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

type Rule = { op?: 'contains' | 'equals'; value?: string };
type Campaign = {
  id?: string;
  name?: string;
  created_at?: number;
  active?: boolean;
  base_pipeline_id?: number | string;
  base_status_id?: number | string;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;
  rules?: { v1?: Rule; v2?: Rule };
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
  pair_lookup_success_count?: number;
  pair_lookup_fail_count?: number;
  pair_move_success_count?: number;
  pair_move_fail_count?: number;
};

async function fetchCampaigns(): Promise<Campaign[]> {
  const token = cookies().get('admin_token')?.value ?? '';
  // важливо: передаємо X-Admin-Token з куки; no-store — щоб не кешувало
  const res = await fetch('/api/campaigns', {
    method: 'GET',
    headers: { 'X-Admin-Token': token },
    cache: 'no-store',
  });

  if (!res.ok) {
    // спробуємо зняти текст помилки для дебагу
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.error ? `${msg}: ${j.error}` : msg;
    } catch {}
    throw new Error(msg);
  }

  const data = await res.json();
  return Array.isArray(data?.items) ? (data.items as Campaign[]) : [];
}

function cellPipeline(c: Campaign) {
  const p = c.base_pipeline_name ?? '';
  const s = c.base_status_name ?? '';
  const pipelineId = c.base_pipeline_id ?? '—';
  const statusId = c.base_status_id ?? '—';
  // показуємо назви якщо є, інакше id
  const left = p || `${pipelineId}`;
  const right = s || `${statusId}`;
  return (
    <span className="whitespace-nowrap">
      {left} → {right}
    </span>
  );
}

export default async function CampaignsPage() {
  let items: Campaign[] = [];
  let error: string | null = null;

  try {
    items = await fetchCampaigns();
  } catch (e: any) {
    error = e?.message || 'Failed to load';
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Кампанії</h1>
        <Link
          href="/admin/campaigns/new"
          className="px-3 py-2 rounded-xl border hover:bg-gray-50"
        >
          + Нова кампанія
        </Link>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          Не вдалося завантажити список кампаній: {error}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border p-6 text-gray-600">
          Поки що тут порожньо. Створіть першу кампанію.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left">
                <th className="px-4 py-3">Назва</th>
                <th className="px-4 py-3">База (V1)</th>
                <th className="px-4 py-3">V1</th>
                <th className="px-4 py-3">V2</th>
                <th className="px-4 py-3">Створено</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const v1 = c.rules?.v1?.value || '';
                const v2 = c.rules?.v2?.value || '';
                const created =
                  c.created_at ? new Date(c.created_at).toLocaleString() : '—';
                return (
                  <tr key={c.id || created} className="border-t">
                    <td className="px-4 py-3 font-medium">
                      {c.name || c.id || '—'}
                    </td>
                    <td className="px-4 py-3">{cellPipeline(c)}</td>
                    <td className="px-4 py-3">{v1 || '—'}</td>
                    <td className="px-4 py-3">{v2 || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{created}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

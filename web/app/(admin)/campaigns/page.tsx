// web/app/(admin)/campaigns/page.tsx
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

type Rule = { op?: 'contains' | 'equals'; value?: string };
type Campaign = {
  id?: string | number;
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
};

async function getCampaigns() {
  const token = cookies().get('admin_token')?.value || '';
  const res = await fetch('/api/campaigns', {
    method: 'GET',
    cache: 'no-store',
    headers: { 'X-Admin-Token': token },
  });

  // якщо API впав — віддамо зрозумілу помилку
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: `HTTP ${res.status}: ${text}` };
  }

  return res.json().catch(() => ({ ok: false, error: 'Bad JSON' })) as Promise<{
    ok: boolean;
    count?: number;
    items?: Campaign[];
    error?: string;
  }>;
}

export default async function CampaignsPage() {
  const data = await getCampaigns();

  return (
    <div className="p-6">
      <h1 className="text-3xl font-semibold mb-6">Кампанії</h1>

      {/* Помилка доступу/беку */}
      {!data.ok && (
        <div className="rounded-lg border border-red-300 bg-red-50 text-red-700 p-4 mb-6">
          Не вдалося завантажити кампанії.
          <div className="text-sm opacity-80 mt-1">{data.error}</div>
          <div className="text-sm opacity-80 mt-1">
            Перевір токен через <code>/api/auth/set?token=11111</code> і онови сторінку.
          </div>
        </div>
      )}

      {/* Порожньо */}
      {data.ok && (!data.items || data.items.length === 0) && (
        <div className="rounded-xl border p-10 text-center text-gray-500">
          Кампаній поки немає
        </div>
      )}

      {/* Табличка */}
      {data.ok && data.items && data.items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left p-3">Дата</th>
                <th className="text-left p-3">Назва</th>
                <th className="text-left p-3">Сутність</th>
                <th className="text-left p-3">Воронка</th>
                <th className="text-left p-3">Лічильник</th>
                <th className="text-left p-3">Дії</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => {
                const date = c.created_at
                  ? new Date(c.created_at).toLocaleString('uk-UA')
                  : '—';
                const pipeline =
                  (c.base_pipeline_name || c.base_pipeline_id || '—') +
                  ' → ' +
                  (c.base_status_name || c.base_status_id || '—');
                const rules = [
                  c.rules?.v1?.value ? `V1: ${c.rules?.v1?.op} "${c.rules?.v1?.value}"` : null,
                  c.rules?.v2?.value ? `V2: ${c.rules?.v2?.op} "${c.rules?.v2?.value}"` : null,
                ]
                  .filter(Boolean)
                  .join(' | ');

                return (
                  <tr key={String(c.id)} className="border-t">
                    <td className="p-3">{date}</td>
                    <td className="p-3">{c.name || '—'}</td>
                    <td className="p-3">{rules || '—'}</td>
                    <td className="p-3">{pipeline}</td>
                    <td className="p-3">
                      {c.v1_count ?? 0} / {c.v2_count ?? 0} / {c.exp_count ?? 0}
                    </td>
                    <td className="p-3">
                      {/* якщо є сторінка редагування, підстав свій шлях */}
                      <a
                        className="text-blue-600 hover:underline mr-3"
                        href={`/admin/campaigns/${c.id}/edit`}
                      >
                        Edit
                      </a>
                      <a
                        className="text-red-600 hover:underline"
                        href={`/admin/campaigns/${c.id}/delete`}
                      >
                        Delete
                      </a>
                    </td>
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

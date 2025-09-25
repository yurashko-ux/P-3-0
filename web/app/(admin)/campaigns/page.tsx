// web/app/(admin)/campaigns/page.tsx
import 'server-only';
import { cookies } from 'next/headers';
import Link from 'next/link';

type Rule = { op: 'contains' | 'equals'; value: string };
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
};

async function getCampaigns() {
  const token =
    cookies().get('admin_token')?.value?.trim() ||
    process.env.ADMIN_PASS?.trim() ||
    '11111';

  // ВАЖЛИВО: використовуємо відносний шлях та прокидуємо токен в заголовку
  const res = await fetch('/api/campaigns', {
    method: 'GET',
    headers: { 'X-Admin-Token': token },
    cache: 'no-store',
    // next: { revalidate: 0 } // необов’язково, але можна залишити
  });

  if (!res.ok) {
    // спробуємо зчитати тіло для дебагу
    let detail: any = null;
    try {
      detail = await res.json();
    } catch {
      /* ignore */
    }
    throw new Error(
      `Failed to load campaigns: ${res.status} ${res.statusText}${
        detail ? ` — ${JSON.stringify(detail)}` : ''
      }`
    );
  }

  const data = (await res.json()) as { ok: boolean; items: Campaign[] };
  return (data.items || []).map((c) => ({
    ...c,
    // нормалізуємо типи на всякий
    base_pipeline_id:
      typeof c.base_pipeline_id === 'string'
        ? Number(c.base_pipeline_id)
        : c.base_pipeline_id,
    base_status_id:
      typeof c.base_status_id === 'string'
        ? Number(c.base_status_id)
        : c.base_status_id,
  }));
}

function PipeStatus({
  pipelineName,
  pipelineId,
  statusName,
  statusId,
}: {
  pipelineName?: string | null;
  pipelineId?: number | string;
  statusName?: string | null;
  statusId?: number | string;
}) {
  const p =
    (pipelineName && pipelineName.trim()) ||
    (pipelineId !== undefined && pipelineId !== null ? String(pipelineId) : '—');
  const s =
    (statusName && statusName.trim()) ||
    (statusId !== undefined && statusId !== null ? String(statusId) : '—');
  return <span className="whitespace-nowrap">{p} → {s}</span>;
}

export default async function Page() {
  const items = await getCampaigns();

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Кампанії</h1>
        <Link
          href="/admin/campaigns/new"
          className="px-3 py-2 rounded-lg border hover:bg-gray-50"
        >
          + Нова кампанія
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border p-6 text-gray-600">
          Поки що кампаній немає. Створіть першу. Якщо бачите 401 у консолі —
          перевірте, що у вас встановлено cookie <code>admin_token</code> або
          відкрийте сторінку як <code>/admin/campaigns?token=11111</code> (після
          цього cookie збережеться).
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="[&>th]:px-3 [&>th]:py-2 text-left">
                <th>ID</th>
                <th>Назва</th>
                <th>V1</th>
                <th>V2</th>
                <th>База (V1)</th>
                <th>Лічильники</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((c) => {
                const v1 = c.rules?.v1;
                const v2 = c.rules?.v2;
                return (
                  <tr key={c.id} className="[&>td]:px-3 [&>td]:py-2">
                    <td className="text-gray-500">{c.id ?? '—'}</td>
                    <td className="font-medium">{c.name ?? '—'}</td>
                    <td>
                      {v1 ? (
                        <span className="whitespace-nowrap">
                          {v1.op} : “{v1.value ?? ''}”
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {v2 ? (
                        <span className="whitespace-nowrap">
                          {v2.op} : “{v2.value ?? ''}”
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <PipeStatus
                        pipelineName={c.base_pipeline_name}
                        pipelineId={c.base_pipeline_id ?? '—'}
                        statusName={c.base_status_name}
                        statusId={c.base_status_id ?? '—'}
                      />
                    </td>
                    <td className="text-gray-600">
                      V1: {c.v1_count ?? 0} · V2: {c.v2_count ?? 0} · EXP:{' '}
                      {c.exp_count ?? 0}
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

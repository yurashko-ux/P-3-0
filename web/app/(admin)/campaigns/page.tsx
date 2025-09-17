// web/app/(admin)/campaigns/page.tsx
import { Campaign } from '@/lib/types';

async function getCampaigns(): Promise<Campaign[]> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ''}/api/campaigns`, {
    // ендпоінт захищений assertAdmin — передаємо Bearer з ENV (на сервері він доступний)
    headers: { Authorization: `Bearer ${process.env.ADMIN_PASS ?? ''}` },
    cache: 'no-store',
  });
  if (!res.ok) return [];
  return res.json();
}

export default async function CampaignsPage() {
  const items = await getCampaigns();

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Кампанії</h1>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left border-b">
            <tr>
              <th className="py-2 pr-4">Назва</th>
              <th className="py-2 pr-4">База (Воронка → Статус)</th>
              <th className="py-2 pr-4">V1</th>
              <th className="py-2 pr-4">V2</th>
              <th className="py-2 pr-4">EXP</th>
              <th className="py-2">Лічильники</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => {
              const v2Shown = (c.rules?.v2?.value ?? '').trim().length > 0;
              return (
                <tr key={c.id} className="border-b">
                  <td className="py-2 pr-4">{c.name}</td>

                  {/* База для V1 — показуємо назви, якщо бекенд надав; інакше id */}
                  <td className="py-2 pr-4">
                    {c.base_pipeline_name ?? c.base_pipeline_id} → {c.base_status_name ?? c.base_status_id}
                  </td>

                  {/* V1 */}
                  <td className="py-2 pr-4">
                    <span className="px-2 py-0.5 rounded border">{c.rules.v1.op}</span>{' '}
                    <span className="font-mono">{c.rules.v1.value}</span>
                  </td>

                  {/* V2: показуємо лише якщо value непорожній; інакше '—' */}
                  <td className="py-2 pr-4">
                    {v2Shown ? (
                      <>
                        <span className="px-2 py-0.5 rounded border">{c.rules.v2!.op}</span>{' '}
                        <span className="font-mono">{c.rules.v2!.value}</span>
                      </>
                    ) : (
                      <span className="opacity-60">—</span>
                    )}
                  </td>

                  {/* EXP */}
                  <td className="py-2 pr-4">
                    {c.exp?.days ? (
                      <>
                        {c.exp.to_pipeline_name ?? c.exp.to_pipeline_id ?? '—'} →{' '}
                        {c.exp.to_status_name ?? c.exp.to_status_id ?? '—'}{' '}
                        <span className="ml-1 opacity-70">({c.exp.days} днів)</span>
                      </>
                    ) : (
                      <span className="opacity-60">—</span>
                    )}
                  </td>

                  {/* Лічильники */}
                  <td className="py-2">
                    V1: {c.v1_count ?? 0} · V2: {c.v2_count ?? 0} · EXP: {c.exp_count ?? 0}
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center opacity-70">
                  Кампаній поки немає
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

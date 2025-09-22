// web/app/(admin)/campaigns/page.tsx
import { CampaignWithNames } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getCampaigns(): Promise<CampaignWithNames[]> {
  const res = await fetch('/api/campaigns', { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to load campaigns: ${res.status}`);
  }
  const data = (await res.json()) as CampaignWithNames[] | any;
  return Array.isArray(data) ? data : [];
}

export default async function CampaignsPage() {
  const campaigns = await getCampaigns();

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Campaigns</h1>

      <div className="overflow-x-auto rounded-2xl shadow">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left px-4 py-2">Name</th>
              <th className="text-left px-4 py-2">Created</th>
              <th className="text-left px-4 py-2">Base</th>
              <th className="text-left px-4 py-2">V1</th>
              <th className="text-left px-4 py-2">V2</th>
              <th className="text-left px-4 py-2">Counts</th>
              <th className="text-left px-4 py-2">EXP</th>
              <th className="text-left px-4 py-2">Active</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => {
              const created = new Date(c.created_at ?? 0).toLocaleString();
              const basePipeline =
                (c.base_pipeline_name ?? null) || String(c.base_pipeline_id);
              const baseStatus =
                (c.base_status_name ?? null) || String(c.base_status_id);

              const v1 = c.rules?.v1?.value ?? '';
              const v2 = c.rules?.v2?.value ?? '';

              const exp = c.exp
                ? `${c.exp.days}d → ${(c.exp.to_pipeline_name ?? null) || String(c.exp.to_pipeline_id)} → ${(c.exp.to_status_name ?? null) || String(c.exp.to_status_id)}`
                : '—';

              return (
                <tr key={String(c.id)} className="border-b last:border-none">
                  <td className="px-4 py-2">{c.name}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{created}</td>
                  <td className="px-4 py-2">
                    {basePipeline} → {baseStatus}
                  </td>
                  <td className="px-4 py-2">
                    <span className="font-mono">{c.rules?.v1?.op ?? 'contains'}</span>{' '}
                    “{v1}”
                  </td>
                  <td className="px-4 py-2">
                    <span className="font-mono">{c.rules?.v2?.op ?? 'contains'}</span>{' '}
                    “{v2}”
                  </td>
                  <td className="px-4 py-2">
                    v1: {c.v1_count ?? 0}, v2: {c.v2_count ?? 0}, exp: {c.exp_count ?? 0}
                  </td>
                  <td className="px-4 py-2">{exp}</td>
                  <td className="px-4 py-2">{c.active ? '✅' : '⏸️'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}

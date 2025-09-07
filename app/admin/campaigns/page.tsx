// app/admin/campaigns/page.tsx
import { headers } from 'next/headers';
import Link from 'next/link';
import { DeleteButton } from './DeleteButton';

export const dynamic = 'force-dynamic';

// Локальні типи (щоб файл був самодостатній)
type Status = { id: string; name: string };
type Pipeline = { id: string; name: string; statuses: Status[] };

type Variant = {
  name: string;
  toPipelineId: string;
  toStatusId: string;
  counterKey: 'v1' | 'v2' | 'exp';
};

type Campaign = {
  id: string;
  name: string;
  basePipelineId: string;
  baseStatusId: string;
  variant1?: Variant;
  variant2?: Variant;
  expirationDays?: number; // exp
  counters?: Record<'v1' | 'v2' | 'exp', number>;
  createdAt?: string;
  updatedAt?: string;
  active: boolean;
};

async function baseUrl() {
  const h = headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('host');
  return `${proto}://${host}`;
}

async function getCampaigns(): Promise<Campaign[]> {
  const res = await fetch(`${await baseUrl()}/api/campaigns`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load campaigns');
  return res.json();
}

async function getPipelines(): Promise<Pipeline[]> {
  // очікуємо [{ id, name, statuses: [{id, name}, ...] }, ...]
  const res = await fetch(`${await baseUrl()}/api/keycrm/pipelines`, { cache: 'no-store' });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : data.pipelines ?? [];
}

function findNames(pipes: Pipeline[], pipelineId?: string, statusId?: string) {
  const p = pipes.find((x) => x.id === pipelineId);
  const s = p?.statuses?.find((st) => st.id === statusId);
  return { pipelineName: p?.name ?? '—', statusName: s?.name ?? '—' };
}

function Badge({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs leading-5 text-slate-600 ${className}`}>
      {children}
    </span>
  );
}

export default async function Page() {
  const [campaigns, pipelines] = await Promise.all([getCampaigns(), getPipelines()]);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Кампанії</h1>
        <Link href="/admin/campaigns/new" className="rounded-2xl bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
          Нова кампанія
        </Link>
      </div>

      <div className="overflow-hidden rounded-2xl border">
        <table className="min-w-full divide-y">
          <thead>
            <tr className="text-left text-sm text-slate-500">
              <th className="px-4 py-3">Дата</th>
              <th className="px-4 py-3">Назва</th>
              <th className="px-4 py-3">Сутність</th>
              <th className="px-4 py-3">Статус</th>
              <th className="px-4 py-3">Дії</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {campaigns.map((c) => {
              const base = findNames(pipelines, c.basePipelineId, c.baseStatusId);
              const v1 = c.variant1 ? findNames(pipelines, c.variant1.toPipelineId, c.variant1.toStatusId) : undefined;
              const v2 = c.variant2 ? findNames(pipelines, c.variant2.toPipelineId, c.variant2.toStatusId) : undefined;

              return (
                <tr key={c.id} className="align-top">
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {new Date(c.createdAt ?? c.updatedAt ?? Date.now()).toLocaleString()}
                  </td>

                  <td className="px-4 py-3">
                    <div className="font-medium">{c.name || c.id}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge>база</Badge>
                      <Badge>{base.pipelineName}</Badge>
                      <Badge>{base.statusName}</Badge>
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-2">
                      {c.variant1 && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className="text-purple-700">v1</Badge>
                          <span className="text-sm">{v1?.pipelineName} → {v1?.statusName}</span>
                          <Badge>v1: {c.counters?.v1 ?? 0}</Badge>
                        </div>
                      )}
                      {c.variant2 && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className="text-purple-700">v2</Badge>
                          <span className="text-sm">{v2?.pipelineName} → {v2?.statusName}</span>
                          <Badge>v2: {c.counters?.v2 ?? 0}</Badge>
                        </div>
                      )}
                      {typeof c.expirationDays === 'number' && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge>exp</Badge>
                          <span className="text-sm">через {c.expirationDays} д.</span>
                          <Badge>exp: {c.counters?.exp ?? 0}</Badge>
                        </div>
                      )}
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    {c.active ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">ON</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">OFF</span>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Link href={`/admin/campaigns/${c.id}`} className="rounded-xl border px-3 py-1 text-sm hover:bg-slate-50">Edit</Link>
                      <DeleteButton id={c.id} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

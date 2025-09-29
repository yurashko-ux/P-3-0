// web/app/(admin)/admin/campaigns/page.tsx
import 'server-only';
import React from 'react';

type Rule = {
  op: 'equals' | 'contains';
  value: string;
  pipeline_id?: number;
  status_id?: number;
};

type Campaign = {
  id: string;
  name: string;
  created_at?: number;
  active?: boolean;
  base_pipeline_id?: number;
  base_status_id?: number;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;
  rules?: { v1?: Rule; v2?: Rule };
  exp?: { days?: number; pipeline_id?: number; status_id?: number };
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

async function fetchCampaigns(): Promise<Campaign[]> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ''}/api/campaigns`, {
    cache: 'no-store',
    headers: {
      // якщо стоїть кука — вистачить, але на випадок RSC:
      'X-Admin-Token': process.env.ADMIN_PASS ?? '',
    },
  });
  if (!res.ok) return [];
  const j = await res.json().catch(() => ({}));
  const items = (j?.items ?? []) as Campaign[];

  // захист від кривого індексу: беремо id ТІЛЬКИ з item.id
  return items.filter((c) => !!c && typeof c.id === 'string');
}

function CellLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: '#6b7280' }}>{children}</div>;
}
function Mono({ children }: { children: React.ReactNode }) {
  return <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>{children}</span>;
}

function RuleBadge({ label, r }: { label: string; r?: Rule }) {
  if (!r) return null;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontWeight: 700 }}>{label}:</span>
      <span>{r.op}</span>
      <Mono>“{r.value}”</Mono>
      {r.pipeline_id ? <span>→ pipe <Mono>#{r.pipeline_id}</Mono></span> : null}
      {r.status_id ? <span>status <Mono>#{r.status_id}</Mono></span> : null}
    </div>
  );
}

export const dynamic = 'force-dynamic';

export default async function AdminCampaignsPage() {
  const campaigns = await fetchCampaigns();

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 36, fontWeight: 800, margin: 0 }}>Кампанії</h1>
        <a
          href="/admin/campaigns/new"
          style={{
            textDecoration: 'none',
            background: '#2a6df5',
            color: '#fff',
            padding: '10px 14px',
            borderRadius: 12,
            fontWeight: 800,
            boxShadow: '0 10px 22px rgba(42,109,245,0.28)',
          }}
        >
          + Нова кампанія
        </a>
      </div>

      <div style={{ marginBottom: 16, color: '#6b7280' }}>Всього: <b>{campaigns.length}</b></div>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '160px 1fr 1fr 1fr 160px',
            gap: 0,
            padding: '10px 12px',
            background: '#f9fafb',
            fontWeight: 700,
          }}
        >
          <div>Дата/ID</div>
          <div>Назва</div>
          <div>Сутність</div>
          <div>Воронка</div>
          <div>Лічильник</div>
        </div>

        {campaigns.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>Кампаній поки немає</div>
        ) : (
          campaigns.map((c) => (
            <div
              key={c.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '160px 1fr 1fr 1fr 160px',
                gap: 0,
                padding: '12px',
                borderTop: '1px solid #eef2f7',
                alignItems: 'start',
              }}
            >
              {/* Дата / ID */}
              <div>
                <CellLabel>ID</CellLabel>
                <Mono>{c.id}</Mono>
                {c.created_at ? (
                  <div style={{ marginTop: 6 }}>
                    <CellLabel>Дата</CellLabel>
                    {new Date(c.created_at).toLocaleString()}
                  </div>
                ) : null}
              </div>

              {/* Назва */}
              <div>
                <div style={{ fontWeight: 800 }}>{c.name || '—'}</div>
                <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: c.active ? '#DCFCE7' : '#E5E7EB',
                      color: '#111827',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {c.active ? 'Активна' : 'Неактивна'}
                  </span>
                </div>
              </div>

              {/* Сутність (правила) */}
              <div style={{ display: 'grid', gap: 6 }}>
                <RuleBadge label="v1" r={c.rules?.v1} />
                <RuleBadge label="v2" r={c.rules?.v2} />
                {c.exp?.days ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700 }}>exp:</span>
                    <span>{c.exp.days} дн.</span>
                    {c.exp.pipeline_id ? <span>→ pipe <Mono>#{c.exp.pipeline_id}</Mono></span> : null}
                    {c.exp.status_id ? <span>status <Mono>#{c.exp.status_id}</Mono></span> : null}
                  </div>
                ) : null}
              </div>

              {/* Воронка (база) */}
              <div style={{ display: 'grid', gap: 6 }}>
                <div>
                  <CellLabel>База</CellLabel>
                  <div>
                    pipe <Mono>#{c.base_pipeline_id ?? '—'}</Mono>{' '}
                    {c.base_pipeline_name ? <span>({c.base_pipeline_name})</span> : null}
                  </div>
                  <div>
                    status <Mono>#{c.base_status_id ?? '—'}</Mono>{' '}
                    {c.base_status_name ? <span>({c.base_status_name})</span> : null}
                  </div>
                </div>
              </div>

              {/* Лічильники + дії */}
              <div>
                <div>
                  v1: <b>{c.v1_count ?? 0}</b>
                </div>
                <div>
                  v2: <b>{c.v2_count ?? 0}</b>
                </div>
                <div>
                  exp: <b>{c.exp_count ?? 0}</b>
                </div>

                <form action={`/admin/campaigns/delete?id=${encodeURIComponent(c.id)}`} method="post" style={{ marginTop: 10 }}>
                  <button
                    type="submit"
                    style={{
                      background: '#ef4444',
                      color: '#fff',
                      border: 'none',
                      padding: '8px 10px',
                      borderRadius: 10,
                      fontWeight: 800,
                      cursor: 'pointer',
                      width: '100%',
                    }}
                  >
                    Видалити
                  </button>
                </form>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

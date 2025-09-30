// web/app/(admin)/admin/campaigns/page.tsx
import React from 'react';
import { cookies, headers } from 'next/headers';

type Rule = { op: 'equals' | 'contains'; value: string; pipeline_id?: number; status_id?: number };
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

export const dynamic = 'force-dynamic';

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,"Liberation Mono","Courier New", monospace' }}>
      {children}
    </span>
  );
}

async function loadCampaigns(): Promise<Campaign[]> {
  // 1) Витягуємо куки/токен
  const c = cookies();
  const adminToken = c.get('admin_token')?.value || c.get('admin_pass')?.value || '';
  const cookieHeader = [
    c.get('admin_token')?.value ? `admin_token=${c.get('admin_token')!.value}` : '',
    c.get('admin_pass')?.value ? `; admin_pass=${c.get('admin_pass')!.value}` : '',
  ]
    .join('')
    .replace(/^; /, '');

  // 2) Абсолютний URL (у проді відносний інколи ріже куки)
  const h = headers();
  const host = h.get('x-forwarded-host') || h.get('host') || '';
  const proto = (h.get('x-forwarded-proto') || 'https') as 'http' | 'https';
  const origin =
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') || (host ? `${proto}://${host}` : '');

  try {
    const res = await fetch(`${origin}/api/campaigns`, {
      cache: 'no-store',
      headers: {
        ...(adminToken ? { 'X-Admin-Token': adminToken } : {}),
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
        // додатково прокидаємо accept, щоб Vercel не кешував 304
        accept: 'application/json',
      },
    });
    if (!res.ok) return [];
    const data = (await res.json().catch(() => ({}))) as any;
    return (data?.items ?? []) as Campaign[];
  } catch {
    return [];
  }
}

export default async function Page() {
  const items = await loadCampaigns();

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

      <div style={{ marginBottom: 16, color: '#6b7280' }}>
        Всього: <b>{items.length}</b>
      </div>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '160px 1fr 1fr 1fr 160px',
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

        {items.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>
            Кампаній поки немає
          </div>
        ) : (
          items.map((c) => (
            <div
              key={c.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '160px 1fr 1fr 1fr 160px',
                padding: '12px',
                borderTop: '1px solid #eef2f7',
                alignItems: 'start',
              }}
            >
              {/* Дата/ID */}
              <div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>ID</div>
                <Mono>{c.id}</Mono>
                {c.created_at ? (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>Дата</div>
                    {new Date(c.created_at).toLocaleString()}
                  </div>
                ) : null}
              </div>

              {/* Назва/статус активності */}
              <div>
                <div style={{ fontWeight: 800 }}>{c.name || '—'}</div>
                <div style={{ marginTop: 6 }}>
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
                {c.rules?.v1 ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <b>v1:</b> <span>{c.rules.v1.op}</span> <Mono>“{c.rules.v1.value}”</Mono>
                    {c.rules.v1.pipeline_id ? (
                      <span>
                        → pipe <Mono>#{c.rules.v1.pipeline_id}</Mono>
                      </span>
                    ) : null}
                    {c.rules.v1.status_id ? (
                      <span>
                        status <Mono>#{c.rules.v1.status_id}</Mono>
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {c.rules?.v2 ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <b>v2:</b> <span>{c.rules.v2.op}</span> <Mono>“{c.rules.v2.value}”</Mono>
                    {c.rules.v2.pipeline_id ? (
                      <span>
                        → pipe <Mono>#{c.rules.v2.pipeline_id}</Mono>
                      </span>
                    ) : null}
                    {c.rules.v2.status_id ? (
                      <span>
                        status <Mono>#{c.rules.v2.status_id}</Mono>
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {c.exp?.days ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <b>exp:</b> <span>{c.exp.days} дн.</span>
                    {c.exp.pipeline_id ? (
                      <span>
                        → pipe <Mono>#{c.exp.pipeline_id}</Mono>
                      </span>
                    ) : null}
                    {c.exp.status_id ? (
                      <span>
                        status <Mono>#{c.exp.status_id}</Mono>
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* Базова воронка */}
              <div style={{ display: 'grid', gap: 2 }}>
                <div>
                  pipe <Mono>#{c.base_pipeline_id ?? '—'}</Mono>{' '}
                  {c.base_pipeline_name ? <span>({c.base_pipeline_name})</span> : null}
                </div>
                <div>
                  status <Mono>#{c.base_status_id ?? '—'}</Mono>{' '}
                  {c.base_status_name ? <span>({c.base_status_name})</span> : null}
                </div>
              </div>

              {/* Лічильники */}
              <div>
                <div>v1: <b>{c.v1_count ?? 0}</b></div>
                <div>v2: <b>{c.v2_count ?? 0}</b></div>
                <div>exp: <b>{c.exp_count ?? 0}</b></div>
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

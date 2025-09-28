// web/app/(admin)/admin/campaigns/page.tsx
// Server Component: читає кампанії безпосередньо з KV через kvRead (read-only токен).
// Уникаємо клієнтського fetch та 401 через куки. Також вимикаємо кешування.

import { kvRead } from '@/lib/kv';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

type Rule = { op: 'contains' | 'equals'; value: string };
type Campaign = {
  id: string;
  name: string;
  created_at: number;
  active?: boolean;
  base_pipeline_id?: number;
  base_status_id?: number;
  base_pipeline_name?: string | null;
  base_status_name?: string | null;
  rules?: { v1?: Rule; v2?: Rule };
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

function fmtDate(ts?: number) {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    return d.toLocaleString('uk-UA');
  } catch { return String(ts); }
}

function ruleLabel(r?: Rule) {
  if (!r || !r.value) return '—';
  return `${r.op === 'equals' ? '==' : '∋'} "${r.value}"`;
}

export default async function CampaignsPage() {
  const items = (await kvRead.listCampaigns()) as Campaign[];

  return (
    <main style={{ maxWidth: 1200, margin: '36px auto', padding: '0 20px' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 40, fontWeight: 800, margin: 0 }}>Кампанії</h1>
        <Link
          href="/admin/campaigns/new"
          style={{
            textDecoration: 'none',
            background: '#2a6df5',
            color: '#fff',
            padding: '10px 14px',
            borderRadius: 12,
            fontWeight: 700,
            boxShadow: '0 8px 20px rgba(42,109,245,0.35)',
          }}
        >
          + Нова кампанія
        </Link>
      </header>

      <div
        style={{
          border: '1px solid #e8ebf0',
          borderRadius: 16,
          background: '#fff',
          overflow: 'hidden',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead style={{ background: '#fafbfc' }}>
            <tr>
              <th style={th}>Дата</th>
              <th style={th}>Назва</th>
              <th style={th}>Сутність</th>
              <th style={th}>Воронка</th>
              <th style={th}>Лічильник</th>
              <th style={thRight}>Дії</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 80, textAlign: 'center', color: 'rgba(0,0,0,0.5)', fontSize: 28 }}>
                  Кампаній поки немає
                </td>
              </tr>
            ) : (
              items.map((c) => (
                <tr key={c.id} style={{ borderTop: '1px solid #eef0f3' }}>
                  <td style={td}>{fmtDate(c.created_at)}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        title={c.active ? 'Активна' : 'Неактивна'}
                        style={{
                          width: 10, height: 10, borderRadius: 10,
                          background: c.active ? '#16a34a' : '#9ca3af',
                          display: 'inline-block',
                        }}
                      />
                      <strong>{c.name || '—'}</strong>
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>ID: {c.id}</div>
                  </td>
                  <td style={td}>
                    <div>v1: {ruleLabel(c.rules?.v1)}</div>
                    <div>v2: {ruleLabel(c.rules?.v2)}</div>
                  </td>
                  <td style={td}>
                    <div>{c.base_pipeline_name || `#${c.base_pipeline_id ?? '—'}`}</div>
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
                      статус: {c.base_status_name || `#${c.base_status_id ?? '—'}`}
                    </div>
                  </td>
                  <td style={td}>
                    <div>v1: {c.v1_count ?? 0}</div>
                    <div>v2: {c.v2_count ?? 0}</div>
                    <div>exp: {c.exp_count ?? 0}</div>
                  </td>
                  <td style={tdRight}>
                    {/* Заглушки дій — пізніше підв'яжемо ендпойнти */}
                    <span style={pill(c.active ? '#16a34a' : '#9ca3af')}>
                      {c.active ? 'Активна' : 'Неактивна'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '14px 16px',
  fontWeight: 700,
  color: 'rgba(0,0,0,0.7)',
  borderBottom: '1px solid #eef0f3',
};
const thRight: React.CSSProperties = { ...th, textAlign: 'right' };

const td: React.CSSProperties = {
  padding: '14px 16px',
  verticalAlign: 'top',
};
const tdRight: React.CSSProperties = { ...td, textAlign: 'right' };

function pill(bg: string): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '6px 10px',
    borderRadius: 999,
    color: '#fff',
    background: bg,
    fontSize: 12,
    fontWeight: 700,
  };
}

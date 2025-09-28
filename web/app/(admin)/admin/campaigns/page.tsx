// web/app/(admin)/admin/campaigns/page.tsx
// Server Component: читає кампанії з KV. Якщо RO-токен порожній/не той інстанс,
// виконує fallback через write-токен і показує банер.

import Link from 'next/link';
import { kvRead, campaignKeys } from '@/lib/kv';

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

// --- Fallback через write-токен (на випадок, якщо RO дивиться в інший інстанс) ---
async function fetchWithWriteToken(): Promise<Campaign[]> {
  const base = process.env.KV_REST_API_URL || '';
  const token = process.env.KV_REST_API_TOKEN || ''; // write
  if (!base || !token) return [];

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // 1) lrange index
  const r1 = await fetch(`${base.replace(/\/$/, '')}/lrange/${encodeURIComponent(campaignKeys.INDEX_KEY)}/0/-1`, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });
  if (!r1.ok) return [];
  const j1 = await r1.json().catch(() => ({}));
  const ids: string[] = j1?.result ?? [];

  // 2) get items
  const items: Campaign[] = [];
  for (const id of ids) {
    const r2 = await fetch(`${base.replace(/\/$/, '')}/get/${encodeURIComponent(campaignKeys.ITEM_KEY(id))}`, {
      method: 'GET',
      headers,
      cache: 'no-store',
    });
    if (!r2.ok) continue;
    const j2 = await r2.json().catch(() => ({}));
    const raw: string | null = j2?.result ?? null;
    if (!raw) continue;
    try { items.push(JSON.parse(raw)); } catch {}
  }
  return items;
}

export default async function CampaignsPage() {
  let items = (await kvRead.listCampaigns()) as Campaign[];
  let usedFallback = false;

  if (!items || items.length === 0) {
    // fallback через write-токен
    const fb = await fetchWithWriteToken();
    if (fb.length > 0) {
      items = fb;
      usedFallback = true;
    }
  }

  // Сортуємо за датою (новіші зверху — ми LPUSH-или індекс)
  items.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));

  return (
    <main style={{ maxWidth: 1200, margin: '36px auto', padding: '0 20px' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
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

      {usedFallback && (
        <div style={{
          marginBottom: 12,
          padding: '10px 12px',
          borderRadius: 10,
          border: '1px solid #e8ebf0',
          background: '#fff8e6',
          color: '#6b4e00',
        }}>
          Використано fallback через <code>KV_REST_API_TOKEN</code>.
          Перевірте значення <code>KV_REST_API_READ_ONLY_TOKEN</code> — ймовірно, воно вказує на інший інстанс KV.
        </div>
      )}

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
            {(!items || items.length === 0) ? (
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

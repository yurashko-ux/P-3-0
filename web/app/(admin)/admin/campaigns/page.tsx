// web/app/(admin)/admin/campaigns/page.tsx
// Server Component: Node.js runtime (НЕ Edge), щоб мати доступ до process.env для fallback через write-токен.
// Без падінь: м'яка обробка помилок + діагностика.

import Link from 'next/link';
import { kvRead, campaignKeys } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // <— критично для доступу до process.env токенів у проді

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

// Fallback через write-токен (працює лише в Node.js runtime, бо потрібні process.env)
async function fetchWithWriteToken(indexKey: string): Promise<Campaign[]> {
  const base = process.env.KV_REST_API_URL || '';
  const token = process.env.KV_REST_API_TOKEN || '';
  if (!base || !token) return [];
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const urlBase = base.replace(/\/$/, '');

  try {
    const r1 = await fetch(`${urlBase}/lrange/${encodeURIComponent(indexKey)}/0/-1`, {
      method: 'GET', headers, cache: 'no-store',
    });
    if (!r1.ok) return [];
    const j1 = await r1.json().catch(() => ({}));
    const ids: string[] = j1?.result ?? [];

    const items: Campaign[] = [];
    for (const id of ids) {
      const itemKey = indexKey === campaignKeys.INDEX_KEY ? campaignKeys.ITEM_KEY(id) : `campaign:${id}`;
      const r2 = await fetch(`${urlBase}/get/${encodeURIComponent(itemKey)}`, {
        method: 'GET', headers, cache: 'no-store',
      });
      if (!r2.ok) continue;
      const j2 = await r2.json().catch(() => ({}));
      const raw: string | null = j2?.result ?? null;
      if (!raw) continue;
      try { items.push(JSON.parse(raw)); } catch {}
    }
    return items;
  } catch {
    return [];
  }
}

export default async function CampaignsPage() {
  let items: Campaign[] = [];
  let usedFallback = false;
  let envDiag: string[] = [];

  const hasBase = !!process.env.KV_REST_API_URL;
  const hasRO   = !!process.env.KV_REST_API_READ_ONLY_TOKEN;
  const hasWR   = !!process.env.KV_REST_API_TOKEN;

  if (!hasBase) envDiag.push('KV_REST_API_URL відсутній');
  if (!hasRO)   envDiag.push('KV_REST_API_READ_ONLY_TOKEN відсутній');
  if (!hasWR)   envDiag.push('KV_REST_API_TOKEN (write) відсутній');

  try {
    // 1) Основне читання через kvRead (RO → у kv.ts є свій fallback)
    items = await kvRead.listCampaigns();

    // 2) Якщо порожньо — пробуємо обидва можливих індекси через WRITE токен
    if (!items || items.length === 0) {
      const fbA = await fetchWithWriteToken(campaignKeys.INDEX_KEY); // 'campaign:index'
      const fbB = await fetchWithWriteToken('campaigns:index');      // legacy
      const fb = [...fbA, ...fbB];
      if (fb.length > 0) {
        items = fb;
        usedFallback = true;
      }
    }
  } catch (e: any) {
    envDiag.push(`Помилка читання KV: ${e?.message || 'невідомо'}`);
    // І все одно пробуємо абсолютний fallback:
    const fbA = await fetchWithWriteToken(campaignKeys.INDEX_KEY);
    const fbB = await fetchWithWriteToken('campaigns:index');
    const fb = [...fbA, ...fbB];
    if (fb.length > 0) {
      items = fb;
      usedFallback = true;
    }
  }

  // Сортуємо за датою
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

      {(usedFallback || envDiag.length > 0) && (
        <div style={{
          marginBottom: 12,
          padding: '12px 14px',
          borderRadius: 10,
          border: '1px solid #e8ebf0',
          background: usedFallback ? '#fff8e6' : '#fffbeb',
          color: '#6b4e00',
        }}>
          {usedFallback ? (
            <>Список отримано через fallback із <code>KV_REST_API_TOKEN</code>. Перевірте RO-токен, щоб читати без fallback.</>
          ) : (
            <>
              <strong>Діагностика середовища KV:</strong>
              <ul style={{ margin: '6px 0 0 16px' }}>
                {envDiag.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </>
          )}
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
            {(items.length === 0) ? (
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

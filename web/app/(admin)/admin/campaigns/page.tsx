// web/app/(admin)/admin/campaigns/page.tsx
// Server Component: безпечне читання кампаній з KV.
// Будь-які збої у KV -> м'який банер + порожній список, без server-side exception.

import Link from 'next/link';
import { kvRead } from '@/lib/kv';

export const runtime = 'nodejs';
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
  let items: Campaign[] = [];
  let errMsg: string | null = null;

  try {
    const res = await kvRead.listCampaigns();
    items = Array.isArray(res) ? (res as Campaign[]) : [];
  } catch (e: any) {
    errMsg = e?.message || 'KV read failed';
    // не кидаємо — просто показуємо банер нижче
  }

  // Сортуємо за датою (нові зверху)
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

      {errMsg && (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid #e8ebf0',
            background: '#fff8e6',
            color: '#6b4e00',
          }}
        >
          Не вдалось прочитати кампанії з KV: <code>{errMsg}</code>.
          Перевірте <code>KV_REST_API_URL</code>, токени <code>KV_REST_API_READ_ONLY_TOKEN</code> / <code>KV_REST_API_TOKEN</code>.
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
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 80, textAlign: 'center', color: 'rgba(0,0,0,0.5)', fontSize: 28 }}>
                  Кампаній поки немає
                </td>
              </tr>

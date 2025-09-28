// web/app/(admin)/admin/campaigns/page.tsx
// Server Component (Node.js runtime) зі Server Action для toggle активності.
// Без клієнтського JS та без редіректів на JSON.

import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { kvRead, kvWrite, campaignKeys } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

function toTs(idOrTs?: string | number) {
  if (!idOrTs) return undefined;
  const n = Number(idOrTs);
  return Number.isFinite(n) ? n : undefined;
}
function fmtDateMaybeFromId(c: Campaign) {
  const ts = c.created_at ?? toTs(c.id);
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('uk-UA');
  } catch {
    return '—';
  }
}
function ruleLabel(r?: Rule) {
  if (!r || !r.value) return '—';
  return `${r.op === 'equals' ? '==' : '∋'} "${r.value}"`;
}

// --- Server Action: toggle active ---
async function toggleActiveAction(formData: FormData) {
  'use server';
  const id = String(formData.get('id') || '').trim();
  if (!id) return;

  const key = campaignKeys.ITEM_KEY(id);
  const raw = await kvRead.getRaw(key);
  if (!raw) return;
  let obj: any;
  try { obj = JSON.parse(raw); } catch { return; }
  obj.active = !(obj.active !== false); // toggle

  await kvWrite.setRaw(key, JSON.stringify(obj));
  // необов'язково: підсовуємо id в голову індексу
  try { await kvWrite.lpush(campaignKeys.INDEX_KEY, id); } catch {}

  revalidatePath('/admin/campaigns');
}

export default async function CampaignsPage() {
  let items: Campaign[] = [];
  try {
    items = await kvRead.listCampaigns();
  } catch {
    items = [];
  }
  items.sort((a, b) => (toTs(b.created_at ?? b.id) ?? 0) - (toTs(a.created_at ?? a.id) ?? 0));

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
                  <td style={td}>{fmtDateMaybeFromId(c)}</td>
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
                    <form action={toggleActiveAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <button
                        type="submit"
                        title="Перемкнути активність"
                        style={pillBtn(c.active ? '#16a34a' : '#9ca3af')}
                      >
                        {c.active ? 'Активна' : 'Неактивна'}
                      </button>
                    </form>
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

function pillBtn(bg: string): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '6px 10px',
    borderRadius: 999,
    color: '#fff',
    background: bg,
    fontSize: 12,
    fontWeight: 700,
    border: 'none',
    cursor: 'pointer',
  };
}

// web/app/(admin)/admin/campaigns/page.tsx
// FIX: жодних onClick/onSubmit-функцій у Server Component (інакше Next дає Digest).
// Видалення робимо Server Action + redirect('?deleted=1').

import Link from 'next/link';
import { revalidatePath, } from 'next/cache';
import { redirect } from 'next/navigation';
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
  try { await kvWrite.lpush(campaignKeys.INDEX_KEY, id); } catch {}

  revalidatePath('/admin/campaigns');
}

// --- Server Action: manual refresh (revalidate) ---
async function refreshAction() {
  'use server';
  revalidatePath('/admin/campaigns');
}

// --- Server Action: DELETE campaign ---
async function deleteCampaignAction(formData: FormData) {
  'use server';
  const id = String(formData.get('id') || '').trim();
  if (!id) return;

  const base = process.env.KV_REST_API_URL || '';
  const token = process.env.KV_REST_API_TOKEN || '';
  if (base && token) {
    const urlBase = base.replace(/\/$/, '');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // DEL campaign:<id>
    try {
      await fetch(`${urlBase}/del/${encodeURIComponent(campaignKeys.ITEM_KEY(id))}`, {
        method: 'POST', headers, cache: 'no-store',
      });
    } catch {}

    // LREM з обох індексів
    const lrem = async (indexKey: string) => {
      try {
        await fetch(`${urlBase}/lrem/${encodeURIComponent(indexKey)}/0`, {
          method: 'POST', headers, cache: 'no-store',
          body: JSON.stringify({ value: id }),
        });
      } catch {}
    };
    await lrem(campaignKeys.INDEX_KEY);
    await lrem('campaigns:index');
  }

  // Перемальовуємо і показуємо прапорець успіху
  revalidatePath('/admin/campaigns');
  redirect('/admin/campaigns?deleted=1');
}

export default async function CampaignsPage(props: { searchParams?: Record<string, string | string[] | undefined> }) {
  const sp = props.searchParams || {};
  const created  = String(sp.created  || '') === '1';
  const migrated = String(sp.migrated || '') === '1';
  const deleted  = String(sp.deleted  || '') === '1';

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
        <div>
          <h1 style={{ fontSize: 40, fontWeight: 800, margin: 0 }}>Кампанії</h1>
          <div style={{ color: 'rgba(0,0,0,0.55)', marginTop: 6 }}>
            Всього: <strong>{items.length}</strong>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <form action={refreshAction}>
            <button
              type="submit"
              title="Оновити список"
              style={{
                textDecoration: 'none',
                background: '#f3f4f6',
                color: '#111827',
                padding: '10px 14px',
                borderRadius: 12,
                fontWeight: 700,
                border: '1px solid #e5e7eb',
                cursor: 'pointer',
              }}
            >
              Оновити
            </button>
          </form>
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
        </div>
      </header>

      {(created || migrated || deleted) && (
        <div
          style={{
            marginBottom: 12,
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid #c7f3cd',
            background: '#ecfdf5',
            color: '#065f46',
          }}
        >
          {created  && <div>✅ Кампанію створено. Список оновлено.</div>}
          {migrated && <div>✅ Міграцію виконано. Індекс та елементи нормалізовано.</div>}
          {deleted  && <div>🗑️ Кампанію видалено.</div>}
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
                      <strong>{c.name || 'UI-created'}</strong>
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
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <form action={toggleActiveAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <button type="submit" title="Перемкнути активність" style={pillBtn(c.active ? '#16a34a' : '#9ca3af')}>
                          {c.active ? 'Активна' : 'Неактивна'}
                        </button>
                      </form>

                      <form action={deleteCampaignAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <button type="submit" title="Видалити кампанію" style={dangerBtn}>
                          Видалити
                        </button>
                      </form>
                    </div>
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
const dangerBtn: React.CSSProperties = {
  display: 'inline-block',
  padding: '6px 10px',
  borderRadius: 999,
  color: '#fff',
  background: '#dc2626',
  fontSize: 12,
  fontWeight: 700,
  border: 'none',
  cursor: 'pointer',
};

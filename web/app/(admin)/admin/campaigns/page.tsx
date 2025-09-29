// web/app/(admin)/admin/campaigns/page.tsx
// ОНОВЛЕНО: кнопка "Видалити" тепер шле GET-форму на /admin/campaigns/delete
// і завжди передає СИРИЙ id (з __index_id або id), навіть якщо UI не може його показати.
// Сам роут нормалізує значення і видаляє елемент + перевибудовує індекс.

import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { kvRead, kvWrite, campaignKeys } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Rule = { op: 'contains' | 'equals'; value: string };
type Campaign = {
  id: any;
  __index_id?: string; // може бути "битий" рядок; роут нормалізує
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
  deleted?: boolean;
};

function toTs(idOrTs?: string | number) {
  const n = Number(idOrTs ?? NaN);
  return Number.isFinite(n) ? n : undefined;
}

// М’яка нормалізація тільки для відображення (UI), роут робить "хард" нормалізацію
function uiNormalizeId(raw: any): string {
  if (raw == null) return '';
  const s = typeof raw === 'string' ? raw.trim() : (typeof raw === 'number' ? String(raw) : '');
  // мінімальна зачистка, щоб показати хоч щось у колонці "ID"
  const cleaned = s.replace(/\\+/g, '').replace(/^"+|"+$/g, '');
  const m = cleaned.match(/\d{10,}/);
  return m ? m[0] : '';
}

async function toggleActiveAction(formData: FormData) {
  'use server';
  const id = String(formData.get('id') || '').trim();
  if (!id) return;
  const key = campaignKeys.ITEM_KEY(id);
  const raw = await kvRead.getRaw(key);
  if (!raw) return;
  let obj: any;
  try { obj = JSON.parse(raw); } catch { return; }
  if (obj.deleted) return;
  obj.active = !(obj.active !== false);
  await kvWrite.setRaw(key, JSON.stringify(obj));
  try { await kvWrite.lpush(campaignKeys.INDEX_KEY, id); } catch {}
  revalidatePath('/admin/campaigns');
}

async function refreshAction() { 'use server'; revalidatePath('/admin/campaigns'); }

export default async function CampaignsPage(props: { searchParams?: Record<string, string | string[] | undefined> }) {
  const sp = props.searchParams || {};
  const created  = String(sp.created  || '') === '1';
  const migrated = String(sp.migrated || '') === '1';
  const deleted  = String(sp.deleted  || '') === '1';

  let items: Campaign[] = [];
  try { items = await kvRead.listCampaigns(); } catch { items = []; }

  items = items.filter(c => !c.deleted);

  items.sort((a, b) => {
    const ta = a.created_at ?? toTs(uiNormalizeId(a.__index_id ?? a.id)) ?? 0;
    const tb = b.created_at ?? toTs(uiNormalizeId(b.__index_id ?? b.id)) ?? 0;
    return tb - ta;
  });

  return (
    <main style={{ maxWidth: 1200, margin: '36px auto', padding: '0 20px' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 40, fontWeight: 800, margin: 0 }}>Кампанії</h1>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <form action={refreshAction}>
            <button
              type="submit"
              title="Оновити список"
              style={{ textDecoration: 'none', background: '#f3f4f6', color: '#111827',
                       padding: '10px 14px', borderRadius: 12, fontWeight: 700,
                       border: '1px solid #e5e7eb', cursor: 'pointer' }}
            >
              Оновити
            </button>
          </form>
          <Link href="/admin/campaigns/new"
            style={{ textDecoration: 'none', background: '#2a6df5', color: '#fff',
                     padding: '10px 14px', borderRadius: 12, fontWeight: 700,
                     boxShadow: '0 8px 20px rgba(42,109,245,0.35)' }}>
            + Нова кампанія
          </Link>
        </div>
      </header>

      {(created || migrated || deleted) && (
        <div style={{
          marginBottom: 12, padding: '12px 14px', borderRadius: 10,
          border: '1px solid #c7f3cd', background: '#ecfdf5', color: '#065f46'
        }}>
          {created  && <div>✅ Кампанію створено. Список оновлено.</div>}
          {migrated && <div>✅ Міграцію виконано. Індекс та елементи нормалізовано.</div>}
          {deleted  && <div>🗑️ Кампанію видалено.</div>}
        </div>
      )}

      <div style={{ border: '1px solid #e8ebf0', borderRadius: 16, background: '#fff', overflow: 'hidden' }}>
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
              items.map((c) => {
                // 1) що показати в колонці "ID" (м’яка нормалізація, лише для UI)
                const idForUi = uiNormalizeId(c.__index_id ?? c.id) || '—';
                // 2) що передати на сервер у /admin/campaigns/delete (сирий рядок)
                const idRawForDelete = (c.__index_id ?? c.id ?? '').toString();

                return (
                  <tr key={`${idRawForDelete || c.name}-${Math.random()}`} style={{ borderTop: '1px solid #eef0f3' }}>
                    <td style={td}>—</td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span title={c.active ? 'Активна' : 'Неактивна'}
                              style={{ width: 10, height: 10, borderRadius: 10,
                                       background: c.active ? '#16a34a' : '#9ca3af', display: 'inline-block' }} />
                        <strong>{c.name || 'UI-created'}</strong>
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
                        ID: {idForUi}
                      </div>
                    </td>
                    <td style={td}>
                      <div>v1: {c.rules?.v1?.value ? `${c.rules?.v1?.op === 'equals' ? '==' : '∋'} "${c.rules?.v1?.value}"` : '—'}</div>
                      <div>v2: {c.rules?.v2?.value ? `${c.rules?.v2?.op === 'equals' ? '==' : '∋'} "${c.rules?.v2?.value}"` : '—'}</div>
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
                          {/* Тут потрібен "чистий" id — якщо його нема, кнопка буде no-op */}
                          <input type="hidden" name="id" value={uiNormalizeId(c.__index_id ?? c.id)} />
                          <button type="submit" title="Перемкнути активність" style={pillBtn(c.active ? '#16a34a' : '#9ca3af')}>
                            {c.active ? 'Активна' : 'Неактивна'}
                          </button>
                        </form>

                        {/* ВИДАЛЕННЯ: шлемо СИРИЙ id (навіть якщо він «битий»), роут сам нормалізує */}
                        <form method="GET" action="/admin/campaigns/delete">
                          <input type="hidden" name="id" value={idRawForDelete} />
                          <button type="submit" title="Видалити кампанію" style={dangerBtn}>
                            Видалити
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })
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

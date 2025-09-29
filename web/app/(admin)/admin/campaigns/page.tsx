// web/app/(admin)/admin/campaigns/page.tsx
// Додано: robust getId() — витягує id навіть якщо це вкладені/екрановані JSON-рядки.

import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { kvRead, kvWrite, campaignKeys } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Rule = { op: 'contains' | 'equals'; value: string };
type Campaign = {
  id: any;
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

// === НОВЕ: надстійна нормалізація будь-якої форми id ===
function normalizeIdRaw(raw: any, depth = 6): string {
  if (raw == null || depth <= 0) return '';

  // примітиви
  if (typeof raw === 'number') return String(raw);
  if (typeof raw === 'string') {
    let s = raw.trim();

    // Спроба розпарсити вкладені/екрановані JSON рядки декілька разів
    for (let i = 0; i < 5; i++) {
      try {
        const parsed = JSON.parse(s);
        if (typeof parsed === 'string' || typeof parsed === 'number') {
          return normalizeIdRaw(parsed, depth - 1);
        }
        if (parsed && typeof parsed === 'object') {
          const cand = (parsed as any).value ?? (parsed as any).id ?? (parsed as any).member ?? '';
          if (cand) return normalizeIdRaw(cand, depth - 1);
        }
        break;
      } catch {
        break;
      }
    }

    // Прибрати ескейпи/зайві лапки
    s = s.replace(/\\+/g, '').replace(/^"+|"+$/g, '');

    // Спроба вийняти довгу послідовність цифр (типовий timestamp з Date.now)
    const m = s.match(/\d{10,}/);
    if (m) return m[0];

    return '';
  }

  // об'єкти { value / id / member }
  if (typeof raw === 'object') {
    const cand = (raw as any).value ?? (raw as any).id ?? (raw as any).member ?? '';
    return normalizeIdRaw(cand, depth - 1);
  }

  return '';
}

function getId(c: Campaign): string {
  return normalizeIdRaw((c as any)?.id) || '';
}

function fmtDateMaybeFromId(c: Campaign) {
  const safeId = getId(c);
  const ts = c.created_at ?? toTs(safeId);
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString('uk-UA'); } catch { return '—'; }
}
function ruleLabel(r?: Rule) {
  if (!r || !r.value) return '—';
  return `${r.op === 'equals' ? '==' : '∋'} "${r.value}"`;
}

// Server Action: toggle active
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

// ручне оновлення
async function refreshAction() { 'use server'; revalidatePath('/admin/campaigns'); }

export default async function CampaignsPage(props: { searchParams?: Record<string, string | string[] | undefined> }) {
  const sp = props.searchParams || {};
  const created  = String(sp.created  || '') === '1';
  const migrated = String(sp.migrated || '') === '1';
  const deleted  = String(sp.deleted  || '') === '1';

  let items: Campaign[] = [];
  try { items = await kvRead.listCampaigns(); } catch { items = []; }

  // ховаємо soft-deleted, якщо є
  items = items.filter(c => !c.deleted);

  // сортування за датою/ID
  items.sort((a, b) => {
    const ta = a.created_at ?? toTs(getId(a)) ?? 0;
    const tb = b.created_at ?? toTs(getId(b)) ?? 0;
    return tb - ta;
  });

  return (
    <main style={{ maxWidth: 1200, margin: '36px auto', padding: '0 20px' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 40, fontWeight: 800, margin: 0 }}>Кампанії</h1>
          <div style={{ color: 'rgba(0,0,0,0.55)', marginTop: 6 }}>Всього: <strong>{items.length}</strong></div>
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
                const safeId = getId(c);
                return (
                  <tr key={`${safeId || 'noid'}-${c.name}`} style={{ borderTop: '1px solid #eef0f3' }}>
                    <td style={td}>{fmtDateMaybeFromId(c)}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span title={c.active ? 'Активна' : 'Неактивна'}
                              style={{ width: 10, height: 10, borderRadius: 10,
                                       background: c.active ? '#16a34a' : '#9ca3af', display: 'inline-block' }} />
                        <strong>{c.name || 'UI-created'}</strong>
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
                        ID: {safeId || '—'}
                      </div>
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
                          <input type="hidden" name="id" value={safeId} />
                          <button type="submit" title="Перемкнути активність" style={pillBtn(c.active ? '#16a34a' : '#9ca3af')}>
                            {c.active ? 'Активна' : 'Неактивна'}
                          </button>
                        </form>

                        {/* Кнопка Видалити завжди має нормалізований id */}
                        <Link
                          href={`/admin/campaigns/delete?id=${encodeURIComponent(safeId)}`}
                          title="Видалити кампанію"
                          style={dangerBtn as any}
                          prefetch={false}
                        >
                          Видалити
                        </Link>
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

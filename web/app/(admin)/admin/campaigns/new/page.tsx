// web/app/(admin)/admin/campaigns/new/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

type Op = 'contains' | 'equals';

export default function NewCampaignPage() {
  const router = useRouter();

  // базові поля
  const [name, setName] = useState('');
  const [pipelineId, setPipelineId] = useState<number | ''>('');
  const [statusId, setStatusId] = useState<number | ''>('');

  // правила
  const [v1Op, setV1Op] = useState<Op>('contains');
  const [v1Val, setV1Val] = useState('');
  const [v2Op, setV2Op] = useState<Op>('equals');
  const [v2Val, setV2Val] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const token = getCookie('admin_token') || '';
    if (!token) {
      setError('Немає admin_token. Зайдіть у систему ще раз.');
      return;
    }

    // Валідація мінімуму
    const body: any = {
      name: name.trim() || 'UI-created',
      active: true,
      rules: {
        v1: v1Val.trim() ? { op: v1Op, value: v1Val.trim() } : undefined,
        v2: v2Val.trim() ? { op: v2Op, value: v2Val.trim() } : undefined,
      },
    };
    if (pipelineId !== '') body.base_pipeline_id = Number(pipelineId);
    if (statusId !== '') body.base_status_id = Number(statusId);

    setBusy(true);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': token,
        },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      router.push('/admin/campaigns?created=1');
    } catch (err: any) {
      setError(err?.message || 'Не вдалося створити кампанію');
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 820, margin: '36px auto', padding: '0 20px' }}>
      <h1 style={{ fontSize: 40, fontWeight: 800, marginBottom: 16 }}>Нова кампанія</h1>
      <form onSubmit={onSubmit} style={{
        border: '1px solid #e8ebf0',
        borderRadius: 16,
        background: '#fff',
        padding: 20,
        display: 'grid',
        gridTemplateColumns: '1fr',
        gap: 16,
      }}>
        <div>
          <label style={label}>Назва</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Напр. IG Autumn Promo"
            style={input}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={label}>Base Pipeline ID</label>
            <input
              value={pipelineId}
              onChange={(e) => setPipelineId(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="Напр. 111"
              inputMode="numeric"
              style={input}
            />
          </div>
          <div>
            <label style={label}>Base Status ID</label>
            <input
              value={statusId}
              onChange={(e) => setStatusId(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="Напр. 222"
              inputMode="numeric"
              style={input}
            />
          </div>
        </div>

        <fieldset style={fs}>
          <legend style={lg}>Правило v1</legend>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12 }}>
            <select value={v1Op} onChange={(e) => setV1Op(e.target.value as Op)} style={select}>
              <option value="contains">contains</option>
              <option value="equals">equals</option>
            </select>
            <input
              value={v1Val}
              onChange={(e) => setV1Val(e.target.value)}
              placeholder='Напр. "ціна"'
              style={input}
            />
          </div>
        </fieldset>

        <fieldset style={fs}>
          <legend style={lg}>Правило v2</legend>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12 }}>
            <select value={v2Op} onChange={(e) => setV2Op(e.target.value as Op)} style={select}>
              <option value="contains">contains</option>
              <option value="equals">equals</option>
            </select>
            <input
              value={v2Val}
              onChange={(e) => setV2Val(e.target.value)}
              placeholder='Напр. "привіт"'
              style={input}
            />
          </div>
        </fieldset>

        {error && (
          <div style={{ color: '#b00020', fontWeight: 600 }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => history.back()}
            style={btnGhost}
          >
            Скасувати
          </button>
          <button
            type="submit"
            disabled={busy}
            style={btnPrimary}
          >
            {busy ? 'Збереження…' : 'Створити'}
          </button>
        </div>
      </form>
    </main>
  );
}

const label: React.CSSProperties = { display: 'block', marginBottom: 6, fontWeight: 700 };
const input: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 12, border: '1px solid #dfe3ea',
  background: '#f8fbff',
};
const select = input;

const fs: React.CSSProperties = {
  border: '1px solid #e8ebf0', borderRadius: 12, padding: 14,
};
const lg: React.CSSProperties = { fontWeight: 800, padding: '0 6px' };

const btnPrimary: React.CSSProperties = {
  background: '#2a6df5', color: '#fff', padding: '10px 16px', borderRadius: 12,
  border: 'none', fontWeight: 800, boxShadow: '0 8px 20px rgba(42,109,245,0.35)',
};
const btnGhost: React.CSSProperties = {
  background: '#f3f4f6', color: '#111827', padding: '10px 16px', borderRadius: 12, border: '1px solid #e5e7eb',
};

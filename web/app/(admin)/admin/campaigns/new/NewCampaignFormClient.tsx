// web/app/(admin)/admin/campaigns/new/NewCampaignFormClient.tsx
'use client';

import React from 'react';

export type Status = { id: number | string; name: string };
export type PipeWithStatuses = { id: number | string; name: string; statuses: Status[] };

function inputStyle() {
  return {
    width: '100%',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: '14px 16px',
    outline: 'none',
    fontSize: 16 as const,
    background: '#f7f9fc',
  };
}
const labelStyle: React.CSSProperties = { fontWeight: 700, marginBottom: 8, display: 'block' };
const rowStyle: React.CSSProperties = { display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' };

function RuleRow({
  title,
  defOp,
}: {
  title: string;
  defOp: 'contains' | 'equals';
}) {
  return (
    <div>
      <div style={{ fontWeight: 800, fontSize: 18, margin: '12px 0 8px' }}>{title}</div>
      <div style={rowStyle}>
        <div>
          <label style={labelStyle}>Оператор</label>
          <select name={`${title.toLowerCase()}_op`} defaultValue={defOp} style={inputStyle()}>
            <option value="contains">contains</option>
            <option value="equals">equals</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Значення</label>
          <input
            name={`${title.toLowerCase()}_value`}
            placeholder={title === 'Правило v1' ? 'Напр. "ціна"' : 'Напр. "привіт"'}
            style={inputStyle()}
          />
        </div>
      </div>
    </div>
  );
}

export default function NewCampaignFormClient({ pipes }: { pipes: PipeWithStatuses[] }) {
  const [pipeId, setPipeId] = React.useState<string>(pipes[0]?.id ? String(pipes[0].id) : '');
  const selected = pipes.find((p) => String(p.id) === pipeId);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const name = String(fd.get('name') || 'UI-created').trim();
    const base_pipeline_id = Number(fd.get('pipeline') || NaN);
    const base_status_id = Number(fd.get('status') || NaN);

    const v1_op = String(fd.get('правило v1_op') || 'contains');
    const v1_val = String(fd.get('правило v1_value') || '').trim();
    const v2_op = String(fd.get('правило v2_op') || 'equals');
    const v2_val = String(fd.get('правило v2_value') || '').trim();

    const rules: any = {};
    if (v1_val) rules.v1 = { op: v1_op, value: v1_val };
    if (v2_val) rules.v2 = { op: v2_op, value: v2_val };

    const body = {
      name,
      base_pipeline_id: Number.isFinite(base_pipeline_id) ? base_pipeline_id : undefined,
      base_status_id: Number.isFinite(base_status_id) ? base_status_id : undefined,
      rules,
    };

    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) {
      alert(`Не вдалося створити: ${j?.error || res.statusText}`);
      return;
    }
    window.location.href = '/admin/campaigns?created=1';
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 18 }}>
      <div>
        <label style={labelStyle}>Назва</label>
        <input name="name" placeholder="Напр. IG Autumn Promo" style={inputStyle()} />
      </div>

      <div style={rowStyle}>
        <div>
          <label style={labelStyle}>Base Pipeline ID</label>
          <select
            name="pipeline"
            value={pipeId}
            onChange={(e) => setPipeId(e.target.value)}
            style={inputStyle()}
          >
            {pipes.map((p) => (
              <option key={String(p.id)} value={String(p.id)}>
                {p.name} (#{p.id})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Base Status ID</label>
          <select name="status" style={inputStyle()}>
            {(selected?.statuses || []).map((s) => (
              <option key={String(s.id)} value={String(s.id)}>
                {s.name} (#{s.id})
              </option>
            ))}
          </select>
        </div>
      </div>

      <RuleRow title="Правило v1" defOp="contains" />
      <RuleRow title="Правило v2" defOp="equals" />

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
        <a
          href="/admin/campaigns"
          style={{
            textDecoration: 'none',
            background: '#eef2ff',
            color: '#1f2937',
            padding: '12px 18px',
            borderRadius: 14,
            border: '1px solid #e5e7eb',
            fontWeight: 700,
          }}
        >
          Скасувати
        </a>
        <button
          type="submit"
          style={{
            background: '#2a6df5',
            color: '#fff',
            padding: '12px 18px',
            borderRadius: 14,
            border: 'none',
            fontWeight: 800,
            boxShadow: '0 10px 24px rgba(42,109,245,0.35)',
            cursor: 'pointer',
          }}
        >
          Створити
        </button>
      </div>
    </form>
  );
}

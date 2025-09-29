// web/app/(admin)/admin/campaigns/new/NewCampaignFormClient.tsx
'use client';

import React from 'react';

export type Status = { id: number | string; name: string };
export type PipeWithStatuses = { id: number | string; name: string; statuses: Status[] };

const H1: React.CSSProperties = { fontSize: 42, fontWeight: 900, marginBottom: 18 };
const card: React.CSSProperties = {
  border: '1px solid #e8ebf0',
  borderRadius: 16,
  background: '#fff',
  padding: 20,
  boxShadow: '0 8px 24px rgba(0,0,0,0.03)',
};
const label: React.CSSProperties = { fontWeight: 700, marginBottom: 8, display: 'block' };
const threeCols: React.CSSProperties = {
  display: 'grid',
  gap: 16,
  gridTemplateColumns: '1fr 1fr 1fr',
};
const input = {
  width: '100%',
  border: '1px solid #e5e7eb',
  borderRadius: 14,
  padding: '14px 16px',
  outline: 'none',
  fontSize: 16 as const,
  background: '#f7f9fc',
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontWeight: 800, fontSize: 20, margin: '12px 0 12px' }}>{children}</div>;
}

function getStatuses(pipes: PipeWithStatuses[], pipeId: string) {
  return pipes.find((p) => String(p.id) === String(pipeId))?.statuses ?? [];
}

export default function NewCampaignFormClient({ pipes }: { pipes: PipeWithStatuses[] }) {
  // База
  const [name, setName] = React.useState('');
  const [basePipeId, setBasePipeId] = React.useState<string>(
    pipes[0]?.id ? String(pipes[0].id) : '',
  );
  const [baseStatusId, setBaseStatusId] = React.useState<string>('');
  React.useEffect(() => {
    const sts = getStatuses(pipes, basePipeId);
    if (sts.length && !sts.find((s) => String(s.id) === baseStatusId)) {
      setBaseStatusId(String(sts[0].id));
    }
  }, [basePipeId]);

  // Варіант №1
  const [v1Value, setV1Value] = React.useState('');
  const [v1PipeId, setV1PipeId] = React.useState<string>(basePipeId);
  const [v1StatusId, setV1StatusId] = React.useState<string>('');
  React.useEffect(() => {
    const sts = getStatuses(pipes, v1PipeId);
    if (sts.length && !sts.find((s) => String(s.id) === v1StatusId)) {
      setV1StatusId(String(sts[0].id));
    }
  }, [v1PipeId]);

  // Варіант №2
  const [v2Value, setV2Value] = React.useState('');
  const [v2PipeId, setV2PipeId] = React.useState<string>(basePipeId);
  const [v2StatusId, setV2StatusId] = React.useState<string>('');
  React.useEffect(() => {
    const sts = getStatuses(pipes, v2PipeId);
    if (sts.length && !sts.find((s) => String(s.id) === v2StatusId)) {
      setV2StatusId(String(sts[0].id));
    }
  }, [v2PipeId]);

  // Expire
  const [expDays, setExpDays] = React.useState<string>('7');
  const [expPipeId, setExpPipeId] = React.useState<string>(basePipeId);
  const [expStatusId, setExpStatusId] = React.useState<string>('');
  React.useEffect(() => {
    const sts = getStatuses(pipes, expPipeId);
    if (sts.length && !sts.find((s) => String(s.id) === expStatusId)) {
      setExpStatusId(String(sts[0].id));
    }
  }, [expPipeId]);

  function toNum(v: string) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    const body: any = {
      name: name?.trim() || 'UI-created',
      base_pipeline_id: toNum(basePipeId),
      base_status_id: toNum(baseStatusId),
      rules: {},
      exp: {},
    };

    if (v1Value.trim()) {
      (body.rules as any).v1 = {
        op: 'equals',
        value: v1Value.trim(),
        pipeline_id: toNum(v1PipeId),
        status_id: toNum(v1StatusId),
      };
    }
    if (v2Value.trim()) {
      (body.rules as any).v2 = {
        op: 'equals',
        value: v2Value.trim(),
        pipeline_id: toNum(v2PipeId),
        status_id: toNum(v2StatusId),
      };
    }
    if (expDays && Number(expDays) > 0) {
      body.exp = {
        days: Number(expDays),
        pipeline_id: toNum(expPipeId),
        status_id: toNum(expStatusId),
      };
    } else {
      delete body.exp;
    }
    if (!Object.keys(body.rules).length) delete body.rules;

    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) {
      alert(`Не вдалося зберегти: ${j?.error || res.statusText}`);
      return;
    }
    window.location.href = '/admin/campaigns?created=1';
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 18 }}>
      <h1 style={H1}>Нова кампанія</h1>

      {/* БАЗА — 3 колонки: Назва / Базова воронка / Базовий статус */}
      <div style={card}>
        <div style={threeCols}>
          <div>
            <label style={label}>Назва кампанії</label>
            <input
              style={input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Введіть назву"
            />
          </div>
          <div>
            <label style={label}>Базова воронка</label>
            <select
              style={input}
              value={basePipeId}
              onChange={(e) => setBasePipeId(e.target.value)}
            >
              {pipes.map((p) => (
                <option key={String(p.id)} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={label}>Базовий статус</label>
            <select
              style={input}
              value={baseStatusId}
              onChange={(e) => setBaseStatusId(e.target.value)}
            >
              {getStatuses(pipes, basePipeId).map((s) => (
                <option key={String(s.id)} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ВАРІАНТ №1 — 3 колонки: Значення / Воронка / Статус */}
      <div style={card}>
        <SectionTitle>Варіант №1</SectionTitle>
        <div style={threeCols}>
          <div>
            <label style={label}>Значення</label>
            <input
              style={input}
              value={v1Value}
              onChange={(e) => setV1Value(e.target.value)}
              placeholder='Напр. "1"'
            />
          </div>
          <div>
            <label style={label}>Воронка</label>
            <select
              style={input}
              value={v1PipeId}
              onChange={(e) => setV1PipeId(e.target.value)}
            >
              {pipes.map((p) => (
                <option key={String(p.id)} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={label}>Статус</label>
            <select
              style={input}
              value={v1StatusId}
              onChange={(e) => setV1StatusId(e.target.value)}
            >
              {getStatuses(pipes, v1PipeId).map((s) => (
                <option key={String(s.id)} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ВАРІАНТ №2 — 3 колонки */}
      <div style={card}>
        <SectionTitle>Варіант №2</SectionTitle>
        <div style={threeCols}>
          <div>
            <label style={label}>Значення</label>
            <input
              style={input}
              value={v2Value}
              onChange={(e) => setV2Value(e.target.value)}
              placeholder='Напр. "2"'
            />
          </div>
          <div>
            <label style={label}>Воронка</label>
            <select
              style={input}
              value={v2PipeId}
              onChange={(e) => setV2PipeId(e.target.value)}
            >
              {pipes.map((p) => (
                <option key={String(p.id)} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={label}>Статус</label>
            <select
              style={input}
              value={v2StatusId}
              onChange={(e) => setV2StatusId(e.target.value)}
            >
              {getStatuses(pipes, v2PipeId).map((s) => (
                <option key={String(s.id)} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* EXPIRE — 3 колонки: Дні / Воронка / Статус */}
      <div style={card}>
        <SectionTitle>Expire</SectionTitle>
        <div style={threeCols}>
          <div>
            <label style={label}>Кількість днів до експірації</label>
            <input
              style={input}
              type="number"
              min={0}
              value={expDays}
              onChange={(e) => setExpDays(e.target.value)}
              placeholder="Напр. 7"
            />
          </div>
          <div>
            <label style={label}>Воронка</label>
            <select
              style={input}
              value={expPipeId}
              onChange={(e) => setExpPipeId(e.target.value)}
            >
              {pipes.map((p) => (
                <option key={String(p.id)} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={label}>Статус</label>
            <select
              style={input}
              value={expStatusId}
              onChange={(e) => setExpStatusId(e.target.value)}
            >
              {getStatuses(pipes, expPipeId).map((s) => (
                <option key={String(s.id)} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Дії */}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-start', marginTop: 8 }}>
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
          Зберегти
        </button>
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
      </div>
    </form>
  );
}

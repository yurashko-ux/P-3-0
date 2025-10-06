// web/app/(admin)/admin/campaigns/new/NewCampaignFormClient.tsx
'use client';

import React from 'react';

export type Status = { id: number | string; name: string };
export type PipeWithStatuses = { id: number | string; name: string; statuses: Status[] };

/** компактніші стилі */
const card: React.CSSProperties = {
  border: '1px solid #e8ebf0',
  borderRadius: 14,
  background: '#fff',
  padding: 14, // було 20
  boxShadow: '0 6px 18px rgba(0,0,0,0.03)',
};
const label: React.CSSProperties = { fontWeight: 700, marginBottom: 6, display: 'block', fontSize: 14 };
const threeCols: React.CSSProperties = {
  display: 'grid',
  gap: 12, // було 16
  gridTemplateColumns: '1fr 1fr 1fr',
};
const inputBase: React.CSSProperties = {
  width: '100%',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: '10px 12px', // було 14px 16px
  outline: 'none',
  fontSize: 14,
  background: '#f7f9fc',
  height: 40, // фіксована висота компактніше
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontWeight: 800, fontSize: 16, margin: '6px 0 10px' }}>{children}</div>;
}

function getStatuses(pipes: PipeWithStatuses[], pipeId: string) {
  return pipes.find((p) => String(p.id) === String(pipeId))?.statuses ?? [];
}

export default function NewCampaignFormClient({ pipes }: { pipes: PipeWithStatuses[] }) {
  // База
  const [name, setName] = React.useState('');
  const [basePipeId, setBasePipeId] = React.useState<string>(pipes[0]?.id ? String(pipes[0].id) : '');
  const [baseStatusId, setBaseStatusId] = React.useState<string>('');
  const baseStatuses = React.useMemo(() => getStatuses(pipes, basePipeId), [pipes, basePipeId]);
  React.useEffect(() => {
    setBaseStatusId((prev) => {
      if (!baseStatuses.length) return '';
      return baseStatuses.some((s) => String(s.id) === prev) ? prev : String(baseStatuses[0].id);
    });
  }, [baseStatuses]);

  // Варіант №1
  const [v1Value, setV1Value] = React.useState('');
  const [v1PipeId, setV1PipeId] = React.useState<string>(basePipeId);
  const [v1StatusId, setV1StatusId] = React.useState<string>('');
  const v1Statuses = React.useMemo(() => getStatuses(pipes, v1PipeId), [pipes, v1PipeId]);
  React.useEffect(() => {
    setV1StatusId((prev) => {
      if (!v1Statuses.length) return '';
      return v1Statuses.some((s) => String(s.id) === prev) ? prev : String(v1Statuses[0].id);
    });
  }, [v1Statuses]);

  // Варіант №2
  const [v2Value, setV2Value] = React.useState('');
  const [v2PipeId, setV2PipeId] = React.useState<string>(basePipeId);
  const [v2StatusId, setV2StatusId] = React.useState<string>('');
  const v2Statuses = React.useMemo(() => getStatuses(pipes, v2PipeId), [pipes, v2PipeId]);
  React.useEffect(() => {
    setV2StatusId((prev) => {
      if (!v2Statuses.length) return '';
      return v2Statuses.some((s) => String(s.id) === prev) ? prev : String(v2Statuses[0].id);
    });
  }, [v2Statuses]);

  // Expire
  const [expDays, setExpDays] = React.useState<string>('7');
  const [expPipeId, setExpPipeId] = React.useState<string>(basePipeId);
  const [expStatusId, setExpStatusId] = React.useState<string>('');
  const expStatuses = React.useMemo(() => getStatuses(pipes, expPipeId), [pipes, expPipeId]);
  React.useEffect(() => {
    setExpStatusId((prev) => {
      if (!expStatuses.length) return '';
      return expStatuses.some((s) => String(s.id) === prev) ? prev : String(expStatuses[0].id);
    });
  }, [expStatuses]);

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
      const errorText =
        (typeof j?.message === 'string' && j.message) ||
        (typeof j?.error === 'string' && j.error) ||
        res.statusText;
      alert(`Не вдалося зберегти: ${errorText}`);
      return;
    }
    window.location.href = '/admin/campaigns?created=1';
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 /* було 18 */ }}>
      {/* Прибрали дубльований <h1>. H1 вже рендериться в page.tsx */}

      {/* БАЗА — 3 колонки */}
      <div style={card}>
        <div style={threeCols}>
          <div>
            <label style={label}>Назва кампанії</label>
            <input
              style={inputBase}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Введіть назву"
            />
          </div>
          <div>
            <label style={label}>Базова воронка</label>
            <select
              style={inputBase as React.CSSProperties}
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
              style={inputBase as React.CSSProperties}
              value={baseStatusId}
              onChange={(e) => setBaseStatusId(e.target.value)}
            >
              {baseStatuses.map((s) => (
                <option key={String(s.id)} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ВАРІАНТ №1 */}
      <div style={card}>
        <SectionTitle>Варіант №1</SectionTitle>
        <div style={threeCols}>
          <div>
            <label style={label}>Значення</label>
            <input
              style={inputBase}
              value={v1Value}
              onChange={(e) => setV1Value(e.target.value)}
              placeholder='Напр. "1"'
            />
          </div>
          <div>
            <label style={label}>Воронка</label>
            <select
              style={inputBase as React.CSSProperties}
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
              style={inputBase as React.CSSProperties}
              value={v1StatusId}
              onChange={(e) => setV1StatusId(e.target.value)}
            >
              {v1Statuses.map((s) => (
                <option key={String(s.id)} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ВАРІАНТ №2 */}
      <div style={card}>
        <SectionTitle>Варіант №2</SectionTitle>
        <div style={threeCols}>
          <div>
            <label style={label}>Значення</label>
            <input
              style={inputBase}
              value={v2Value}
              onChange={(e) => setV2Value(e.target.value)}
              placeholder='Напр. "2"'
            />
          </div>
          <div>
            <label style={label}>Воронка</label>
            <select
              style={inputBase as React.CSSProperties}
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
              style={inputBase as React.CSSProperties}
              value={v2StatusId}
              onChange={(e) => setV2StatusId(e.target.value)}
            >
              {v2Statuses.map((s) => (
                <option key={String(s.id)} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* EXPIRE */}
      <div style={card}>
        <SectionTitle>Expire</SectionTitle>
        <div style={threeCols}>
          <div>
            <label style={label}>Кількість днів до експірації</label>
            <input
              style={inputBase}
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
              style={inputBase as React.CSSProperties}
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
              style={inputBase as React.CSSProperties}
              value={expStatusId}
              onChange={(e) => setExpStatusId(e.target.value)}
            >
              {expStatuses.map((s) => (
                <option key={String(s.id)} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Дії */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-start', marginTop: 4 }}>
        <button
          type="submit"
          style={{
            background: '#2a6df5',
            color: '#fff',
            padding: '10px 14px',
            borderRadius: 12,
            border: 'none',
            fontWeight: 800,
            boxShadow: '0 8px 18px rgba(42,109,245,0.28)',
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
            padding: '10px 14px',
            borderRadius: 12,
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

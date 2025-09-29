// web/app/(admin)/admin/campaigns/new/page.tsx
import 'server-only';
import React from 'react';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ---------- KeyCRM fetchers (сервер) ----------
type Pipeline = { id: number | string; name: string };
type Status   = { id: number | string; name: string };
type PipeWithStatuses = Pipeline & { statuses: Status[] };

const KC_BASE   = (process.env.KEYCRM_API_URL || '').replace(/\/$/, '');
const KC_BEARER = process.env.KEYCRM_BEARER || process.env.KEYCRM_API_TOKEN || '';

function kcHeaders() {
  return KC_BEARER ? { Authorization: `Bearer ${KC_BEARER}` } : {};
}

// універсальний GET з кількома варіантами шляхів
async function kcTryGet(paths: string[]): Promise<any | null> {
  if (!KC_BASE) return null;
  for (const p of paths) {
    try {
      const url = `${KC_BASE}${p.startsWith('/') ? p : `/${p}`}`;
      const res = await fetch(url, { headers: kcHeaders(), cache: 'no-store' });
      if (!res.ok) continue;
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        // можливо, KeyCRM повертає "text/json" — пробуємо ще раз як рядок
        return text || null;
      }
    } catch {
      // пробуємо наступний шлях
    }
  }
  return null;
}

function normArray(input: any): any[] {
  if (Array.isArray(input)) return input;
  if (input && Array.isArray(input.data)) return input.data;
  if (input && Array.isArray(input.result)) return input.result;
  return [];
}

function normPipelines(input: any): Pipeline[] {
  const arr = normArray(input);
  return arr
    .map((x) => {
      if (!x) return null;
      const id = x.id ?? x.pipeline_id ?? x.uuid ?? x._id;
      const name = x.name ?? x.title ?? x.label ?? x.pipeline_name;
      if (id == null || !name) return null;
      return { id, name };
    })
    .filter(Boolean) as Pipeline[];
}

function normStatuses(input: any): Status[] {
  const arr = normArray(input);
  // інколи статуси можуть бути вкладені як stages/statuses в полі об'єкта
  const flat = Array.isArray(arr) && arr.length === 0 && input && typeof input === 'object'
    ? normArray(input.statuses ?? input.stages ?? [])
    : arr;

  return flat
    .map((x: any) => {
      if (!x) return null;
      const id = x.id ?? x.status_id ?? x.uuid ?? x._id;
      const name = x.name ?? x.title ?? x.label ?? x.status_name;
      if (id == null || !name) return null;
      return { id, name };
    })
    .filter(Boolean) as Status[];
}

async function loadPipelinesWithStatuses(): Promise<PipeWithStatuses[]> {
  // 1) Пайплайни
  const rawPipes =
    (await kcTryGet(['/pipelines', '/pipelines.json', '/pipeline', '/pipeline.json'])) ?? [];
  const pipes = normPipelines(rawPipes);

  // 2) Статуси на pipeline
  const result: PipeWithStatuses[] = [];
  for (const p of pipes) {
    const pid = encodeURIComponent(String(p.id));
    const rawStatuses =
      (await kcTryGet([
        `/pipelines/${pid}/statuses`,
        `/pipelines/${pid}/stages`,
        `/pipeline/${pid}/statuses`,
        `/pipeline/${pid}/stages`,
      ])) ?? {};

    const statuses =
      normStatuses(rawStatuses) ||
      normStatuses((rawStatuses && rawStatuses.data) || []) ||
      [];

    result.push({ ...p, statuses });
  }
  return result;
}

// ---------- Клієнтський компонент форми ----------
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

'use client';
function NewCampaignFormClient({
  pipes,
}: {
  pipes: PipeWithStatuses[];
}) {
  const [pipeId, setPipeId] = React.useState<string>(pipes[0]?.id ? String(pipes[0].id) : '');
  const selected = pipes.find((p) => String(p.id) === pipeId);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const name = String(fd.get('name') || 'UI-created').trim();
    const base_pipeline_id = Number(fd.get('pipeline') || NaN);
    const base_status_id   = Number(fd.get('status')   || NaN);

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
      base_status_id:   Number.isFinite(base_status_id)   ? base_status_id   : undefined,
      rules,
    };

    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!res.ok || !j?.ok) {
      alert(`Не вдалося створити: ${j?.error || res.statusText}`);
      return;
    }
    // Успіх → повертаємось у список
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

// ---------- Сторінка (сервер) ----------
export default async function NewCampaignPage() {
  // тягнемо pipelines + statuses (із fallback-логікою)
  let pipes: PipeWithStatuses[] = [];
  try {
    pipes = await loadPipelinesWithStatuses();
  } catch {
    pipes = [];
  }

  // якщо не змогли отримати жодної воронки — даємо хоч пусту форму
  if (pipes.length === 0) {
    pipes = [{ id: '', name: '—', statuses: [] }];
  }

  return (
    <main style={{ maxWidth: 900, margin: '32px auto', padding: '0 20px' }}>
      <h1 style={{ fontSize: 42, fontWeight: 900, marginBottom: 18 }}>Нова кампанія</h1>
      <div
        style={{
          border: '1px solid #e8ebf0',
          borderRadius: 16,
          background: '#fff',
          padding: 20,
          boxShadow: '0 8px 24px rgba(0,0,0,0.03)',
        }}
      >
        {/* @ts-expect-error Server-to-Client prop */}
        <NewCampaignFormClient pipes={pipes} />
      </div>
    </main>
  );
}

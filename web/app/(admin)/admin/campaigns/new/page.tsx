// web/app/(admin)/admin/campaigns/new/page.tsx
import 'server-only';
import React from 'react';
import NewCampaignFormClient, {
  PipeWithStatuses,
  Status,
} from './NewCampaignFormClient';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ---------- KeyCRM fetchers (сервер) ----------
type Pipeline = { id: number | string; name: string };

const KC_BASE = (process.env.KEYCRM_API_URL || '').replace(/\/$/, '');
const KC_BEARER = process.env.KEYCRM_BEARER || process.env.KEYCRM_API_TOKEN || '';

function kcHeaders() {
  return KC_BEARER ? { Authorization: `Bearer ${KC_BEARER}` } : {};
}

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
        return text || null;
      }
    } catch {}
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
  const flat =
    Array.isArray(arr) && arr.length === 0 && input && typeof input === 'object'
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
  const rawPipes =
    (await kcTryGet(['/pipelines', '/pipelines.json', '/pipeline', '/pipeline.json'])) ?? [];
  const pipes = normPipelines(rawPipes);

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
      normStatuses((rawStatuses && (rawStatuses as any).data) || []) ||
      [];

    result.push({ ...p, statuses });
  }
  return result;
}

// ---------- Сторінка ----------
export default async function NewCampaignPage() {
  let pipes: PipeWithStatuses[] = [];
  try {
    pipes = await loadPipelinesWithStatuses();
  } catch {
    pipes = [];
  }
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
        <NewCampaignFormClient pipes={pipes} />
      </div>
    </main>
  );
}

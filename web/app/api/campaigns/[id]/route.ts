// web/app/api/campaigns/[id]/route.ts
import { NextResponse } from 'next/server';
import { kvRead, kvWrite } from '@/lib/kv';

type Counters = { v1?: number; v2?: number; exp?: number };
type Campaign = {
  id: string;
  name?: string;
  v1?: { value?: string };
  v2?: { value?: string };
  base?: { pipeline?: string; status?: string; pipelineName?: string; statusName?: string };
  counters?: Counters;
  createdAt?: string | number | Date;
  deleted?: boolean;
};

function safeParse<T = any>(src: unknown): T | null {
  if (src == null) return null;
  if (typeof src !== 'string') return src as T;
  const s = src.trim();
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    // інколи значення подвійно заекскейплене — спробуємо ще раз
    try {
      return JSON.parse(JSON.parse(s)) as T;
    } catch {
      return null;
    }
  }
}

function normalizeId(raw: unknown): string {
  let cur: any = raw;
  for (let i = 0; i < 3; i++) {
    if (typeof cur === 'string') {
      const s = cur.trim();
      if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('"') && s.endsWith('"'))) {
        const p = safeParse(s);
        if (p != null) {
          cur = p;
          continue;
        }
      }
      return s;
    }
    if (cur && typeof cur === 'object' && 'value' in cur) {
      cur = cur.value;
      continue;
    }
    break;
  }
  return String(cur ?? '');
}

/** Спроба прочитати кампанію за різними ключами */
async function readCampaignRaw(id: string) {
  const keys = [`campaign:${id}`, `campaigns:${id}`, id];
  for (const key of keys) {
    try {
      const raw = await kvRead.getRaw(key);
      if (raw) return { raw, key };
    } catch {
      /* ignore and try next */
    }
  }
  return null;
}

/** Нормалізація структури, дефолти для відсутніх полів */
function normalizeCampaign(id: string, src: any): Campaign {
  const obj = safeParse<any>(src) ?? src ?? {};
  const base = obj.base ?? {};
  const counters = obj.counters ?? {};
  return {
    id,
    name: obj.name ?? obj.title ?? '',
    v1: obj.v1 ?? (obj.rules?.v1 ? { value: obj.rules.v1 } : undefined),
    v2: obj.v2 ?? (obj.rules?.v2 ? { value: obj.rules.v2 } : undefined),
    base: {
      pipeline: base.pipeline ?? base.pipelineId ?? base.pipeId ?? '',
      status: base.status ?? base.statusId ?? '',
      pipelineName: base.pipelineName ?? base.pipeName ?? '',
      statusName: base.statusName ?? '',
    },
    counters: {
      v1: typeof counters.v1 === 'number' ? counters.v1 : 0,
      v2: typeof counters.v2 === 'number' ? counters.v2 : 0,
      exp: typeof counters.exp === 'number' ? counters.exp : 0,
    },
    createdAt: obj.createdAt ?? obj.date ?? undefined,
    deleted: !!obj.deleted,
  };
}

/* =========================
   GET /api/campaigns/[id]
   ========================= */
export async function GET(_: Request, context: { params: { id: string } }) {
  const id = normalizeId(context.params?.id);
  if (!id) {
    return NextResponse.json({ ok: false, reason: 'id is required' }, { status: 400 });
  }

  try {
    const found = await readCampaignRaw(id);
    if (!found) {
      return NextResponse.json({ ok: false, reason: 'not found' }, { status: 404 });
    }

    const item = normalizeCampaign(id, found.raw);
    return NextResponse.json({ ok: true, item }, { status: 200 });
  } catch (e: any) {
    console.error('GET /api/campaigns/[id] failed', e);
    return NextResponse.json({ ok: false, reason: 'internal error' }, { status: 500 });
  }
}

/* ==========================================================
   DELETE /api/campaigns/[id] — лишаємо, щоб кнопка "Видалити" працювала
   ========================================================== */
export async function DELETE(_: Request, context: { params: { id: string } }) {
  const id = normalizeId(context.params?.id);
  if (!id) {
    return NextResponse.json({ ok: false, reason: 'id is required' }, { status: 400 });
  }

  try {
    // мʼяке видалення: позначимо deleted=true у записі
    const found = await readCampaignRaw(id);
    if (!found) {
      return NextResponse.json({ ok: false, reason: 'not found' }, { status: 404 });
    }
    const parsed = safeParse<any>(found.raw) ?? {};
    parsed.deleted = true;

    // збережемо назад тим же ключем
    if (kvWrite?.setRaw) {
      await kvWrite.setRaw(found.key, JSON.stringify(parsed));
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    console.error('DELETE /api/campaigns/[id] failed', e);
    return NextResponse.json({ ok: false, reason: 'internal error' }, { status: 500 });
  }
}

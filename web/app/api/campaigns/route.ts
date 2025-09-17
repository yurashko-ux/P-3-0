// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvSet, kvZAdd, kvZRange } from '@/lib/kv';
import { Campaign, CampaignInput, normalizeCampaign } from '@/lib/types';
import { getPipelineName, getStatusName } from '@/lib/kc-cache';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

const norm = (s: string) => s.trim().toLowerCase();
const hasV2 = (c: Campaign) => (c.rules?.v2?.value ?? '').trim().length > 0;

export async function GET(req: NextRequest) {
  await assertAdmin(req);

  const ids: string[] = await kvZRange(INDEX, 0, -1);
  if (!ids?.length) return NextResponse.json([]);

  const rawList = await Promise.all(ids.map((id) => kvGet<any>(KEY(id))));
  const items: Campaign[] = [];

  for (const raw of rawList) {
    if (!raw) continue;
    const c = normalizeCampaign(typeof raw === 'string' ? JSON.parse(raw) : raw);

    // Збагачення назвами базової пари
    c.base_pipeline_name = await getPipelineName(c.base_pipeline_id);
    c.base_status_name = await getStatusName(c.base_pipeline_id, c.base_status_id);

    // Збагачення назвами для EXP (якщо є)
    if (c.exp) {
      const ep = c.exp;
      (c as any).exp = {
        ...ep,
        to_pipeline_name: await getPipelineName(ep.to_pipeline_id),
        to_status_name: await getStatusName(
          ep.to_pipeline_id ?? c.base_pipeline_id,
          ep.to_status_id ?? null
        ),
      };
    }

    items.push(c);
  }

  // стабільне сортування у списку
  items.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  return NextResponse.json(items);
}

// ---- helper: знайти дублікат V1/V2 в межах тієї ж базової пари ----
async function findDuplicateRule(candidate: Campaign): Promise<
  | {
      rule: 'v1' | 'v2';
      conflict: {
        id: string;
        name: string;
        base_pipeline_id: number;
        base_status_id: number;
        v1?: Campaign['rules']['v1'];
        v2?: Campaign['rules']['v2'];
      };
    }
  | null
> {
  const ids: string[] = await kvZRange(INDEX, 0, -1);
  if (!ids?.length) return null;
  const raws = await Promise.all(ids.map((id) => kvGet<any>(KEY(id))));

  for (const raw of raws) {
    if (!raw) continue;
    const existing = normalizeCampaign(typeof raw === 'string' ? JSON.parse(raw) : raw);
    if (existing.id === candidate.id) continue; // оновлення тієї ж кампанії

    const sameBase =
      existing.base_pipeline_id === candidate.base_pipeline_id &&
      existing.base_status_id === candidate.base_status_id;

    if (!sameBase) continue;

    // V1 дубль
    const v1dup =
      existing.rules.v1.op === candidate.rules.v1.op &&
      norm(existing.rules.v1.value) === norm(candidate.rules.v1.value);
    if (v1dup) {
      return {
        rule: 'v1',
        conflict: {
          id: existing.id,
          name: existing.name,
          base_pipeline_id: existing.base_pipeline_id,
          base_status_id: existing.base_status_id,
          v1: existing.rules.v1,
        },
      };
    }

    // V2 дубль — перевіряємо лише якщо у кандидата V2 активний (value непорожній)
    if (hasV2(candidate) && hasV2(existing)) {
      const v2dup =
        existing.rules.v2.op === candidate.rules.v2.op &&
        norm(existing.rules.v2.value) === norm(candidate.rules.v2.value);
      if (v2dup) {
        return {
          rule: 'v2',
          conflict: {
            id: existing.id,
            name: existing.name,
            base_pipeline_id: existing.base_pipeline_id,
            base_status_id: existing.base_status_id,
            v2: existing.rules.v2,
          },
        };
      }
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    await assertAdmin(req);
    const url = new URL(req.url);
    const allowDup = url.searchParams.get('allow_duplicate') === '1';

    const body = (await req.json()) as CampaignInput;
    const c = normalizeCampaign(body);

    if (!allowDup) {
      const dup = await findDuplicateRule(c);
      if (dup) {
        const errorCode = dup.rule === 'v1' ? 'duplicate_v1' : 'duplicate_v2';
        const message =
          dup.rule === 'v1'
            ? 'Campaign with the same base (pipeline/status) and V1 already exists.'
            : 'Campaign with the same base (pipeline/status) and V2 already exists.';
        return NextResponse.json(
          { error: errorCode, message, conflict: dup.conflict },
          { status: 409 }
        );
      }
    }

    await kvSet(KEY(c.id), c);
    // kvZAdd: (key, score, member)
    await kvZAdd(INDEX, c.created_at, c.id);

    // 201 Created
    return new Response(JSON.stringify(c), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message || e?.message || 'Invalid payload';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

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

// ---- перевірка глобальних дублів значень для V1/V2 (без прив'язки до базової пари, без урахування регістру) ----
async function findGlobalValueConflict(candidate: Campaign): Promise<
  | {
      rule: 'v1' | 'v2' | 'v2_same_as_v1';
      value: string;
      conflict?: { id: string; name: string; rule: 'v1' | 'v2'; value: string };
    }
  | null
> {
  const candV1 = norm(candidate.rules.v1.value);
  const candV2 = hasV2(candidate) ? norm(candidate.rules.v2.value) : null;

  // В межах однієї кампанії V2 не може дорівнювати V1
  if (candV2 && candV1 === candV2) {
    return { rule: 'v2_same_as_v1', value: candidate.rules.v2.value };
  }

  const ids: string[] = await kvZRange(INDEX, 0, -1);
  if (!ids?.length) return null;

  const raws = await Promise.all(ids.map((id) => kvGet<any>(KEY(id))));
  for (const raw of raws) {
    if (!raw) continue;
    const existing = normalizeCampaign(typeof raw === 'string' ? JSON.parse(raw) : raw);
    if (existing.id === candidate.id) continue; // оновлення: не порівнюємо з собою

    const ev1 = norm(existing.rules.v1.value);
    const ev2 = (existing.rules.v2?.value ?? '').trim() ? norm(existing.rules.v2!.value) : null;

    // Кандидатський V1 не може дорівнювати жодному існуючому V1/V2
    if (candV1 === ev1) {
      return {
        rule: 'v1',
        value: candidate.rules.v1.value,
        conflict: { id: existing.id, name: existing.name, rule: 'v1', value: existing.rules.v1.value },
      };
    }
    if (ev2 && candV1 === ev2) {
      return {
        rule: 'v1',
        value: candidate.rules.v1.value,
        conflict: { id: existing.id, name: existing.name, rule: 'v2', value: existing.rules.v2!.value },
      };
    }

    // Кандидатський V2 (якщо заданий) не може дорівнювати жодному існуючому V1/V2
    if (candV2) {
      if (candV2 === ev1) {
        return {
          rule: 'v2',
          value: candidate.rules.v2!.value,
          conflict: { id: existing.id, name: existing.name, rule: 'v1', value: existing.rules.v1.value },
        };
      }
      if (ev2 && candV2 === ev2) {
        return {
          rule: 'v2',
          value: candidate.rules.v2!.value,
          conflict: { id: existing.id, name: existing.name, rule: 'v2', value: existing.rules.v2!.value },
        };
      }
    }
  }
  return null;
}

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
        to_status_name: await getStatusName(ep.to_pipeline_id ?? c.base_pipeline_id, ep.to_status_id ?? null),
      };
    }
    items.push(c);
  }

  // стабільне сортування у списку
  items.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  try {
    await assertAdmin(req);
    const url = new URL(req.url);
    const allowDup = url.searchParams.get('allow_duplicate') === '1';

    const body = (await req.json()) as CampaignInput;
    const c = normalizeCampaign(body);

    if (!allowDup) {
      const conflict = await findGlobalValueConflict(c);
      if (conflict) {
        const msg =
          conflict.rule === 'v2_same_as_v1'
            ? 'V2 value cannot be the same as V1 within the same campaign.'
            : `Value "${conflict.value}" already exists globally in ${conflict.conflict!.rule.toUpperCase()} of campaign "${conflict.conflict!.name}".`;
        return NextResponse.json(
          { error: 'duplicate_value', rule: conflict.rule, value: conflict.value, conflict: conflict.conflict, message: msg },
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

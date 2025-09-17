// web/app/api/campaigns/create/route.ts
import { NextRequest } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvSet, kvZAdd, kvZRange } from '@/lib/kv';
import { Campaign, CampaignInput, normalizeCampaign } from '@/lib/types';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

const norm = (s: string) => s.trim().toLowerCase();
const hasV2 = (c: Campaign) => (c.rules?.v2?.value ?? '').trim().length > 0;

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

  if (candV2 && candV1 === candV2) {
    return { rule: 'v2_same_as_v1', value: candidate.rules.v2.value };
  }

  const ids: string[] = await kvZRange(INDEX, 0, -1);
  if (!ids?.length) return null;

  const raws = await Promise.all(ids.map((id) => kvGet<any>(KEY(id))));
  for (const raw of raws) {
    if (!raw) continue;
    const existing = normalizeCampaign(typeof raw === 'string' ? JSON.parse(raw) : raw);
    if (existing.id === candidate.id) continue;

    const ev1 = norm(existing.rules.v1.value);
    const ev2 = (existing.rules.v2?.value ?? '').trim() ? norm(existing.rules.v2!.value) : null;

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
        return new Response(JSON.stringify({ error: 'duplicate_value', rule: conflict.rule, value: conflict.value, conflict: conflict.conflict, message: msg }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    await kvSet(KEY(c.id), c);
    await kvZAdd(INDEX, c.created_at, c.id);

    return new Response(JSON.stringify(c), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message || e?.message || 'Invalid payload';
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
}

// web/app/api/campaigns/create/route.ts
import { NextRequest } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvSet, kvZAdd, kvZRange } from '@/lib/kv';
import { Campaign, CampaignInput, normalizeCampaign } from '@/lib/types';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

const norm = (s: string) => s.trim().toLowerCase();
const hasV2 = (c: Campaign) => (c.rules?.v2?.value ?? '').trim().length > 0;

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
    if (existing.id === candidate.id) continue;

    const sameBase =
      existing.base_pipeline_id === candidate.base_pipeline_id &&
      existing.base_status_id === candidate.base_status_id;
    if (!sameBase) continue;

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
        return new Response(
          JSON.stringify({ error: errorCode, message, conflict: dup.conflict }),
          { status: 409, headers: { 'content-type': 'application/json' } }
        );
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

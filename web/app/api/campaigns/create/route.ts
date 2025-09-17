// web/app/api/campaigns/create/route.ts
import { NextRequest } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvSet, kvZAdd } from '@/lib/kv';
import { CampaignInput, normalizeCampaign } from '@/lib/types';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

export async function POST(req: NextRequest) {
  try {
    await assertAdmin(req);
    const body = (await req.json()) as CampaignInput;
    const c = normalizeCampaign(body);

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

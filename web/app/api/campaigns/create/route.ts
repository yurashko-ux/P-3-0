// web/app/api/campaigns/create/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvSet, kvZAdd } from '@/lib/kv';
import { CampaignInput, normalizeCampaign } from '@/lib/types';

export const dynamic = 'force-dynamic';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

export async function POST(req: NextRequest) {
  try {
    await assertAdmin(req);

    const body = (await req.json()) as CampaignInput;
    const c = normalizeCampaign(body);

    // зберігаємо повний JSON кампанії
    await kvSet(KEY(c.id), c);

    // ДОДАНО: правильна сигнатура kvZAdd — один об’єкт { score, member }
    await kvZAdd(INDEX, { score: c.created_at, member: c.id });

    return NextResponse.json(c, { status: 200 });
  } catch (e: any) {
    const msg =
      e?.issues?.[0]?.message ||
      e?.message ||
      'Invalid payload';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

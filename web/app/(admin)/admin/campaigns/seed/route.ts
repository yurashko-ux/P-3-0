// web/app/(admin)/admin/campaigns/seed/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { kvWrite } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const now = Date.now();
  const item = await kvWrite.createCampaign({
    id: String(now),
    name: 'UI-created',
    created_at: now,
    active: false,
    base_pipeline_id: null,
    base_status_id: null,
    rules: {
      v1: { op: 'contains', value: 'ціна' },
      v2: { op: 'equals', value: 'привіт' },
    },
    v1_count: 0,
    v2_count: 0,
    exp_count: 0,
  });

  const url = new URL(req.url);
  url.pathname = '/admin/campaigns';
  url.search = '?created=1';
  return NextResponse.redirect(url, 303);
}

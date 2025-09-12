// web/app/api/keycrm/search/route.ts
import { NextResponse } from 'next/server';
import { kcFindCardIdByAny } from '@/lib/keycrm';

export const dynamic = 'force-dynamic';

function toNumOrStr(v: string): number | string {
  return /^\d+$/.test(v) ? Number(v) : v;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const username = (url.searchParams.get('username') || '').trim() || undefined;
    // приймаємо і full_name, і fullname – мапимо на full_name
    const fullNameParam =
      (url.searchParams.get('full_name') || url.searchParams.get('fullname') || '').trim() || undefined;

    const pipelineParam = (url.searchParams.get('pipeline_id') || '').trim();
    const statusParam = (url.searchParams.get('status_id') || '').trim();
    const limitParam = (url.searchParams.get('limit') || '').trim();

    const args: {
      username?: string | null;
      full_name?: string | null;
      name?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      pipeline_id?: string | number;
      status_id?: string | number;
      limit?: number;
    } = {};

    if (username) args.username = username;
    if (fullNameParam) args.full_name = fullNameParam;

    if (pipelineParam) args.pipeline_id = toNumOrStr(pipelineParam);
    if (statusParam) args.status_id = toNumOrStr(statusParam);
    if (/^\d+$/.test(limitParam)) args.limit = Number(limitParam);

    const result = await kcFindCardIdByAny(args);
    return NextResponse.json({ ok: result.ok, result, used: args }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

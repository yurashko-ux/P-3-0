// web/app/api/keycrm/card/by-username/route.ts
import { NextResponse } from 'next/server';
import { findCardIdByUsername } from '@/lib/keycrm';

export const dynamic = 'force-dynamic';

function toNumOrStr(v: string): number | string {
  return /^\d+$/.test(v) ? Number(v) : v;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const username = (url.searchParams.get('username') || '').trim();
    const pipelineParam = (url.searchParams.get('pipeline_id') || '').trim();
    const statusParam = (url.searchParams.get('status_id') || '').trim();
    const limitParam = (url.searchParams.get('limit') || '').trim();

    if (!username || !pipelineParam || !statusParam) {
      return NextResponse.json(
        {
          ok: false,
          error: 'missing_params',
          need: { username: !username ? 'required' : 'ok', pipeline_id: !pipelineParam ? 'required' : 'ok', status_id: !statusParam ? 'required' : 'ok' },
          hint: 'GET ?username=<ig>&pipeline_id=<id>&status_id=<id>[&limit=...]',
        },
        { status: 400 }
      );
    }

    const params: { username: string; pipeline_id: string | number; status_id: string | number; limit?: number } = {
      username,
      pipeline_id: toNumOrStr(pipelineParam),
      status_id: toNumOrStr(statusParam),
    };
    if (/^\d+$/.test(limitParam)) params.limit = Number(limitParam);

    const found = await findCardIdByUsername(params);
    return NextResponse.json(found, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

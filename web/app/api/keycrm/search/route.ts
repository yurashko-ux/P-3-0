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

    const username =
      (url.searchParams.get('username') || '').trim() || undefined;

    // підтримуємо і full_name, і legacy fullname
    const full_name =
      (url.searchParams.get('full_name') ||
        url.searchParams.get('fullname') ||
        ''
      ).trim() || undefined;

    const pipelineParam = (url.searchParams.get('pipeline_id') || '').trim();
    const statusParam   = (url.searchParams.get('status_id')   || '').trim();
    const limitParam    = (url.searchParams.get('limit')       || '').trim();

    if (!pipelineParam || !statusParam) {
      return NextResponse.json(
        {
          ok: false,
          error: 'pipeline_id_and_status_id_required',
          hint:
            'Передай ?pipeline_id=<id>&status_id=<id>. Опційно: username, full_name, limit',
          example:
            '/api/keycrm/search?username=kolachnyk.v&full_name=Viktoria%20Kolachnyk&pipeline_id=1&status_id=38&limit=5',
        },
        { status: 400 },
      );
    }

    const args: {
      username?: string | null;
      full_name?: string | null;
      name?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      pipeline_id: string | number;
      status_id: string | number;
      limit?: number;
    } = {
      pipeline_id: toNumOrStr(pipelineParam),
      status_id: toNumOrStr(statusParam),
    };

    if (username) args.username = username;
    if (full_name) args.full_name = full_name;
    if (/^\d+$/.test(limitParam)) args.limit = Number(limitParam);

    const result: any = await kcFindCardIdByAny(args).catch(() => null);

    return NextResponse.json(
      { ok: !!(result && result.ok), result, used: args },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'failed' },
      { status: 500 },
    );
  }
}

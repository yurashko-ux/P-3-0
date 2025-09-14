// web/app/api/keycrm/card/by-username/route.ts
import { NextResponse } from 'next/server';
import { findCardIdByUsername } from '@/lib/keycrm';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);

    const username = (u.searchParams.get('username') || '').trim();
    const pipelineParam = u.searchParams.get('pipeline_id') || '';
    const statusParam = u.searchParams.get('status_id') || '';
    // backward-compat: ?limit= — використовуємо як per_page
    const limitParam =
      u.searchParams.get('limit') ||
      u.searchParams.get('per_page') ||
      '';

    if (!username) {
      return NextResponse.json(
        { ok: false, error: 'username is required' },
        { status: 400 }
      );
    }

    const opts: {
      pipeline_id?: number | string;
      status_id?: number | string;
      per_page?: number;
      max_pages?: number;
    } = {};

    if (pipelineParam) {
      opts.pipeline_id = /^\d+$/.test(pipelineParam)
        ? Number(pipelineParam)
        : pipelineParam;
    }
    if (statusParam) {
      opts.status_id = /^\d+$/.test(statusParam)
        ? Number(statusParam)
        : statusParam;
    }
    if (/^\d+$/.test(limitParam)) {
      opts.per_page = Number(limitParam);
    }

    const found = await findCardIdByUsername(username, opts);
    return NextResponse.json(found, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'failed' },
      { status: 500 }
    );
  }
}

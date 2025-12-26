// web/app/api/admin/direct/state-history/route.ts
// API endpoint для отримання історії змін станів клієнта

import { NextRequest, NextResponse } from 'next/server';
import { getClientStateInfo } from '@/lib/direct-state-log';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get('clientId');

    if (!clientId) {
      return NextResponse.json(
        { ok: false, error: 'clientId is required' },
        { status: 400 }
      );
    }

    const info = await getClientStateInfo(clientId);

    return NextResponse.json({
      ok: true,
      data: info,
    });
  } catch (err) {
    console.error('[admin/direct/state-history] Error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

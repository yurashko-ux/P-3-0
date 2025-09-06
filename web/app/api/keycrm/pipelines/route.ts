import { NextResponse } from 'next/server';
import { listPipelines } from '../../../../lib/keycrm';

export async function GET() {
  try {
    const data = await listPipelines();
    return NextResponse.json({ ok: true, items: data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

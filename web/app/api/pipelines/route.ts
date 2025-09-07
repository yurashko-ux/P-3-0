// web/app/api/pipelines/route.ts
import { NextResponse } from 'next/server';
export const runtime = 'edge';

export async function GET(req: Request) {
  // Проксі на новий ендпоїнт; гарантуємо МАСИВ у відповіді
  const url = new URL(req.url);
  const r = await fetch(`${url.origin}/api/keycrm/pipelines`, { cache: 'no-store' });
  const data = await r.json();
  // Якщо з якоїсь причини прийшов об'єкт — дістанемо масив із відомих полів
  const arr = Array.isArray(data) ? data : (data?.pipelines ?? data?.result ?? []);
  return NextResponse.json(Array.isArray(arr) ? arr : [], { status: r.status });
}

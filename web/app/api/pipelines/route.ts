// web/app/api/pipelines/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET(req: Request) {
  // Проксі на новий ендпоїнт, зберігаємо форму відповіді
  const url = new URL(req.url);
  // Дозволяємо формі, яка очікує масив, попросити shape=array
  const shape = url.searchParams.get('shape') ?? 'object';
  const r = await fetch(`${url.origin}/api/keycrm/pipelines${shape === 'array' ? '?shape=array' : ''}`, {
    cache: 'no-store',
  });
  const data = await r.json();
  return NextResponse.json(data, { status: r.status });
}

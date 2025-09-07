// web/app/api/pipelines/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'edge';

/**
 * Проксі на /api/keycrm/pipelines
 * - за замовчуванням повертає { pipelines: Pipeline[] }
 * - підтримує ?shape=array для масиву
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const shape = url.searchParams.get('shape');
  const target = `${url.origin}/api/keycrm/pipelines${shape === 'array' ? '?shape=array' : ''}`;

  const r = await fetch(target, { cache: 'no-store' });
  const data = await r.json();

  // Гарантуємо очікуваний формат для форми:
  if (shape === 'array') {
    // форма/код, який просить масив
    return NextResponse.json(Array.isArray(data) ? data : data?.pipelines ?? []);
  }
  // форма/код, який очікує { pipelines }
  const pipelines = Array.isArray(data) ? data : (data?.pipelines ?? []);
  return NextResponse.json({ pipelines });
}

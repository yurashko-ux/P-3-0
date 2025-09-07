// web/app/api/keycrm/pipelines/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'edge';

const KV_URL = process.env.KV_REST_API_URL!;
const KV_TOKEN = process.env.KV_REST_API_TOKEN!;

function kv(path: string) {
  return fetch(`${KV_URL}/${path}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: 'no-store',
  });
}

/**
 * Повертає:
 *  - { pipelines: Pipeline[] } — за замовчуванням (сумісно з формою створення кампанії)
 *  - Pipeline[] — якщо додати ?shape=array
 *
 * Формат Pipeline:
 * { id: string, name: string, statuses: { id: string, name: string }[] }
 */
export async function GET(req: Request) {
  try {
    // Читаємо з кількох можливих ключів, щоб не зламати старі кеші
    const keys = [
      'get/keycrm:pipelines',
      'get/keycrm:pipelines:all',
      'get/keycrm:pipelines:v1',
      'get/pipelines',
    ];

    let pipelinesRaw: any[] = [];
    for (const key of keys) {
      const res = await kv(key);
      const json = await res.json();
      const maybe = json?.result ? JSON.parse(json.result) : null;
      if (Array.isArray(maybe) && maybe.length) {
        pipelinesRaw = maybe;
        break;
      }
    }

    // Нормалізація
    const pipelines = (Array.isArray(pipelinesRaw) ? pipelinesRaw : []).map((p: any) => ({
      id: String(p.id),
      name: String(p.name ?? p.title ?? 'Без назви'),
      statuses: Array.isArray(p.statuses)
        ? p.statuses.map((s: any) => ({
            id: String(s.id),
            name: String(s.name ?? s.title ?? 'Без назви'),
          }))
        : [],
    }));

    const url = new URL(req.url);
    const shape = url.searchParams.get('shape'); // 'array' | undefined

    if (shape === 'array') {
      return NextResponse.json(pipelines);
    }
    return NextResponse.json({ pipelines });
  } catch {
    const url = new URL(req.url);
    const shape = url.searchParams.get('shape');
    if (shape === 'array') return NextResponse.json([]);
    return NextResponse.json({ pipelines: [] });
  }
}

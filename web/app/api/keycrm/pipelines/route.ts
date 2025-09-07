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
 * Повертаємо МАСИВ, сумісний зі старою формою.
 * Фолбек: читаємо кілька можливих ключів у KV, щоб не зламати старі кеші.
 */
export async function GET() {
  try {
    // 1) Основний ключ
    let res = await kv('get/keycrm:pipelines');
    let json = await res.json();
    let arr: any[] = json?.result ? JSON.parse(json.result) : [];

    // 2) Фолбеки на випадок іншої назви ключа
    if (!Array.isArray(arr) || arr.length === 0) {
      const fallbacks = ['get/pipelines', 'get/keycrm:pipelines:all', 'get/keycrm:pipelines:v1'];
      for (const key of fallbacks) {
        res = await kv(key);
        json = await res.json();
        const maybe = json?.result ? JSON.parse(json.result) : [];
        if (Array.isArray(maybe) && maybe.length) {
          arr = maybe;
          break;
        }
      }
    }

    // Нормалізація структури елементів (гарантуємо {id,name,statuses:[{id,name}]})
    const pipelines = Array.isArray(arr)
      ? arr.map((p: any) => ({
          id: String(p.id),
          name: String(p.name ?? p.title ?? 'Без назви'),
          statuses: Array.isArray(p.statuses)
            ? p.statuses.map((s: any) => ({ id: String(s.id), name: String(s.name ?? s.title ?? 'Без назви') }))
            : [],
        }))
      : [];

    return NextResponse.json(pipelines);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}

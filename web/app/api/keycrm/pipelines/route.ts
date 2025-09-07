// web/app/api/keycrm/pipelines/route.ts
import { NextResponse } from 'next/server';
export const runtime = 'edge';

const KV_URL = process.env.KV_REST_API_URL!;
const KV_TOKEN = process.env.KV_REST_API_TOKEN!;

const kv = (path: string) =>
  fetch(`${KV_URL}/${path}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: 'no-store',
  });

export async function GET(req: Request) {
  // 1) читаємо кеш з KV
  try {
    const res = await kv('get/keycrm:pipelines');
    const json = await res.json();
    const pipelines = json?.result ? JSON.parse(json.result) : [];
    // Повертаємо формат, який зручно споживати і старій формі, і новій
    // - якщо код очікує { pipelines }, отримає саме це
    // - якщо код робить Array.isArray(response), то можна віддати масив напряму
    const url = new URL(req.url);
    const shape = url.searchParams.get('shape'); // optional: 'array' | 'object'
    if (shape === 'array') return NextResponse.json(pipelines);
    return NextResponse.json({ pipelines });
  } catch (e) {
    // у разі проблем — порожній список, щоб UI не падав
    return NextResponse.json({ pipelines: [] });
  }
}

// web/app/api/keycrm/pipelines/route.ts
import { NextResponse } from 'next/server';
export const runtime = 'edge';

const KV_URL = process.env.KV_REST_API_URL!;
const KV_TOKEN = process.env.KV_REST_API_TOKEN!;

const kv = (path: string) =>
  fetch(`${KV_URL}/${path}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` }, cache: 'no-store' });

export async function GET() {
  // Очікується JSON у KV за ключем keycrm:pipelines:
  // [{ id, name, statuses: [{ id, name }, ...] }, ...]
  const res = await kv('get/keycrm:pipelines');
  const json = await res.json();
  const data = json?.result ? JSON.parse(json.result) : [];
  return NextResponse.json({ pipelines: data });
}

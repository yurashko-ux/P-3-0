// /app/api/debug/kv/route.ts
import { NextResponse } from 'next/server';
import { kvScan, kvGetItem } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const scan = await kvScan('*', 500);
  const sample = await Promise.all(
    scan.keys
      .filter((k) => k.startsWith('cmp:item:'))
      .slice(0, 10)
      .map(async (k) => ({ key: k, value: await kvGetItem(k.replace('cmp:item:', '')) }))
  );
  return NextResponse.json({ scan, sample });
}

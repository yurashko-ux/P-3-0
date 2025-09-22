// web/app/api/map/ig/route.ts
// Normalize ManyChat IG payload -> { title, handle? } tailored to:
// { username, text, full_name, name, first_name, last_name }

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type AnyObj = Record<string, any>;

function s(v: any): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function normalize(input: AnyObj): { title: string; handle?: string; text?: string } {
  // exact fields ManyChat sends per user:
  // { username, text, full_name, name, first_name, last_name }
  const username = s(input.username);
  const text = s(input.text);

  // prefer full_name/name if present, else construct from first/last, else fallback to username
  const fullName =
    s(input.full_name) ||
    s(input.name) ||
    (s(input.first_name) || s(input.last_name)
      ? [s(input.first_name), s(input.last_name)].filter(Boolean).join(' ')
      : undefined);

  const title = fullName || username || '';

  if (!title) {
    throw new Error('Cannot map payload: need at least full_name/name or username');
  }

  const out: { title: string; handle?: string; text?: string } = { title };
  if (username) out.handle = username;
  if (text) out.text = text; // keep last input text if provided
  return out;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as AnyObj | AnyObj[];
    // allow array or object
    const data = Array.isArray(body) ? body[0] ?? {} : body ?? {};
    const mapped = normalize(data);
    return NextResponse.json({ ok: true, mapped }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

export async function GET() {
  // simple example using your exact fields
  const exampleIn = {
    username: 'viktoriak',
    text: 'hi!',
    full_name: 'Viktoria Kolachnyk',
    name: 'Viktoria Kolachnyk',
    first_name: 'Viktoria',
    last_name: 'Kolachnyk',
  };
  const mapped = normalize(exampleIn);
  return NextResponse.json({ ok: true, example_in: exampleIn, example_out: mapped }, { headers: { 'Cache-Control': 'no-store' } });
}

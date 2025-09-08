// web/app/api/map/ig/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { kvGet, kvSet } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ADMIN = process.env.ADMIN_PASS ?? '';

function okAuth(req: NextRequest) {
  const bearer = req.headers.get('authorization') || '';
  const token = bearer.startsWith('Bearer ') ? bearer.slice(7) : '';
  const cookiePass = cookies().get('admin_pass')?.value || '';
  const pass = token || cookiePass;
  return !ADMIN || pass === ADMIN;
}

function bad(status: number, error: string, extra?: any) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}
function ok(data: any = {}) { return NextResponse.json({ ok: true, ...data }); }

function normUser(u: string) {
  return String(u || '').trim().toLowerCase();
}

// POST: створити/оновити мапінг username -> card_id
export async function POST(req: NextRequest) {
  if (!okAuth(req)) return bad(401, 'unauthorized');

  const b = await req.json().catch(() => ({}));
  const username = normUser(b.username);
  const card_id = String(b.card_id || '').trim();

  if (!username || !card_id) return bad(400, 'username and card_id required');

  const key = `map:ig:${username}`;
  const saved = await kvSet(key, card_id);
  if (!saved) return bad(500, 'kvSet failed');

  return ok({ username, card_id });
}

// GET: прочитати мапінг
export async function GET(req: NextRequest) {
  if (!okAuth(req)) return bad(401, 'unauthorized');

  const url = new URL(req.url);
  const username = normUser(url.searchParams.get('username') || '');
  if (!username) return bad(400, 'username required');

  const key = `map:ig:${username}`;
  const raw = await kvGet(key);
  return ok({ username, card_id: raw || null });
}

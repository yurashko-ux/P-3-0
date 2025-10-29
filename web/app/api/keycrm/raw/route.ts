// web/app/api/keycrm/raw/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { baseUrl, ensureBearer } from '../_common';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ADMIN = process.env.ADMIN_PASS ?? '';

function okAuth(req: NextRequest) {
  const hdr = req.headers.get('authorization') || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
  const cookiePass = cookies().get('admin_pass')?.value || '';
  const pass = token || cookiePass;
  return !ADMIN || pass === ADMIN;
}

function join(base: string, path: string) {
  return `${base.replace(/\/+$/, '')}/${String(path || '').replace(/^\/+/, '')}`;
}

function json(data: any, init?: number | ResponseInit) {
  return NextResponse.json(data, init as any);
}

export async function GET(req: NextRequest) {
  if (!okAuth(req)) return json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const base = baseUrl();
  const token = ensureBearer(
    process.env.KEYCRM_BEARER ||
      process.env.KEYCRM_API_TOKEN ||
      process.env.KEYCRM_TOKEN ||
      ''
  );

  const url = new URL(req.url);
  const path = url.searchParams.get('path') || '';
  const method = (url.searchParams.get('method') || 'GET').toUpperCase();

  if (!base || !token) {
    return json(
      {
        ok: false,
        error: 'keycrm not configured',
        need: { KEYCRM_BASE_URL_or_ALTS: !!base, KEYCRM_TOKEN_or_BEARER: !!token },
      },
      { status: 500 }
    );
  }

  const auth = token;
  const target = join(base, path);

  const r = await fetch(target, {
    method,
    headers: { Authorization: auth },
    cache: 'no-store',
  });

  const text = await r.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch {}

  return json({
    ok: r.ok,
    status: r.status,
    url: target,
    method,
    response: parsed ?? { text },
  }, { status: r.ok ? 200 : 502 });
}

export async function POST(req: NextRequest) {
  if (!okAuth(req)) return json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const base = baseUrl();
  const token = ensureBearer(
    process.env.KEYCRM_BEARER ||
      process.env.KEYCRM_API_TOKEN ||
      process.env.KEYCRM_TOKEN ||
      ''
  );

  if (!base || !token) {
    return json(
      {
        ok: false,
        error: 'keycrm not configured',
        need: { KEYCRM_BASE_URL_or_ALTS: !!base, KEYCRM_TOKEN_or_BEARER: !!token },
      },
      { status: 500 }
    );
  }

  const b = await req.json().catch(() => ({} as any));
  const path: string = b.path || '';
  const method: string = (b.method || 'POST').toUpperCase();
  const payload = b.body ?? null;

  const auth = token;
  const target = join(base, path);

  const headers: Record<string, string> = { Authorization: auth };
  let body: string | undefined;
  if (payload !== null && payload !== undefined && method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(payload);
  }

  const r = await fetch(target, {
    method,
    headers,
    body,
    cache: 'no-store',
  });

  const text = await r.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch {}

  return json(
    {
      ok: r.ok,
      status: r.status,
      url: target,
      method,
      sent: { path, method, body: payload ?? null },
      response: parsed ?? { text },
    },
    { status: r.ok ? 200 : 502 }
  );
}

// web/app/api/admin/login2/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function isHttps(req: Request) {
  try {
    const url = new URL(req.url);
    const xfProto = (req.headers.get('x-forwarded-proto') || '').toLowerCase();
    return url.protocol === 'https:' || xfProto === 'https';
  } catch {
    return true;
  }
}

export async function POST(req: Request) {
  let pass = '';
  let next = '/admin/campaigns2';

  try {
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const body = await req.json().catch(() => ({}));
      pass = String(body.pass || '');
      next = String(body.next || next);
    } else {
      const fd = await req.formData().catch(() => null);
      if (fd) {
        pass = String(fd.get('pass') || '');
        next = String(fd.get('next') || next);
      }
    }
  } catch {}

  const envPass = (process.env.ADMIN_PASS || '').trim();
  const ok = envPass ? pass === envPass : true; // якщо ADMIN_PASS не заданий — пускаємо (режим налаштування)
  if (!ok) return NextResponse.json({ ok: false, error: 'invalid pass' }, { status: 401 });

  const res = NextResponse.redirect(new URL(next || '/admin/campaigns2', req.url), { status: 303 });
  const maxAge = 60 * 60 * 24 * 30;
  const secure = isHttps(req);

  // ставимо ТІ Ж самі куки, що приймає твій middleware
  res.cookies.set('admin', '1', { path: '/', httpOnly: false, sameSite: 'lax', secure, maxAge });
  res.cookies.set('admin_pass', pass, { path: '/', httpOnly: false, sameSite: 'lax', secure, maxAge });

  return res;
}

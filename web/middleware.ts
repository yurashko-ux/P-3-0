import { NextRequest, NextResponse } from 'next/server';

function isAllowlisted(pathname: string) {
  if (pathname.startsWith('/api/public/')) return true; // публічні вебхуки
  if (pathname.startsWith('/_next/')) return true;      // статика
  if (pathname === '/favicon.ico') return true;
  if (pathname === '/robots.txt') return true;
  return false;
}

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') return NextResponse.next(); // preflight

  if (isAllowlisted(pathname)) return NextResponse.next();

  const protect = pathname.startsWith('/api') || pathname.startsWith('/admin');
  if (!protect) return NextResponse.next();

  const ADMIN_PASS = (process.env.ADMIN_PASS || process.env.ADMIN_PASSWORD || '').trim();
  if (!ADMIN_PASS) return NextResponse.next();

  const attempts: Array<{ kind: string; ok: boolean }> = [];

  const xAdmin = req.headers.get('x-admin-pass') || '';
  attempts.push({ kind: 'header:x-admin-pass', ok: !!xAdmin && xAdmin === ADMIN_PASS });

  const auth = req.headers.get('authorization') || '';
  let bearerOk = false;
  if (auth.toLowerCase().startsWith('bearer ')) {
    bearerOk = auth.slice(7).trim() === ADMIN_PASS;
  }
  attempts.push({ kind: 'authorization:bearer', ok: bearerOk });

  let basicOk = false;
  if (auth.toLowerCase().startsWith('basic ')) {
    try {
      const decoded = atob(auth.slice(6).trim());
      const [, pass = ''] = decoded.split(':', 2);
      basicOk = pass === ADMIN_PASS;
    } catch { basicOk = false; }
  }
  attempts.push({ kind: 'authorization:basic', ok: basicOk });

  const qPass = url.searchParams.get('pass') || '';
  attempts.push({ kind: 'query:pass', ok: !!qPass && qPass === ADMIN_PASS });

  const cPass = req.cookies.get('admin_pass')?.value || '';
  attempts.push({ kind: 'cookie:admin_pass', ok: !!cPass && cPass === ADMIN_PASS });

  if (attempts.some(a => a.ok)) return NextResponse.next();

  return NextResponse.json(
    { ok: false, status: 401, error: 'All auth attempts failed', attempts },
    { status: 401 },
  );
}

export const config = {
  matcher: ['/api/:path*', '/admin/:path*'],
};

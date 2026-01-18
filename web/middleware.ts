// web/middleware.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export const config = { matcher: ['/admin/:path*', '/finance-report/:path*'] };

export default function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const pathname = url.pathname;
  const host = req.headers.get('host') || '';
  const ADMIN_PASS = process.env.ADMIN_PASS || '';
  const FINANCE_REPORT_PASS = process.env.FINANCE_REPORT_PASS || '';

  const dbgRunId = `login_dbg_${Date.now()}`;
  const dbg = (payload: any) => {
    // #region agent log
    try {
      const isLocalHost = host.includes('localhost') || host.includes('127.0.0.1');
      if (!isLocalHost) return;
      fetch('http://127.0.0.1:7242/ingest/595eab05-4474-426a-a5a5-f753883b9c55', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'debug-session', runId: dbgRunId, timestamp: Date.now(), ...payload }),
      }).catch(() => {});
    } catch {}
    // #endregion agent log
  };

  const isHttps = (() => {
    try {
      const xfProto = (req.headers.get('x-forwarded-proto') || '').toLowerCase();
      const proto = url.protocol;
      return proto === 'https:' || xfProto === 'https';
    } catch {
      return true;
    }
  })();

  // ===== ПЕРЕВІРКА ДОМЕНУ: Якщо finance-hob.vercel.app, дозволяємо тільки фінансовий звіт =====
  const isFinanceReportDomain = host === 'finance-hob.vercel.app';
  
  if (isFinanceReportDomain) {
    // На цьому домені дозволяємо тільки:
    // - /finance-report/*
    // - /admin/finance-report/*
    // Всі інші /admin/* шляхи блокуємо
    
    if (pathname.startsWith('/admin') && !pathname.startsWith('/admin/finance-report')) {
      // Редірект на логін фінансового звіту
      const loginUrl = url.clone();
      loginUrl.pathname = '/finance-report/login';
      loginUrl.search = '';
      return NextResponse.redirect(loginUrl);
    }
  }

  // ===== ОКРЕМА ЛОГІКА ДЛЯ ФІНАНСОВОГО ЗВІТУ =====
  
  // Логін для фінансового звіту через /finance-report/login
  if (pathname === '/finance-report/login') {
    const qToken = url.searchParams.get('fr_token');
    if (qToken !== null) {
      const token = (qToken || '').trim();
      const cleanDest = new URL(url);
      cleanDest.pathname = '/admin/finance-report';
      cleanDest.search = '';

      if (token === FINANCE_REPORT_PASS && FINANCE_REPORT_PASS) {
        const res = NextResponse.redirect(cleanDest);
        res.cookies.set('finance_report_token', token, {
          path: '/',
          sameSite: 'lax',
          httpOnly: false,
          secure: isHttps,
          maxAge: 60 * 60 * 24 * 30, // 30 днів
        });
        return res;
      } else {
        const back = new URL(url);
        back.searchParams.delete('fr_token');
        back.searchParams.set('err', '1');
        const res = NextResponse.redirect(back);
        res.cookies.set('finance_report_token', '', { path: '/', maxAge: 0 });
        return res;
      }
    }
    // Просто віддати сторінку логіну
    return NextResponse.next();
  }

  // Перевірка доступу до /admin/finance-report
  if (pathname.startsWith('/admin/finance-report')) {
    // Обробка логіну через ?fr_token=
    const qFrToken = url.searchParams.get('fr_token');
    if (qFrToken !== null) {
      const token = (qFrToken || '').trim();
      const cleanDest = new URL(url);
      cleanDest.searchParams.delete('fr_token');

      if (token === FINANCE_REPORT_PASS && FINANCE_REPORT_PASS) {
        const res = NextResponse.redirect(cleanDest);
        res.cookies.set('finance_report_token', token, {
          path: '/',
          sameSite: 'lax',
          httpOnly: false,
          secure: isHttps,
          maxAge: 60 * 60 * 24 * 30, // 30 днів
        });
        return res;
      } else {
        const loginUrl = url.clone();
        loginUrl.pathname = '/finance-report/login';
        loginUrl.searchParams.delete('fr_token');
        loginUrl.searchParams.set('err', '1');
        const res = NextResponse.redirect(loginUrl);
        res.cookies.set('finance_report_token', '', { path: '/', maxAge: 0 });
        return res;
      }
    }

    // Якщо є адмін-токен, дозволяємо доступ
    const adminToken = req.cookies.get('admin_token')?.value || '';
    if (ADMIN_PASS && adminToken === ADMIN_PASS) {
      return NextResponse.next();
    }

    // Якщо немає FINANCE_REPORT_PASS, дозволяємо (для налаштування)
    if (!FINANCE_REPORT_PASS) {
      return NextResponse.next();
    }

    // Перевіряємо finance_report_token
    const frToken = req.cookies.get('finance_report_token')?.value || '';
    if (frToken !== FINANCE_REPORT_PASS) {
      const loginUrl = url.clone();
      loginUrl.pathname = '/finance-report/login';
      if (!loginUrl.searchParams.has('err')) {
        loginUrl.searchParams.set('err', 'auth');
      }
      return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
  }

  // Logout для фінансового звіту
  if (pathname === '/admin/finance-report/logout') {
    const loginUrl = url.clone();
    loginUrl.pathname = '/finance-report/login';
    loginUrl.search = '';
    const res = NextResponse.redirect(loginUrl);
    res.cookies.set('finance_report_token', '', { path: '/', maxAge: 0 });
    return res;
  }

  // ===== СТАНДАРТНА ЛОГІКА ДЛЯ РЕШТИ АДМІНКИ =====

  // 1) /admin/logout — очистити сесію і на логін
  if (pathname === '/admin/logout') {
    const back = url.clone();
    back.pathname = '/admin/login';
    back.search = '';
    const res = NextResponse.redirect(back);
    res.cookies.set('admin_token', '', { path: '/', maxAge: 0 });
    return res;
  }

  // 2) /admin/login — показуємо сторінку, але обробляємо ?token=
  if (pathname === '/admin/login') {
    const qToken = url.searchParams.get('token');
    if (qToken !== null) {
      const token = (qToken || '').trim();
      dbg({
        hypothesisId: 'L1',
        location: 'middleware.ts:/admin/login',
        message: 'admin_login_token_received',
        data: {
          host,
          isHttps,
          hasAdminPass: !!ADMIN_PASS,
          tokenLen: token.length,
        },
      });

      // якщо ADMIN_PASS не заданий — не пускаємо, просимо адміна виставити змінну
      if (!ADMIN_PASS) {
        dbg({
          hypothesisId: 'L2',
          location: 'middleware.ts:/admin/login',
          message: 'admin_login_blocked_missing_env',
          data: { host, isHttps },
        });
        const back = new URL(url);
        back.searchParams.delete('token');
        back.searchParams.set('err', 'env'); // немає ADMIN_PASS у середовищі
        const res = NextResponse.redirect(back);
        res.cookies.set('admin_token', '', { path: '/', maxAge: 0 });
        return res;
      }

      // звичайний точний збіг
      const cleanDest = new URL(url);
      cleanDest.pathname = '/admin';          // після логіну одразу на домашню сторінку адмінки
      cleanDest.search = '';

      if (token === ADMIN_PASS) {
        dbg({
          hypothesisId: 'L3',
          location: 'middleware.ts:/admin/login',
          message: 'admin_login_success_cookie_set',
          data: {
            host,
            isHttps,
            cookieName: 'admin_token',
            secureFlag: isHttps,
          },
        });
        const res = NextResponse.redirect(cleanDest);
        res.cookies.set('admin_token', token, {
          path: '/',
          sameSite: 'lax',
          httpOnly: false,
          secure: isHttps,
          maxAge: 60 * 60 * 24 * 7, // 7 днів
        });

        return res;
      } else {
        dbg({
          hypothesisId: 'L4',
          location: 'middleware.ts:/admin/login',
          message: 'admin_login_wrong_token',
          data: { host, isHttps, tokenLen: token.length, hasAdminPass: !!ADMIN_PASS },
        });
        const back = new URL(url);
        back.searchParams.delete('token');
        back.searchParams.set('err', '1'); // невірний токен
        const res = NextResponse.redirect(back);
        res.cookies.set('admin_token', '', { path: '/', maxAge: 0 });
        return res;
      }
    }
    // просто віддати сторінку логіну
    return NextResponse.next();
  }

  // 3) Усі інші /admin/* — потрібен заданий ADMIN_PASS і валідна кука
  if (!ADMIN_PASS) {
    dbg({
      hypothesisId: 'L5',
      location: 'middleware.ts:/admin/*',
      message: 'admin_blocked_missing_env',
      data: { host, isHttps, pathname },
    });
    const loginUrl = url.clone();
    loginUrl.pathname = '/admin/login';
    loginUrl.searchParams.set('err', 'env'); // підказка що нема ADMIN_PASS
    return NextResponse.redirect(loginUrl);
  }

  const cookieToken = req.cookies.get('admin_token')?.value || '';
  if (cookieToken !== ADMIN_PASS) {
    const loginUrl = url.clone();
    loginUrl.pathname = '/admin/login';
    loginUrl.searchParams.set('err', '1'); // невірний або відсутній токен
    return NextResponse.redirect(loginUrl);
  }

  // все гаразд
  return NextResponse.next();
}

// web/middleware.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export const config = {
  matcher: ['/admin/:path*', '/finance-report/:path*', '/api/bank/monobank/webhook'],
};

export default async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const pathname = url.pathname;

  // Monobank валідує вебхук GET — відповідаємо 200 на Edge (без cold start), інакше Monobank не зберігає URL
  if (pathname === '/api/bank/monobank/webhook' && req.method === 'GET') {
    return new NextResponse(null, { status: 200 });
  }

  // API routes — не застосовувати middleware, вони самі обробляють авторизацію
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }
  const host = req.headers.get('host') || '';
  const ADMIN_PASS = process.env.ADMIN_PASS || '';
  const FINANCE_REPORT_PASS = process.env.FINANCE_REPORT_PASS || '';
  const isLocalhost = host.startsWith('localhost') || host.startsWith('127.0.0.1');

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
      // Не показуємо "невірний пароль" до першої спроби входу.
      // err=auth додаємо лише якщо токен був, але невалідний.
      if (frToken && !loginUrl.searchParams.has('err')) {
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
      // Вхід по токену тільки на p-3-0.vercel.app; на cresco-crm редіректимо
      if (host === 'cresco-crm.vercel.app') {
        const p30Login = new URL('https://p-3-0.vercel.app/admin/login');
        p30Login.searchParams.set('token', qToken);
        return NextResponse.redirect(p30Login);
      }

      const token = (qToken || '').trim();

      // якщо ADMIN_PASS не заданий — не пускаємо, просимо адміна виставити змінну
      if (!ADMIN_PASS) {
        const back = new URL(url);
        back.searchParams.delete('token');
        back.searchParams.set('err', 'env'); // немає ADMIN_PASS у середовищі
        const res = NextResponse.redirect(back);
        res.cookies.set('admin_token', '', { path: '/', maxAge: 0 });
        return res;
      }

      // звичайний точний збіг
      const cleanDest = new URL(url);
      cleanDest.pathname = '/admin/direct';          // після логіну одразу на розділ Дірект
      cleanDest.search = '';

      if (token === ADMIN_PASS) {
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

  // Preview-деплой Vercel (наприклад p-3-0-xxxx-mykolays-projects.vercel.app) — доступ без логіну
  const isPreviewDeployment =
    host.endsWith('.vercel.app') &&
    host !== 'p-3-0.vercel.app' &&
    host !== 'cresco-crm.vercel.app';
  if (isPreviewDeployment) {
    return NextResponse.next();
  }

  // 3) Усі інші /admin/* — потрібна валідна кука (ADMIN_PASS або user session)
  // На cresco-crm.vercel.app логін лише по логіну/паролю (AppUser), ADMIN_PASS може бути не заданий — тоді приймаємо лише user session
  const cookieToken = req.cookies.get('admin_token')?.value || '';
  if (ADMIN_PASS && cookieToken === ADMIN_PASS) {
    return NextResponse.next();
  }
  const isValidUser = await import('@/lib/auth-token').then((m) =>
    m.verifyUserTokenAsync(cookieToken)
  );
  if (isValidUser) {
    return NextResponse.next();
  }
  // Якщо немає ні ADMIN_PASS, ні валідної user session — редірект на логін
  if (!ADMIN_PASS) {
    if (isLocalhost) {
      return NextResponse.next();
    }
    // На cresco-crm без куки — на логін (не вимагаємо ADMIN_PASS у env)
    if (host === 'cresco-crm.vercel.app') {
      const loginUrl = url.clone();
      loginUrl.pathname = '/admin/login';
      loginUrl.search = '';
      return NextResponse.redirect(loginUrl);
    }
    const loginUrl = url.clone();
    loginUrl.pathname = '/admin/login';
    loginUrl.searchParams.set('err', 'env');
    return NextResponse.redirect(loginUrl);
  }

  const loginUrl = url.clone();
  loginUrl.pathname = '/admin/login';
  loginUrl.searchParams.set('err', '1'); // невірний або відсутній токен

  return NextResponse.redirect(loginUrl);
}

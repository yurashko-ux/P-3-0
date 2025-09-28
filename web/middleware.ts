// web/middleware.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export const config = { matcher: ['/admin/:path*'] };

function setAuthCookie(res: NextResponse, value: string) {
  res.cookies.set('admin_token', value, {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    secure: true,
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
}

export default function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const pathname = url.pathname;
  const ADMIN_PASS = process.env.ADMIN_PASS || ''; // якщо пусто — dev-режим

  // logout: завжди можна викликати
  if (pathname === '/admin/logout') {
    const back = url.clone();
    back.pathname = '/admin/login';
    back.search = '';
    const res = NextResponse.redirect(back);
    res.cookies.set('admin_token', '', { path: '/', maxAge: 0 });
    return res;
  }

  // login-сторінка: показуємо її, але обробляємо ?token=
  if (pathname === '/admin/login') {
    const qToken = url.searchParams.get('token');
    if (qToken !== null) {
      const token = (qToken || '').trim();

      // PROD: потрібен точний збіг
      if (ADMIN_PASS) {
        if (token && token === ADMIN_PASS) {
          const clean = new URL(url);
          clean.searchParams.delete('token');
          clean.searchParams.delete('err');
          const res = NextResponse.redirect(clean);
          setAuthCookie(res, token);
          return res;
        }
        const back = new URL(url);
        back.searchParams.delete('token');
        back.searchParams.set('err', '1');
        const res = NextResponse.redirect(back);
        res.cookies.set('admin_token', '', { path: '/', maxAge: 0 });
        return res;
      }

      // DEV: якщо пароля нема в env — приймаємо будь-який непорожній токен
      if (token) {
        const clean = new URL(url);
        clean.searchParams.delete('token');
        clean.searchParams.delete('err');
        const res = NextResponse.redirect(clean);
        setAuthCookie(res, token);
        return res;
      }

      // порожній токен
      const back = new URL(url);
      back.searchParams.delete('token');
      back.searchParams.set('err', '1');
      return NextResponse.redirect(back);
    }
    return NextResponse.next();
  }

  // Будь-який інший /admin/*
  const cookieToken = req.cookies.get('admin_token')?.value || '';

  if (ADMIN_PASS) {
    // PROD: лише точний збіг
    if (cookieToken !== ADMIN_PASS) {
      const loginUrl = url.clone();
      loginUrl.pathname = '/admin/login';
      loginUrl.searchParams.set('err', '1');
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  } else {
    // DEV: достатньо, щоб була будь-яка непорожня кука
    if (!cookieToken) {
      const loginUrl = url.clone();
      loginUrl.pathname = '/admin/login';
      loginUrl.searchParams.set('err', '1');
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }
}

// web/middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function isAuthed(req: NextRequest): boolean {
  const c = req.cookies;
  const flag = c.get("admin")?.value === "1";
  const passCookie = c.get("admin_pass")?.value || "";
  const envPass = process.env.ADMIN_PASS || "";
  const okByPass = !!passCookie && !!envPass && passCookie === envPass;
  return flag || okByPass;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Дозволяємо сторінку логіну
  if (pathname === "/admin/login") return NextResponse.next();

  // Захищаємо /admin/*
  if (pathname.startsWith("/admin")) {
    if (isAuthed(req)) return NextResponse.next();

    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Працюємо тільки на /admin/*
export const config = {
  matcher: ["/admin/:path*"],
};

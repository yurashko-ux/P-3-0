// web/app/api/auth/login/route.ts
import { NextResponse } from "next/server";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { pass } = (await req.json().catch(() => ({}))) as { pass?: string };
    const adminPass = process.env.ADMIN_PASS || "";
    if (!adminPass) {
      return NextResponse.json({ ok: false, error: "ADMIN_PASS not set" }, { status: 500 });
    }
    if (!pass || pass !== adminPass) {
      return NextResponse.json({ ok: false, error: "invalid password" }, { status: 401 });
    }

    const res = NextResponse.json({ ok: true }, { status: 200 });

    // HttpOnly, Path=/, Lax, Secure-if-HTTPS
    const maxAge = 60 * 60 * 24 * 90; // 90 днів
    res.cookies.set("admin", "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge,
    });
    res.cookies.set("admin_pass", pass, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge,
    });

    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "login failed" }, { status: 500 });
  }
}

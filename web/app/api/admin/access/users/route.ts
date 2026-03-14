// web/app/api/admin/access/users/route.ts
// CRUD користувачів (лише для accessSection)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth-rbac";
import { requireAccessSection } from "../require-access";

export async function GET(req: Request) {
  try {
    const authOrErr = await requireAccessSection(req);
    if (authOrErr instanceof NextResponse) return authOrErr;

    const users = await prisma.appUser.findMany({
      orderBy: { createdAt: "desc" },
      include: { function: { select: { id: true, name: true } } },
    });

    return NextResponse.json(
      users.map((u) => ({
      id: u.id,
      name: u.name,
      login: u.login,
      phone: u.phone ?? null,
      functionId: u.functionId,
      functionName: u.function?.name ?? null,
      isActive: u.isActive,
      createdAt: u.createdAt.toISOString(),
    }))
  );
  } catch (err) {
    console.error("[api/admin/access/users] GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка завантаження користувачів" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const authOrErr = await requireAccessSection(req);
  if (authOrErr instanceof NextResponse) return authOrErr;
  if (authOrErr.type === "user" && authOrErr.permissions.accessSection !== "edit") {
    return NextResponse.json({ error: "Немає права створювати користувачів" }, { status: 403 });
  }

  let body: { name?: string; login?: string; password?: string; phone?: string; functionId?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Невалідний JSON" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const login = String(body.login ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const phone = body.phone ? String(body.phone).trim() || null : null;
  const functionId = body.functionId ? String(body.functionId).trim() || null : null;

  if (!name || !login || !password) {
    return NextResponse.json(
      { error: "Обовʼязкові поля: Імʼя, Логін, Пароль" },
      { status: 400 }
    );
  }

  if (password.length < 4) {
    return NextResponse.json({ error: "Пароль має бути щонайменше 4 символи" }, { status: 400 });
  }

  const existing = await prisma.appUser.findUnique({ where: { login } });
  if (existing) {
    return NextResponse.json({ error: "Користувач з таким логіном вже існує" }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.appUser.create({
    data: {
      name,
      login,
      passwordHash,
      phone,
      functionId,
      isActive: true,
    },
    include: { function: { select: { id: true, name: true } } },
  });

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      name: user.name,
      login: user.login,
      phone: user.phone,
      functionName: user.function?.name,
      createdAt: user.createdAt.toISOString(),
    },
  });
}

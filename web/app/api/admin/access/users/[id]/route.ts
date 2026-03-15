// web/app/api/admin/access/users/[id]/route.ts
// PATCH та DELETE користувача (лише для accessSection edit)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth-rbac";
import { requireAccessSection } from "../../require-access";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const authOrErr = await requireAccessSection(req);
  if (authOrErr instanceof NextResponse) return authOrErr;
  if (authOrErr.type === "user" && authOrErr.permissions.accessSection !== "edit") {
    return NextResponse.json({ error: "Немає права редагувати користувачів" }, { status: 403 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "ID користувача обовʼязковий" }, { status: 400 });
  }

  let body: {
    name?: string;
    phone?: string;
    functionId?: string;
    password?: string;
    isActive?: boolean;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Невалідний JSON" }, { status: 400 });
  }

  const existing = await prisma.appUser.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Користувача не знайдено" }, { status: 404 });
  }

  const data: {
    name?: string;
    phone?: string | null;
    functionId?: string | null;
    passwordHash?: string;
    isActive?: boolean;
  } = {};

  if (body.name !== undefined) data.name = String(body.name).trim() || existing.name;
  if (body.phone !== undefined) data.phone = body.phone ? String(body.phone).trim() || null : null;
  if (body.functionId !== undefined) data.functionId = body.functionId ? String(body.functionId).trim() || null : null;
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

  if (body.password !== undefined && String(body.password).length > 0) {
    const password = String(body.password);
    if (password.length < 4) {
      return NextResponse.json({ error: "Пароль має бути щонайменше 4 символи" }, { status: 400 });
    }
    data.passwordHash = await hashPassword(password);
  }

  const user = await prisma.appUser.update({
    where: { id },
    data,
    include: { function: { select: { id: true, name: true } } },
  });

  return NextResponse.json({
    id: user.id,
    name: user.name,
    login: user.login,
    phone: user.phone ?? null,
    functionId: user.functionId,
    functionName: user.function?.name ?? null,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
  });
}

export async function DELETE(req: Request, { params }: Params) {
  const authOrErr = await requireAccessSection(req);
  if (authOrErr instanceof NextResponse) return authOrErr;
  if (authOrErr.type === "user" && authOrErr.permissions.accessSection !== "edit") {
    return NextResponse.json({ error: "Немає права видаляти користувачів" }, { status: 403 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "ID користувача обовʼязковий" }, { status: 400 });
  }

  const existing = await prisma.appUser.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Користувача не знайдено" }, { status: 404 });
  }

  await prisma.appUser.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

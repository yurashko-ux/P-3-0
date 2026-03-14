// web/app/api/admin/access/functions/[id]/route.ts
// Отримання та оновлення функції (permissions)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAccessSection } from "../../require-access";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authOrErr = await requireAccessSection(req);
  if (authOrErr instanceof NextResponse) return authOrErr;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "ID обовʼязковий" }, { status: 400 });

  const fn = await prisma.function.findUnique({ where: { id } });
  if (!fn) return NextResponse.json({ error: "Функцію не знайдено" }, { status: 404 });

  return NextResponse.json({
    id: fn.id,
    name: fn.name,
    permissions: fn.permissions as Record<string, string>,
    createdAt: fn.createdAt.toISOString(),
    updatedAt: fn.updatedAt.toISOString(),
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authOrErr = await requireAccessSection(req);
  if (authOrErr instanceof NextResponse) return authOrErr;
  if (authOrErr.type === "user" && authOrErr.permissions.accessSection !== "edit") {
    return NextResponse.json({ error: "Немає права редагувати функції" }, { status: 403 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "ID обовʼязковий" }, { status: 400 });

  let body: { name?: string; permissions?: Record<string, string> } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Невалідний JSON" }, { status: 400 });
  }

  const data: { name?: string; permissions?: object } = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (body.permissions && typeof body.permissions === "object") {
    data.permissions = body.permissions;
  }

  const fn = await prisma.function.update({
    where: { id },
    data,
  });

  return NextResponse.json({
    ok: true,
    function: {
      id: fn.id,
      name: fn.name,
      permissions: fn.permissions,
      updatedAt: fn.updatedAt.toISOString(),
    },
  });
}

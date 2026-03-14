// web/app/api/admin/access/functions/route.ts
// CRUD функцій (посад)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAccessSection } from "../require-access";
import { DEFAULT_PERMISSIONS } from "@/lib/permissions-default";

export async function GET(req: Request) {
  const authOrErr = await requireAccessSection(req);
  if (authOrErr instanceof NextResponse) return authOrErr;

  const functions = await prisma.function.findMany({
    orderBy: { name: "asc" },
  });

  return NextResponse.json(
    functions.map((f) => ({
      id: f.id,
      name: f.name,
      permissions: f.permissions as object,
      createdAt: f.createdAt.toISOString(),
    }))
  );
}

export async function POST(req: Request) {
  const authOrErr = await requireAccessSection(req);
  if (authOrErr instanceof NextResponse) return authOrErr;
  if (authOrErr.type === "user" && authOrErr.permissions.accessSection !== "edit") {
    return NextResponse.json({ error: "Немає права створювати функції" }, { status: 403 });
  }

  let body: { name?: string; permissions?: Record<string, string> } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Невалідний JSON" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Назва посади обовʼязкова" }, { status: 400 });
  }

  const permissions =
    body.permissions && typeof body.permissions === "object"
      ? { ...DEFAULT_PERMISSIONS, ...body.permissions }
      : { ...DEFAULT_PERMISSIONS };

  const fn = await prisma.function.create({
    data: {
      name,
      permissions: permissions as object,
    },
  });

  return NextResponse.json({
    ok: true,
    function: {
      id: fn.id,
      name: fn.name,
      permissions: fn.permissions,
      createdAt: fn.createdAt.toISOString(),
    },
  });
}

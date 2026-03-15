// web/app/api/admin/access/users/[id]/reset-password/route.ts
// Генерація нового пароля для користувача (для копіювання посилання+логін+пароль)

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth-rbac";
import { requireAccessSection } from "../../../require-access";
import { randomBytes } from "crypto";

type Params = { params: Promise<{ id: string }> };

/** Генерує випадковий пароль (букви + цифри, 12 символів). */
function generatePassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  let s = "";
  for (let i = 0; i < 12; i++) s += chars[bytes[i]! % chars.length];
  return s;
}

export async function POST(_req: Request, { params }: Params) {
  const authOrErr = await requireAccessSection(_req);
  if (authOrErr instanceof NextResponse) return authOrErr;
  if (authOrErr.type === "user" && authOrErr.permissions.accessSection !== "edit") {
    return NextResponse.json({ error: "Немає права змінювати паролі" }, { status: 403 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "ID користувача обовʼязковий" }, { status: 400 });
  }

  const existing = await prisma.appUser.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Користувача не знайдено" }, { status: 404 });
  }

  const newPassword = generatePassword();
  const passwordHash = await hashPassword(newPassword);

  await prisma.appUser.update({
    where: { id },
    data: { passwordHash },
  });

  return NextResponse.json({ password: newPassword });
}

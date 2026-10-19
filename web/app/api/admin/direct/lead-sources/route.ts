// Розділ «Ліди»: джерела, знаки і статистика за місяць першого контакту.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { getTodayKyiv } from "@/lib/direct-stats-config";
import { ensureLeadSources, leadSourceHasAnyLead, leadSourceStats, type LeadSourceKind } from "@/lib/lead-sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function allowed(req: NextRequest, needEdit: boolean): Promise<boolean> {
  const host = req.headers.get("host") || "";
  if (isPreviewDeploymentHost(host)) return true;
  const auth = await getAuthContext(req);
  if (!auth) return false;
  if (auth.type === "superadmin") return true;
  // Джерела лідів — окреме право; fallback на Статистику для старих посад без нового ключа.
  const level = auth.permissions.leadsSourcesSection || auth.permissions.statsSection;
  if (needEdit) return level === "edit";
  return level === "edit" || level === "view";
}

function monthKey(req: NextRequest): string {
  const raw = (req.nextUrl.searchParams.get("month") || "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  return getTodayKyiv().slice(0, 7);
}

function cleanName(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

function cleanMark(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const mark = value.trim().slice(0, 8);
  return mark || null;
}

function cleanKind(value: unknown): LeadSourceKind | null {
  if (value === "ads" || value === "organic" || value === "website") return value;
  return null;
}

export async function GET(req: NextRequest) {
  if (!(await allowed(req, false))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const month = monthKey(req);
  const sources = await leadSourceStats(month);
  return NextResponse.json({ ok: true, month, sources });
}

export async function POST(req: NextRequest) {
  if (!(await allowed(req, true))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { name?: unknown; mark?: unknown; kind?: unknown } | null;
  const name = cleanName(body?.name);
  const kind = cleanKind(body?.kind);
  const mark = kind === "ads" ? cleanMark(body?.mark) : null;
  if (!name || !kind) {
    return NextResponse.json({ ok: false, error: "Потрібні назва і тип" }, { status: 400 });
  }
  if (kind === "ads" && !mark) {
    return NextResponse.json({ ok: false, error: "Для реклами потрібен знак" }, { status: 400 });
  }
  const sources = await ensureLeadSources();
  if (kind === "organic" && sources.some((source) => source.kind === "organic")) {
    return NextResponse.json({ ok: false, error: "Органіка вже є" }, { status: 400 });
  }
  if (mark && sources.some((source) => source.mark === mark)) {
    return NextResponse.json({ ok: false, error: "Такий знак уже є" }, { status: 400 });
  }
  const code = `src_${Date.now().toString(36)}`;
  const sortOrder = Math.max(0, ...sources.map((source) => source.sortOrder)) + 10;
  const created = await prisma.leadSource.create({
    data: { code, name, mark, kind, sortOrder },
  });
  console.log("[leads] Додано джерело", { code: created.code, kind, mark });
  return NextResponse.json({ ok: true, id: created.id });
}

export async function PATCH(req: NextRequest) {
  if (!(await allowed(req, true))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as {
    id?: unknown;
    name?: unknown;
    mark?: unknown;
    kind?: unknown;
    enabled?: unknown;
  } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const current = id ? await prisma.leadSource.findUnique({ where: { id } }) : null;
  if (!current) return NextResponse.json({ ok: false, error: "Джерело не знайдено" }, { status: 404 });
  if (current.kind !== "organic" && (await leadSourceHasAnyLead(current.code))) {
    return NextResponse.json(
      { ok: false, error: "У цього джерела вже є ліди — редагування заборонено, щоб не зіпсувати статистику" },
      { status: 400 },
    );
  }
  const name = cleanName(body?.name) || current.name;
  const kind = cleanKind(body?.kind) || (current.kind as LeadSourceKind);
  const mark = kind === "ads" ? cleanMark(body?.mark) : null;
  if (kind === "ads" && !mark) {
    return NextResponse.json({ ok: false, error: "Для реклами потрібен знак" }, { status: 400 });
  }
  const sources = await ensureLeadSources();
  if (kind === "organic" && sources.some((source) => source.kind === "organic" && source.id !== id)) {
    return NextResponse.json({ ok: false, error: "Органіка вже є" }, { status: 400 });
  }
  if (mark && sources.some((source) => source.mark === mark && source.id !== id)) {
    return NextResponse.json({ ok: false, error: "Такий знак уже є" }, { status: 400 });
  }
  await prisma.leadSource.update({
    where: { id },
    data: {
      name,
      kind,
      mark,
      enabled: typeof body?.enabled === "boolean" ? body.enabled : current.enabled,
    },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!(await allowed(req, true))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const id = (req.nextUrl.searchParams.get("id") || "").trim();
  const current = id ? await prisma.leadSource.findUnique({ where: { id } }) : null;
  if (!current) return NextResponse.json({ ok: false, error: "Джерело не знайдено" }, { status: 404 });
  if (current.kind === "organic") {
    return NextResponse.json({ ok: false, error: "Органіку не видаляємо: це джерело без знака" }, { status: 400 });
  }
  if (await leadSourceHasAnyLead(current.code)) {
    return NextResponse.json(
      { ok: false, error: "У цього джерела вже є ліди — видалення заборонено, щоб не загубити статистику" },
      { status: 400 },
    );
  }
  await prisma.leadSource.delete({ where: { id } });
  console.log("[leads] Видалено джерело", { code: current.code });
  return NextResponse.json({ ok: true });
}

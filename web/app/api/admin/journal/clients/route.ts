import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireJournalSection } from "@/lib/journal/require-journal-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireJournalSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    const q = String(req.nextUrl.searchParams.get("q") || "").trim();
    if (q.length < 1) return NextResponse.json({ ok: true, clients: [] });
    const clients = await prisma.directClient.findMany({
      where: {
        altegioClientId: { not: null },
        OR: [
          { instagramUsername: { contains: q, mode: "insensitive" } },
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        instagramUsername: true,
        altegioClientId: true,
        phone: true,
        spent: true,
        visits: true,
        lastVisitAt: true,
      },
      take: 20,
      orderBy: { lastActivityAt: "desc" },
    });
    return NextResponse.json({ ok: true, clients });
  } catch (err) {
    console.error("[api/admin/journal/clients] GET error:", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Помилка пошуку" }, { status: 500 });
  }
}

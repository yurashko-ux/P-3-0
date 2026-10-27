import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyUserToken } from "@/lib/auth-rbac";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { requireTeamSection } from "@/lib/team/require-team-auth";
import { decodeDataImage, readTeamMemberAvatar, saveTeamMemberAvatar } from "@/lib/team/avatar";

export const dynamic = "force-dynamic";

const ADMIN_PASS = process.env.ADMIN_PASS || "";

function canViewAvatar(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get("host") || "")) return true;
  const adminToken = req.cookies.get("admin_token")?.value || "";
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (verifyUserToken(adminToken)) return true;
  return !ADMIN_PASS;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!canViewAvatar(req)) {
    return NextResponse.json({ ok: false, error: "Не авторизовано" }, { status: 401 });
  }
  try {
    const dataUrl = await readTeamMemberAvatar(params.id);
    const decoded = dataUrl ? decodeDataImage(dataUrl) : null;
    if (!decoded) {
      return NextResponse.json({ ok: false, error: "Фото немає" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(decoded.bytes), {
      status: 200,
      headers: {
        "Content-Type": decoded.mime,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    console.error("[api/admin/team/members/:id/avatar] GET error:", err);
    return NextResponse.json({ ok: false, error: "Не вдалось прочитати фото" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireTeamSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const member = await prisma.teamMember.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!member) {
      return NextResponse.json({ ok: false, error: "Співробітника не знайдено" }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));
    await saveTeamMemberAvatar(params.id, String(body.image || ""));
    return NextResponse.json({
      ok: true,
      photoUrl: `/api/admin/team/members/${params.id}/avatar`,
    });
  } catch (err) {
    console.error("[api/admin/team/members/:id/avatar] POST error:", err);
    const message = err instanceof Error ? err.message : "Не вдалось зберегти фото";
    const status = /зображення|завелике|не знайдено/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

// Віддає збережене голосове, фото або відео з історії Direct. Байти в список повідомлень не кладемо.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isPreviewDeploymentHost } from "@/lib/auth-preview";
import { verifyUserToken } from "@/lib/auth-rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ADMIN_PASS = process.env.ADMIN_PASS || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

function isAuthorized(req: NextRequest): boolean {
  if (isPreviewDeploymentHost(req.headers.get("host") || "")) return true;
  const adminToken = req.cookies.get("admin_token")?.value || "";
  if (ADMIN_PASS && adminToken === ADMIN_PASS) return true;
  if (verifyUserToken(adminToken)) return true;
  if (CRON_SECRET) {
    const authHeader = req.headers.get("authorization");
    if (authHeader === `Bearer ${CRON_SECRET}`) return true;
    const secret = req.nextUrl.searchParams.get("secret");
    if (secret === CRON_SECRET) return true;
  }
  if (!ADMIN_PASS && !CRON_SECRET) return true;
  return false;
}

function fileExtension(mime: string, kind: string): string {
  const known: Record<string, string> = {
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/aac": "aac",
    "audio/wav": "wav",
    "audio/webm": "weba",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
  };
  if (known[mime]) return known[mime];
  if (kind === "audio") return "m4a";
  if (kind === "image") return "jpg";
  if (kind === "video") return "mp4";
  return "bin";
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const id = (req.nextUrl.searchParams.get("id") || "").trim();
  if (!id) {
    return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  }

  const row = await prisma.directMessageMedia.findUnique({
    where: { id },
    select: { bytes: true, mime: true, kind: true, byteSize: true },
  });
  if (!row) {
    return NextResponse.json({ ok: false, error: "Немає файлу" }, { status: 404 });
  }

  const body = Buffer.from(row.bytes);
  const size = body.length;
  const mime = row.mime || "application/octet-stream";
  const filename = `${row.kind}.${fileExtension(mime, row.kind)}`;
  // Відповідь функції на Vercel не більша за ~4.5 МБ, тому довге відео віддаємо шматками.
  const CHUNK = 2 * 1024 * 1024;
  const range = req.headers.get("range");
  const shared = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "Content-Disposition": `inline; filename="${filename}"`,
    "Cache-Control": "private, max-age=3600",
  };

  const match = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
  let start = 0;
  let end = size - 1;
  if (match) {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isFinite(start) || start < 0 || start >= size || end < start) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
  }
  if (end - start + 1 > CHUNK) end = start + CHUNK - 1;
  const slice = body.subarray(start, end + 1);
  const partial = Boolean(match) || end < size - 1;
  return new NextResponse(new Uint8Array(slice), {
    status: partial ? 206 : 200,
    headers: {
      ...shared,
      ...(partial ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
      "Content-Length": String(slice.length),
    },
  });
}

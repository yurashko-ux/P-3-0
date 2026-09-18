import { NextRequest, NextResponse } from "next/server";
import {
  createOnlineBooking,
  listAvailableSlots,
  listBookableDays,
  listBookableMasters,
  listBookableServices,
} from "@/lib/booking/online";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Простий rate-limit в памʼяті процесу (антиспам публічного API). */
const hits = new Map<string, { n: number; resetAt: number }>();

function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const row = hits.get(key);
  if (!row || row.resetAt < now) {
    hits.set(key, { n: 1, resetAt: now + windowMs });
    return true;
  }
  if (row.n >= limit) return false;
  row.n += 1;
  return true;
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function GET(req: NextRequest) {
  try {
    const ip = clientIp(req);
    if (!rateLimit(`book:get:${ip}`, 60, 60_000)) {
      return NextResponse.json({ ok: false, error: "Забагато запитів" }, { status: 429 });
    }

    const url = req.nextUrl;
    const day = url.searchParams.get("day");
    const staffId = url.searchParams.get("staffId");
    const serviceId = url.searchParams.get("serviceId");

    if (day && staffId) {
      let durationSec = 3600;
      if (serviceId) {
        const services = await listBookableServices();
        const svc = services.find((s) => s.id === serviceId);
        if (svc) durationSec = svc.durationSec || 3600;
      }
      const slots = await listAvailableSlots({
        day,
        staffId: Number(staffId),
        durationSec,
      });
      return NextResponse.json({ ok: true, day, staffId: Number(staffId), slots });
    }

    const [masters, services, days] = await Promise.all([
      listBookableMasters(),
      listBookableServices(),
      Promise.resolve(listBookableDays()),
    ]);
    return NextResponse.json({
      ok: true,
      masters,
      services,
      days,
      hours: { start: 9, end: 20 },
    });
  } catch (err) {
    console.error("[api/book] GET error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Помилка" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    if (!rateLimit(`book:post:${ip}`, 8, 60_000)) {
      return NextResponse.json({ ok: false, error: "Забагато запитів — спробуйте пізніше" }, { status: 429 });
    }

    const body = await req.json().catch(() => ({}));
    // Honeypot: боти заповнюють приховане поле
    if (body.website || body.company || body.fax) {
      console.warn("[api/book] honeypot спрацював", { ip });
      return NextResponse.json({ ok: true, appointment: { id: "ok" } });
    }

    const appointment = await createOnlineBooking({
      name: String(body.name || ""),
      phone: String(body.phone || ""),
      serviceId: String(body.serviceId || ""),
      staffId: body.staffId,
      day: String(body.day || ""),
      time: String(body.time || ""),
      comment: typeof body.comment === "string" ? body.comment : null,
    });

    return NextResponse.json({
      ok: true,
      appointment: {
        id: appointment.id,
        datetime: appointment.datetime,
        staffName: appointment.staffName,
        clientName: appointment.clientName,
        status: appointment.status,
        altegioRecordId: appointment.altegioRecordId,
        lines: appointment.lines,
      },
    });
  } catch (err) {
    console.error("[api/book] POST error:", err);
    const message = err instanceof Error ? err.message : "Не вдалося записатись";
    const status = /вкажіть|оберіть|телефон|зайнят|не знайден|некоректн|формат/i.test(message)
      ? 400
      : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

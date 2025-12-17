// web/app/api/altegio/webhook/check-records/route.ts
// Endpoint для перевірки останніх record events з webhook
//
// Використання:
// GET https://p-3-0.vercel.app/api/altegio/webhook/check-records
// GET https://p-3-0.vercel.app/api/altegio/webhook/check-records?limit=50

import { NextRequest, NextResponse } from "next/server";
import { kvRead } from "@/lib/kv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = limitParam
      ? Math.min(Math.max(parseInt(limitParam, 10) || 20, 1), 100)
      : 20;

    // Отримуємо останні webhook події
    const webhookLogRaw = await kvRead.lrange("altegio:webhook:log", 0, limit - 1);
    const webhookEvents = webhookLogRaw
      .map((raw) => {
        try {
          const parsed = JSON.parse(raw);
          if (
            parsed &&
            typeof parsed === "object" &&
            "value" in parsed &&
            typeof parsed.value === "string"
          ) {
            try {
              return JSON.parse(parsed.value);
            } catch {
              return parsed;
            }
          }
          return parsed;
        } catch {
          return { raw };
        }
      })
      .filter(Boolean);

    // Отримуємо record events з webhook log
    const recordEvents = webhookEvents
      .filter((e: any) => e.body?.resource === "record")
      .map((e: any) => ({
        receivedAt: e.receivedAt,
        status: e.body?.status, // 'create', 'update', 'delete'
        visitId: e.body?.resource_id,
        datetime: e.body?.data?.datetime,
        serviceId: e.body?.data?.service?.id || e.body?.data?.service_id,
        serviceName:
          e.body?.data?.service?.title ||
          e.body?.data?.service?.name ||
          "Невідома послуга",
        staffId: e.body?.data?.staff?.id || e.body?.data?.staff_id,
        staffName:
          e.body?.data?.staff?.name ||
          e.body?.data?.staff?.display_name ||
          "Невідомий майстер",
        clientId: e.body?.data?.client?.id,
        clientName:
          e.body?.data?.client?.display_name ||
          e.body?.data?.client?.name ||
          "Невідомий клієнт",
        fullBody: e.body,
      }));

    // Отримуємо record events з records log (які ми зберігаємо для статистики)
    const recordsLogRaw = await kvRead.lrange("altegio:records:log", 0, limit - 1);
    const savedRecords = recordsLogRaw
      .map((raw) => {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })
      .filter((r) => r && r.visitId && r.datetime);

    // Знаходимо останній record event
    const lastRecordEvent =
      recordEvents.length > 0
        ? recordEvents[0]
        : savedRecords.length > 0
          ? {
              visitId: savedRecords[0].visitId,
              datetime: savedRecords[0].datetime,
              serviceId: savedRecords[0].serviceId,
              serviceName: savedRecords[0].serviceName,
              staffId: savedRecords[0].staffId,
              receivedAt: savedRecords[0].receivedAt,
              status: "saved",
            }
          : null;

    return NextResponse.json({
      ok: true,
      summary: {
        totalWebhookEvents: webhookEvents.length,
        recordEventsFromWebhook: recordEvents.length,
        savedRecords: savedRecords.length,
        lastRecordEvent: lastRecordEvent,
      },
      lastRecordEvents: recordEvents.slice(0, 10),
      savedRecords: savedRecords.slice(0, 10),
      allWebhookEvents: webhookEvents.slice(0, 5), // Перші 5 для діагностики
    });
  } catch (error) {
    console.error("[webhook/check-records] Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}


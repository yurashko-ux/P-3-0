// web/app/api/admin/direct/add-client/route.ts
// Endpoint для ручного додавання клієнта (+ dual-write в Altegio за телефоном)

import { NextRequest, NextResponse } from "next/server";
import {
  getDirectClientByAltegioId,
  getDirectClientByInstagram,
  saveDirectClient,
} from "@/lib/direct-store";
import { normalizeInstagram } from "@/lib/normalize";
import { normalizePhone } from "@/lib/binotel/normalize-phone";
import { ensureAltegioClientId } from "@/lib/altegio/clients-write";
import { prisma } from "@/lib/prisma";
import type { DirectClient } from "@/lib/direct-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function findDirectClientByPhone(phoneNorm: string): Promise<DirectClient | null> {
  if (!phoneNorm || phoneNorm.length < 9) return null;
  const { getDirectClient } = await import("@/lib/direct-store");
  const clients = await prisma.directClient.findMany({
    where: { phone: { not: null } },
    select: { id: true, phone: true },
    take: 8000,
  });
  const hit = clients.find((c) => c.phone && normalizePhone(c.phone) === phoneNorm);
  if (!hit) return null;
  return getDirectClient(hit.id);
}

/**
 * POST - додати клієнта вручну.
 * body.syncAltegio=true — знайти/створити клієнта в Altegio за телефоном (без дубля).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      instagramUsername,
      firstName,
      lastName,
      fullName,
      phone,
      source,
      syncAltegio = false,
      // Телефон без консультації/платного запису — не робити «клієнтом» у Direct
      keepAsLead = false,
    } = body;

    if (!instagramUsername) {
      return NextResponse.json(
        { ok: false, error: "Instagram username is required" },
        { status: 400 },
      );
    }

    const normalized = normalizeInstagram(instagramUsername);
    if (!normalized) {
      return NextResponse.json(
        { ok: false, error: "Invalid Instagram username format" },
        { status: 400 },
      );
    }

    let resolvedFirstName = typeof firstName === "string" ? firstName.trim() : "";
    let resolvedLastName = typeof lastName === "string" ? lastName.trim() : "";
    // ПІБ у формі: «Прізвище Імʼя [По батькові]»
    if ((!resolvedFirstName || !resolvedLastName) && typeof fullName === "string" && fullName.trim()) {
      const parts = fullName.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 1) {
        resolvedFirstName = resolvedFirstName || parts[0];
      } else if (parts.length > 1) {
        resolvedLastName = resolvedLastName || parts[0];
        resolvedFirstName = resolvedFirstName || parts.slice(1).join(" ");
      }
    }

    const phoneRaw = typeof phone === "string" ? phone.trim() : "";
    const phoneNorm = phoneRaw ? normalizePhone(phoneRaw) : "";
    const wantAltegio = Boolean(syncAltegio);

    if (wantAltegio) {
      if (!phoneNorm || phoneNorm.length < 10) {
        return NextResponse.json(
          { ok: false, error: "Для експорту в Altegio вкажіть коректний номер телефону" },
          { status: 400 },
        );
      }
    }

    // Altegio: name = імʼя, surname = прізвище → передаємо «Імʼя Прізвище»
    const altegioDisplayName =
      [resolvedFirstName, resolvedLastName].filter(Boolean).join(" ").trim() ||
      normalized;

    let altegioClientId: number | null = null;
    let altegioCreated: boolean | null = null;
    if (wantAltegio && phoneNorm) {
      try {
        const ensured = await ensureAltegioClientId({
          name: altegioDisplayName,
          phone: phoneNorm,
          comment: "створено з журналу Kresco",
        });
        altegioClientId = ensured.altegioClientId;
        altegioCreated = ensured.created;
      } catch (err) {
        console.error("[add-client] Altegio ensure failed:", err);
        return NextResponse.json(
          {
            ok: false,
            error:
              err instanceof Error
                ? `Altegio: ${err.message}`
                : "Не вдалося створити/знайти клієнта в Altegio",
          },
          { status: 502 },
        );
      }
    }

    // 1) За Instagram
    let client = await getDirectClientByInstagram(normalized);

    // 2) За Altegio id
    if (!client && altegioClientId) {
      client = await getDirectClientByAltegioId(altegioClientId);
    }

    // 3) За телефоном у Direct
    if (!client && phoneNorm) {
      client = await findDirectClientByPhone(phoneNorm);
    }

    const now = new Date().toISOString();

    if (!client) {
      // keepAsLead / немає консультації: Altegio-картка може бути, але в Direct лишається лід
      const asLead = Boolean(keepAsLead) || !altegioClientId;
      client = {
        id: `direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        instagramUsername: normalized,
        firstName: resolvedFirstName || undefined,
        lastName: resolvedLastName || undefined,
        ...(phoneNorm ? { phone: phoneNorm } : {}),
        ...(altegioClientId ? { altegioClientId } : {}),
        source: (source as "instagram" | "tiktok" | "other") || "instagram",
        state: (asLead ? "message" : "client") as DirectClient["state"],
        firstContactDate: now,
        statusId: asLead ? "lead" : "client",
        visitedSalon: false,
        signedUpForPaidService: false,
        createdAt: now,
        updatedAt: now,
      };
      await saveDirectClient(client, "add-client", { source: "admin" }, { touchUpdatedAt: false });

      return NextResponse.json({
        ok: true,
        message: altegioClientId
          ? altegioCreated
            ? asLead
              ? "Ліда створено в Kresco і в Altegio (статус клієнта — після консультації)"
              : "Клієнта створено в Kresco і в Altegio"
            : asLead
              ? "Ліда створено; в Altegio знайдено за телефоном"
              : "Клієнта створено в Kresco; в Altegio знайдено за телефоном"
          : "Клієнт створено",
        client,
        created: true,
        altegio: altegioClientId
          ? { clientId: altegioClientId, created: Boolean(altegioCreated) }
          : null,
      });
    }

    // Не промоутити ліда в клієнта лише через телефон/Altegio id
    const keepLeadOnUpdate =
      Boolean(keepAsLead) &&
      client.statusId !== "client" &&
      !client.consultationBookingDate &&
      !client.paidServiceDate;

    const updated: DirectClient = {
      ...client,
      ...(resolvedFirstName ? { firstName: resolvedFirstName } : {}),
      ...(resolvedLastName ? { lastName: resolvedLastName } : {}),
      ...(phoneNorm ? { phone: phoneNorm } : {}),
      ...(normalized && (!client.instagramUsername || client.instagramUsername !== normalized)
        ? { instagramUsername: normalized }
        : {}),
      ...(altegioClientId && !(client.altegioClientId && client.altegioClientId > 0)
        ? { altegioClientId }
        : {}),
      ...(keepLeadOnUpdate
        ? { statusId: "lead" as const, state: (client.state === "client" ? "message" : client.state) }
        : {}),
    };
    // Якщо вже був altegioClientId — не перетираємо іншим id
    if (
      altegioClientId &&
      client.altegioClientId &&
      client.altegioClientId > 0 &&
      client.altegioClientId !== altegioClientId
    ) {
      console.warn("[add-client] Direct уже привʼязаний до іншого Altegio id", {
        directId: client.id,
        existing: client.altegioClientId,
        found: altegioClientId,
      });
    }

    await saveDirectClient(updated, "add-client", { source: "admin" }, { touchUpdatedAt: false });

    return NextResponse.json({
      ok: true,
      message: altegioClientId
        ? altegioCreated
          ? "Клієнта оновлено; створено картку в Altegio"
          : "Клієнта оновлено; привʼязано до існуючого в Altegio за телефоном"
        : "Клієнт оновлено",
      client: updated,
      created: false,
      altegio: altegioClientId
        ? {
            clientId:
              client.altegioClientId && client.altegioClientId > 0
                ? client.altegioClientId
                : altegioClientId,
            created: Boolean(altegioCreated),
          }
        : null,
    });
  } catch (err) {
    console.error("[add-client] Error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

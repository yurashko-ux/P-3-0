import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseDateOnlyToUtc(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseHryvniaToKopiykas(value: string): bigint | null {
  const normalized = value.replace(/\s+/g, "").replace(",", ".").trim();
  if (!normalized) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null;

  const sign = normalized.startsWith("-") ? -1n : 1n;
  const unsigned = normalized.replace("-", "");
  const [wholePart, fractionPart = ""] = unsigned.split(".");
  const whole = BigInt(wholePart || "0");
  const fraction = BigInt((fractionPart + "00").slice(0, 2));
  return sign * (whole * 100n + fraction);
}

export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const bankAccountId = typeof body.bankAccountId === "string" ? body.bankAccountId.trim() : "";
    const openingBalanceValue =
      typeof body.openingBalance === "string" ? body.openingBalance.trim() : "";
    const openingBalanceDateValue =
      typeof body.openingBalanceDate === "string" ? body.openingBalanceDate.trim() : "";

    if (!bankAccountId) {
      return NextResponse.json(
        { ok: false, error: "bankAccountId is required" },
        { status: 400 },
      );
    }

    const shouldClear = !openingBalanceValue && !openingBalanceDateValue;
    if (!shouldClear && (!openingBalanceValue || !openingBalanceDateValue)) {
      return NextResponse.json(
        { ok: false, error: "Потрібно вказати і суму, і дату початкового балансу" },
        { status: 400 },
      );
    }

    const openingBalanceKopiykas = shouldClear
      ? null
      : parseHryvniaToKopiykas(openingBalanceValue);
    const openingBalanceDate = shouldClear
      ? null
      : parseDateOnlyToUtc(openingBalanceDateValue);

    if (!shouldClear && openingBalanceKopiykas == null) {
      return NextResponse.json(
        { ok: false, error: "Невірний формат суми. Приклад: 15000 або 15000.50" },
        { status: 400 },
      );
    }

    if (!shouldClear && openingBalanceDate == null) {
      return NextResponse.json(
        { ok: false, error: "Невірний формат дати. Очікується YYYY-MM-DD" },
        { status: 400 },
      );
    }

    const updated = await prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: {
        altegioOpeningBalanceManual: openingBalanceKopiykas,
        altegioOpeningBalanceDate: openingBalanceDate,
        altegioOpeningBalanceUpdatedAt: shouldClear ? null : new Date(),
      },
      select: {
        id: true,
        altegioOpeningBalanceManual: true,
        altegioOpeningBalanceDate: true,
        altegioOpeningBalanceUpdatedAt: true,
      },
    });

    console.log("[admin/altegio/bank-accounts-opening-balance] Збережено ручний початковий баланс:", {
      bankAccountId,
      altegioOpeningBalanceManual: updated.altegioOpeningBalanceManual?.toString() ?? null,
      altegioOpeningBalanceDate: updated.altegioOpeningBalanceDate?.toISOString() ?? null,
      altegioOpeningBalanceUpdatedAt:
        updated.altegioOpeningBalanceUpdatedAt?.toISOString() ?? null,
      cleared: shouldClear,
    });

    return NextResponse.json({
      ok: true,
      bankAccountId: updated.id,
      saved: {
        altegioOpeningBalanceManual: updated.altegioOpeningBalanceManual?.toString() ?? null,
        altegioOpeningBalanceDate: updated.altegioOpeningBalanceDate?.toISOString() ?? null,
        altegioOpeningBalanceUpdatedAt:
          updated.altegioOpeningBalanceUpdatedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error("[admin/altegio/bank-accounts-opening-balance] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

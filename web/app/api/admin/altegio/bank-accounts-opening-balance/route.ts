import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isMissingOpeningBalanceColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("altegioOpeningBalanceManual") ||
    message.includes("altegioOpeningBalanceDate") ||
    message.includes("altegioOpeningBalanceUpdatedAt") ||
    message.includes("altegioMonthlyTurnoverManual") ||
    message.includes("fopAnnualTurnoverLimitKop")
  );
}

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
    const monthlyTurnoverValue =
      typeof body.monthlyTurnover === "string" ? body.monthlyTurnover.trim() : "";
    const fopAnnualLimitValue =
      typeof body.fopAnnualLimitGross === "string" ? body.fopAnnualLimitGross.trim() : "";

    if (!bankAccountId) {
      return NextResponse.json(
        { ok: false, error: "bankAccountId is required" },
        { status: 400 },
      );
    }

    const shouldClear =
      !openingBalanceValue && !openingBalanceDateValue && !monthlyTurnoverValue && !fopAnnualLimitValue;

    const hasTurnoverExtras = Boolean(monthlyTurnoverValue || fopAnnualLimitValue);
    if (!shouldClear && (!openingBalanceValue || !openingBalanceDateValue)) {
      if (hasTurnoverExtras) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Щоб зберегти оборот місяця або річний ліміт, спочатку вкажіть дату та залишок Altegio (точку відліку).",
          },
          { status: 400 },
        );
      }
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

    const monthlyTurnoverKop = shouldClear
      ? null
      : monthlyTurnoverValue
        ? parseHryvniaToKopiykas(monthlyTurnoverValue)
        : null;
    if (!shouldClear && monthlyTurnoverValue && monthlyTurnoverKop == null) {
      return NextResponse.json(
        { ok: false, error: "Невірний формат обороту місяця (грн)" },
        { status: 400 },
      );
    }

    const annualLimitKop = shouldClear
      ? null
      : fopAnnualLimitValue
        ? parseHryvniaToKopiykas(fopAnnualLimitValue)
        : null;
    if (!shouldClear && fopAnnualLimitValue && annualLimitKop == null) {
      return NextResponse.json(
        { ok: false, error: "Невірний формат річного ліміту (грн)" },
        { status: 400 },
      );
    }

    const updated = await prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: {
        altegioOpeningBalanceManual: openingBalanceKopiykas,
        altegioOpeningBalanceDate: openingBalanceDate,
        altegioOpeningBalanceUpdatedAt: shouldClear ? null : new Date(),
        altegioMonthlyTurnoverManual: shouldClear ? null : monthlyTurnoverKop,
        fopAnnualTurnoverLimitKop: shouldClear ? null : annualLimitKop,
      },
      select: {
        id: true,
        altegioOpeningBalanceManual: true,
        altegioOpeningBalanceDate: true,
        altegioOpeningBalanceUpdatedAt: true,
        altegioMonthlyTurnoverManual: true,
        fopAnnualTurnoverLimitKop: true,
      },
    });

    console.log("[admin/altegio/bank-accounts-opening-balance] Збережено точку відліку / оборот ФОП:", {
      bankAccountId,
      altegioOpeningBalanceManual: updated.altegioOpeningBalanceManual?.toString() ?? null,
      altegioOpeningBalanceDate: updated.altegioOpeningBalanceDate?.toISOString() ?? null,
      altegioOpeningBalanceUpdatedAt:
        updated.altegioOpeningBalanceUpdatedAt?.toISOString() ?? null,
      altegioMonthlyTurnoverManual: updated.altegioMonthlyTurnoverManual?.toString() ?? null,
      fopAnnualTurnoverLimitKop: updated.fopAnnualTurnoverLimitKop?.toString() ?? null,
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
        altegioMonthlyTurnoverManual: updated.altegioMonthlyTurnoverManual?.toString() ?? null,
        fopAnnualTurnoverLimitKop: updated.fopAnnualTurnoverLimitKop?.toString() ?? null,
      },
    });
  } catch (error) {
    if (isMissingOpeningBalanceColumnError(error)) {
      console.error(
        "[admin/altegio/bank-accounts-opening-balance] Колонки ручного початкового балансу ще не застосовані:",
        error,
      );
      return NextResponse.json(
        {
          ok: false,
          error:
            "Поля ручного початкового балансу ще недоступні в БД. Потрібен новий деплой або prisma migrate deploy.",
        },
        { status: 409 },
      );
    }

    console.error("[admin/altegio/bank-accounts-opening-balance] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

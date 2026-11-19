// Плитка «Борг» у Касі: борг постачальникам за прийомки в борг і оплати цього боргу.
// GET — розрахунки по постачальниках з історією; POST — ручна оплата (інкасація власниці);
// PATCH — вказати постачальника в оплаті «Закупівля товарів»; DELETE ?id= — скасувати ручну оплату.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFinanceDocsSection } from "@/lib/finance/require-finance-docs-auth";
import { isSupplierPaymentPurpose, loadSupplierDebts, normalizeSupplierName } from "@/lib/finance/supplier-debt";
import { getOrFixDailyFxRates } from "@/lib/fx/daily-rates";
import { kyivToday } from "@/lib/dashboard/period";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "view");
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ ok: true, ...(await loadSupplierDebts()) });
  } catch (error) {
    console.error("[finance/cash/supplier-debt] Помилка:", error);
    return NextResponse.json({ ok: false, error: "Не вдалося порахувати борг" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const supplierName = normalizeSupplierName(body.supplierName);
    const currency = String(body.currency || "USD").toUpperCase();
    const amount = Number(body.amount) || 0;
    const kyivDay = /^\d{4}-\d{2}-\d{2}$/.test(String(body.kyivDay || "")) ? String(body.kyivDay) : kyivToday();
    if (!supplierName) return NextResponse.json({ ok: false, error: "Вкажіть постачальника" }, { status: 400 });
    if (!["USD", "UAH", "EUR"].includes(currency)) {
      return NextResponse.json({ ok: false, error: "Валюта має бути USD, UAH або EUR" }, { status: 400 });
    }
    if (!(amount > 0)) return NextResponse.json({ ok: false, error: "Вкажіть суму оплати" }, { status: 400 });

    let amountUsd = amount;
    if (currency !== "USD") {
      // Курс дня оплати; для минулого дня без зафіксованого курсу — найближчий раніший.
      const fixed =
        (await getOrFixDailyFxRates(kyivDay).catch(() => null)) ||
        (await prisma.dailyFxRate.findFirst({ where: { kyivDay: { lte: kyivDay } }, orderBy: { kyivDay: "desc" } }));
      if (!fixed) return NextResponse.json({ ok: false, error: "Немає курсу на цей день" }, { status: 400 });
      const uah = currency === "UAH" ? amount : amount * fixed.eurWorking;
      amountUsd = uah / fixed.usdWorking;
    }

    const payment = await prisma.supplierPayment.create({
      data: {
        supplierName,
        currency,
        amount,
        amountUsd: Math.round(amountUsd * 100) / 100,
        kyivDay,
        comment: String(body.comment || "").trim() || null,
        createdBy: auth.type === "user" ? auth.login : "superadmin",
      },
    });
    console.log(`[finance/cash/supplier-debt] ✅ Оплата ${supplierName}: ${amount} ${currency} (${payment.amountUsd} $) за ${kyivDay}`);
    return NextResponse.json({ ok: true, payment });
  } catch (error) {
    console.error("[finance/cash/supplier-debt] Помилка запису оплати:", error);
    return NextResponse.json({ ok: false, error: "Не вдалося записати оплату" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json().catch(() => ({}));
    const id = String(body.financeDocumentId || "");
    const supplierName = normalizeSupplierName(body.supplierName);
    if (!id || !supplierName) return NextResponse.json({ ok: false, error: "Вкажіть постачальника" }, { status: 400 });
    const doc = await prisma.financeDocument.findUnique({ where: { id }, select: { type: true, purposeTitle: true } });
    if (!doc || doc.type !== "expense" || !isSupplierPaymentPurpose(doc.purposeTitle)) {
      return NextResponse.json({ ok: false, error: "Це не оплата «Закупівля товарів»" }, { status: 400 });
    }
    await prisma.financeDocument.update({ where: { id }, data: { supplierName } });
    console.log(`[finance/cash/supplier-debt] Оплата ${id}: постачальник «${supplierName}»`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[finance/cash/supplier-debt] Помилка PATCH:", error);
    return NextResponse.json({ ok: false, error: "Не вдалося вказати постачальника" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireFinanceDocsSection(req, "edit");
  if (auth instanceof NextResponse) return auth;
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!id) return NextResponse.json({ ok: false, error: "Не вказано оплату" }, { status: 400 });
  try {
    const result = await prisma.supplierPayment.updateMany({ where: { id, voidedAt: null }, data: { voidedAt: new Date() } });
    console.log(`[finance/cash/supplier-debt] Скасовано оплату ${id}: ${result.count}`);
    return NextResponse.json({ ok: true, voided: result.count });
  } catch (error) {
    console.error("[finance/cash/supplier-debt] Помилка скасування:", error);
    return NextResponse.json({ ok: false, error: "Не вдалося скасувати оплату" }, { status: 500 });
  }
}

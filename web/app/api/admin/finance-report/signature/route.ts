// API підписання фінансового звіту за період.

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { fetchExpensesSummary } from "@/lib/altegio";
import {
  buildFinanceReportSnapshot,
  readFinanceReportSignature,
  writeFinanceReportSignature,
  type FinanceReportSignature,
} from "@/lib/finance/report-signature";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get("secret");
  const envSecret = process.env.CRON_SECRET || "";
  return Boolean(envSecret && secret && envSecret === secret);
}

function formatDateISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthRange(year: number, month: number): { from: string; to: string } {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  return { from: formatDateISO(from), to: formatDateISO(to) };
}

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(String(value || "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isEncashmentPurposeLabel(value: unknown): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  return normalized.includes("інкасац") || normalized.includes("инкасац");
}

function calculateEncashmentFactAltegio(transactions: any[]): number {
  return transactions
    .filter((transaction) => {
      const purposeTitle =
        transaction?.expense?.title ||
        transaction?.expense?.name ||
        transaction?.expense?.category ||
        "";
      const comment = transaction?.comment || "";
      return isEncashmentPurposeLabel(purposeTitle) || isEncashmentPurposeLabel(comment);
    })
    .reduce((sum, transaction) => sum + Math.abs(toNumber(transaction?.amount)), 0);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const year = Number(body?.year);
    const month = Number(body?.month);
    const encashment = toNumber(body?.encashment);
    const encashmentFactFromPage = toNumber(body?.encashmentFactAltegio);

    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json({ error: "Invalid year or month" }, { status: 400 });
    }

    const existing = await readFinanceReportSignature(year, month);
    if (existing) {
      return NextResponse.json({
        success: true,
        alreadySigned: true,
        signature: existing,
      });
    }

    const diff = Math.round(encashment) - Math.round(encashmentFactFromPage);
    if (diff !== 0) {
      console.warn("[admin/finance-report/signature] Підписання заблоковано через різницю інкасації:", {
        year,
        month,
        encashment,
        encashmentFactFromPage,
        diff,
      });
      return NextResponse.json(
        { error: "Підписання доступне тільки коли Інкасація дорівнює Інкасація факт (Альтеджіо)." },
        { status: 400 },
      );
    }

    const { from, to } = monthRange(year, month);
    const expenses = await fetchExpensesSummary({ date_from: from, date_to: to });
    const liveFact = calculateEncashmentFactAltegio(expenses.transactions || []);

    if (Math.round(liveFact) !== Math.round(encashmentFactFromPage)) {
      console.warn("[admin/finance-report/signature] Факт Altegio змінився між рендером і підписом:", {
        year,
        month,
        encashmentFactFromPage,
        liveFact,
      });
      return NextResponse.json(
        { error: "Факт Altegio змінився. Оновіть звіт і спробуйте підписати ще раз." },
        { status: 409 },
      );
    }

    const signature: FinanceReportSignature = {
      version: 1,
      year,
      month,
      signedAt: new Date().toISOString(),
      encashment: Math.round(encashment),
      encashmentFactAltegio: Math.round(liveFact),
      transactions: buildFinanceReportSnapshot(expenses.transactions),
    };

    await writeFinanceReportSignature(signature);
    console.log("[admin/finance-report/signature] Звіт підписано:", {
      year,
      month,
      signedAt: signature.signedAt,
      transactions: signature.transactions.length,
      encashment: signature.encashment,
      encashmentFactAltegio: signature.encashmentFactAltegio,
    });

    revalidatePath("/admin/finance-report");

    return NextResponse.json({
      success: true,
      signature: {
        year,
        month,
        signedAt: signature.signedAt,
        transactionsCount: signature.transactions.length,
      },
    });
  } catch (error: any) {
    console.error("[admin/finance-report/signature] POST error:", error);
    return NextResponse.json(
      { error: String(error?.message || error) },
      { status: 500 },
    );
  }
}

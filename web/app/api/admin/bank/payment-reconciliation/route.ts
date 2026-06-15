import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { ALTEGIO_FINANCE_SYNC_START_DATE, normalizePaymentPurposeTitle } from "@/lib/altegio/finance-transactions-sync";
import { canonicalizeAltegioPaymentPurposeTitle } from "@/lib/altegio/payment-purpose-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function kyivDayUtcRange(ymd: string): { from: Date; to: Date } {
  const [year, month, day] = ymd.split("-").map(Number);
  const utcMidday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utcMidday);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 12);
  const offsetHours = hour - 12;
  const from = new Date(Date.UTC(year, month - 1, day, 0 - offsetHours, 0, 0, 0));
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { from, to };
}

function parseDate(value: string | null, fallback: string, boundary: "from" | "to"): Date {
  const raw = value || fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const range = kyivDayUtcRange(raw);
    return boundary === "from" ? range.from : range.to;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date(fallback) : parsed;
}

function serializeBigInt(value: unknown): string | null {
  return typeof value === "bigint" ? value.toString() : value == null ? null : String(value);
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  const from = parseDate(req.nextUrl.searchParams.get("from"), `${ALTEGIO_FINANCE_SYNC_START_DATE}T00:00:00.000Z`, "from");
  const to = parseDate(req.nextUrl.searchParams.get("to"), new Date().toISOString(), "to");
  const status = req.nextUrl.searchParams.get("status") || "all";
  const limit = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get("limit") || 300), 1000));

  const matchWhere = status === "all" ? {} : { status };
  const statements = await prisma.bankStatementItem.findMany({
    where: {
      time: { gte: from, lte: to },
      amount: { lt: BigInt(0) },
      account: { includeInOperationsTable: true },
      ...(status === "unmatched"
        ? { altegioPaymentMatch: null }
        : status === "all"
          ? {}
          : { altegioPaymentMatch: { is: matchWhere } }),
    },
    include: {
      account: {
        select: {
          id: true,
          altegioAccountId: true,
          altegioAccountTitle: true,
          maskedPan: true,
          iban: true,
        },
      },
      altegioPaymentMatch: {
        include: {
          altegioFinanceTransaction: true,
          pendingPayments: {
            select: {
              id: true,
              purposeTitle: true,
              status: true,
              note: true,
              createdFrom: true,
              createdBy: true,
              createdAt: true,
              updatedAt: true,
              purpose: {
                select: {
                  id: true,
                  title: true,
                },
              },
            },
            take: 1,
          },
        },
      },
    },
    orderBy: { time: "desc" },
    take: limit,
  });

  const rows = await Promise.all(statements.map(async (statement: any) => {
    const match = statement.altegioPaymentMatch;
    const altegio = match?.altegioFinanceTransaction ?? null;
    const amount = absBigInt(BigInt(statement.amount));
    const pendingPayment = match?.pendingPayments?.[0] ?? null;
    const isTransferPending = String(pendingPayment?.purposeTitle || "").trim().toLowerCase().startsWith("переміщення");
    const candidates = !altegio && statement.account.altegioAccountId
      ? await (prisma as any).altegioFinanceTransaction.findMany({
          where: {
            accountId: String(statement.account.altegioAccountId),
            direction: isTransferPending ? { in: ["out", "transfer"] } : "out",
            deletedInAltegio: false,
            operationDate: { gte: addDays(statement.time, -2), lte: addDays(statement.time, 2) },
            OR: [{ amountKopiykas: amount }, { amountKopiykas: -amount }],
            bankPaymentMatch: null,
          },
          orderBy: { operationDate: "desc" },
          take: 5,
        })
      : [];
    return {
      bank: {
        id: statement.id,
        externalId: statement.externalId,
        time: statement.time.toISOString(),
        description: statement.description,
        comment: statement.comment,
        counterName: statement.counterName,
        amount: serializeBigInt(statement.amount),
        hold: statement.hold,
        account: statement.account,
      },
      match: match
        ? {
            id: match.id,
            status: match.status,
            matchType: match.matchType,
            matchScore: match.matchScore,
            matchedAt: match.matchedAt?.toISOString?.() ?? null,
            matchedBy: match.matchedBy,
            reviewNote: match.reviewNote,
            conflictData: match.conflictData,
            telegramNotifiedAt: match.telegramNotifiedAt?.toISOString?.() ?? null,
            pendingPayment: pendingPayment
              ? {
                  id: pendingPayment.id,
                  purposeTitle: pendingPayment.purposeTitle,
                  status: pendingPayment.status,
                  note: pendingPayment.note,
                  createdFrom: pendingPayment.createdFrom,
                  createdBy: pendingPayment.createdBy,
                  createdAt: pendingPayment.createdAt?.toISOString?.() ?? null,
                  updatedAt: pendingPayment.updatedAt?.toISOString?.() ?? null,
                  purpose: pendingPayment.purpose ?? null,
                }
              : null,
          }
        : null,
      altegio: altegio
        ? {
            id: altegio.id,
            altegioId: altegio.altegioId,
            operationDate: altegio.operationDate.toISOString(),
            kyivDay: altegio.kyivDay,
            amount: serializeBigInt(altegio.amountKopiykas),
            accountId: altegio.accountId,
            accountTitle: altegio.accountTitle,
            documentId: altegio.documentId,
            expenseId: altegio.expenseId,
            categoryTitle: altegio.categoryTitle,
            paymentPurpose: altegio.paymentPurpose,
            comment: altegio.comment,
          }
        : null,
      candidates: candidates.map((candidate: any) => ({
        id: candidate.id,
        altegioId: candidate.altegioId,
        operationDate: candidate.operationDate.toISOString(),
        amount: serializeBigInt(candidate.amountKopiykas),
        accountTitle: candidate.accountTitle,
        documentId: candidate.documentId,
        categoryTitle: candidate.categoryTitle,
        paymentPurpose: candidate.paymentPurpose,
        comment: candidate.comment,
      })),
    };
  }));

  const purposeRows = await (prisma as any).altegioPaymentPurpose.findMany({
    where: { isActive: true, externalId: { not: null } },
    orderBy: { title: "asc" },
    take: 200,
    select: { id: true, title: true, normalizedTitle: true, externalId: true, source: true },
  });
  const purposesByTitle = new Map<string, any>();
  for (const purpose of purposeRows) {
    const title = canonicalizeAltegioPaymentPurposeTitle(purpose.title, purpose.externalId);
    const normalizedTitle = normalizePaymentPurposeTitle(title);
    if (!purposesByTitle.has(normalizedTitle)) {
      purposesByTitle.set(normalizedTitle, { ...purpose, title, normalizedTitle });
    }
  }
  const purposes = Array.from(purposesByTitle.values()).sort((a, b) => a.title.localeCompare(b.title, "uk"));

  const summaryRows = await (prisma as any).bankAltegioPaymentMatch.groupBy({
    by: ["status"],
    _count: { _all: true },
  }).catch(() => []);

  return NextResponse.json({
    ok: true,
    rows,
    purposes,
    summary: summaryRows.reduce((acc: Record<string, number>, row: any) => {
      acc[row.status] = row._count?._all ?? 0;
      return acc;
    }, {}),
  });
}

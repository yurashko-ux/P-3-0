import { NextRequest, NextResponse } from "next/server";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";
import { altegioFetch } from "@/lib/altegio/client";
import { ALTEGIO_ENV } from "@/lib/altegio/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RawRecord = Record<string, unknown>;

function resolveCompanyId(): string {
  const companyId = process.env.ALTEGIO_COMPANY_ID?.trim() || ALTEGIO_ENV.PARTNER_ID || ALTEGIO_ENV.APPLICATION_ID;
  if (!companyId) {
    throw new Error("ALTEGIO_COMPANY_ID не налаштовано для тесту sale payment");
  }
  return companyId;
}

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : null;
}

function toPositiveInt(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${field} має бути додатнім числом`);
  }
  return Math.trunc(parsed);
}

function toFiniteMoney(value: unknown, field: string): number {
  const parsed = typeof value === "string" ? Number(value.replace(",", ".").trim()) : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${field} має бути додатнім числом`);
  }
  return Math.round(parsed * 100) / 100;
}

function buildDefaultPayload(params: { accountId: number; amount: number }) {
  return {
    payment_transactions: [
      {
        account_id: params.accountId,
        amount: params.amount,
      },
    ],
  };
}

function unwrapPaymentMethods(raw: unknown): RawRecord[] {
  const root = asRecord(raw);
  const data = asRecord(root?.data);
  const paymentMethods = data?.payment_methods ?? root?.payment_methods;
  return Array.isArray(paymentMethods)
    ? paymentMethods.map((item) => asRecord(item)).filter((item): item is RawRecord => item != null)
    : [];
}

function extractBalance(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return null;
  const nestedKeys = [
    "account",
    "deposit",
    "loyalty_card",
    "loyalty_certificate",
    "loyalty_abonement",
  ];
  for (const key of nestedKeys) {
    const nested = asRecord(record[key]);
    if (nested && "balance" in nested) return nested.balance;
  }
  return "balance" in record ? record.balance : null;
}

function summarizePaymentMethods(raw: unknown) {
  return unwrapPaymentMethods(raw).map((method) => ({
    slug: method.slug ?? null,
    is_applicable: method.is_applicable ?? null,
    applicable_amount: method.applicable_amount ?? null,
    applicable_count: method.applicable_count ?? null,
    applicable_value: method.applicable_value ?? null,
    account_id: method.account_id ?? asRecord(method.account)?.id ?? null,
    account_title: asRecord(method.account)?.title ?? null,
    balance: extractBalance(method),
    raw: method,
  }));
}

export async function POST(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json().catch(() => ({}));
    const companyId = typeof body.companyId === "string" && body.companyId.trim()
      ? body.companyId.trim()
      : resolveCompanyId();
    const documentId = toPositiveInt(body.documentId, "documentId");
    const accountId = toPositiveInt(body.accountId, "accountId");
    const amount = toFiniteMoney(body.amount, "amount");
    const dryRun = body.dryRun !== false;
    const payloadOverride = asRecord(body.payloadOverride);
    const payload = payloadOverride ?? buildDefaultPayload({ accountId, amount });
    const endpoint = `/company/${companyId}/sale/${documentId}/payment`;

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        endpoint,
        payload,
        note: "dryRun=true: POST в Altegio не виконувався.",
      });
    }

    const raw = await altegioFetch<unknown>(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    return NextResponse.json({
      ok: true,
      dryRun: false,
      endpoint,
      payload,
      paymentMethods: summarizePaymentMethods(raw),
      raw,
    });
  } catch (error) {
    console.error("[admin/altegio/test-sale-payment] Помилка:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Помилка тестового sale payment Altegio" },
      { status: 500 },
    );
  }
}

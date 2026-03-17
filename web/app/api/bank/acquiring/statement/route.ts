import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireBankSection } from "@/app/api/bank/require-bank-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MONOBANK_ACQUIRING_BASE = "https://api.monobank.ua";
const TARGET_CONNECTION_NAME = "Жалівців Олександра";
const TARGET_ACCOUNT_SUFFIX = "8048";
const TARGET_DATE = "2026-03-13";

type UnknownObject = Record<string, unknown>;

function toUtcRange(dateIso: string): { from: number; to: number } {
  const from = Math.floor(new Date(`${dateIso}T00:00:00.000Z`).getTime() / 1000);
  const to = Math.floor(new Date(`${dateIso}T23:59:59.000Z`).getTime() / 1000);
  return { from, to };
}

function digitsOnly(value: string | null | undefined): string {
  return (value ?? "").replace(/\D+/g, "");
}

function lastFour(value: string | null | undefined): string {
  const digits = digitsOnly(value);
  if (digits.length === 0) return "";
  return digits.slice(-4);
}

function findConnectionByName(connections: Array<{ id: string; name: string }>, targetName: string) {
  const normalizedTarget = targetName.trim().toLowerCase();
  const exact = connections.find((c) => c.name.trim().toLowerCase() === normalizedTarget);
  if (exact) return exact;
  return connections.find((c) => c.name.trim().toLowerCase().includes(normalizedTarget)) ?? null;
}

function findAccountBySuffix(
  accounts: Array<{ id: string; externalId: string; iban: string | null; maskedPan: string | null }>,
  suffix: string
) {
  return (
    accounts.find((a) => lastFour(a.maskedPan) === suffix) ??
    accounts.find((a) => lastFour(a.iban) === suffix) ??
    accounts.find((a) => lastFour(a.externalId) === suffix) ??
    null
  );
}

function maskString(value: string): string {
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function maskLikelyCardDigits(value: string): string {
  return value.replace(/\b(\d{6})\d{4,8}(\d{4})\b/g, (_, start: string, end: string) => `${start}****${end}`);
}

function sanitizeForUi(input: unknown, keyPath = ""): unknown {
  if (Array.isArray(input)) {
    return input.map((item, idx) => sanitizeForUi(item, `${keyPath}[${idx}]`));
  }
  if (input !== null && typeof input === "object") {
    const result: UnknownObject = {};
    for (const [key, value] of Object.entries(input as UnknownObject)) {
      const childPath = keyPath ? `${keyPath}.${key}` : key;
      const isSensitiveKey = /(token|cvv|cardToken|walletId|signature|cardData)/i.test(key);
      if (isSensitiveKey) {
        result[key] = typeof value === "string" ? maskString(value) : "***";
        continue;
      }
      result[key] = sanitizeForUi(value, childPath);
    }
    return result;
  }
  if (typeof input === "string") {
    const isLikelyTokenValue = /(token|authorization|secret)/i.test(keyPath);
    if (isLikelyTokenValue) return maskString(input);
    return maskLikelyCardDigits(input);
  }
  return input;
}

function sumNumericField(list: unknown[], field: string): number {
  return list.reduce<number>((acc, row) => {
    if (row == null || typeof row !== "object") return acc;
    const val = (row as UnknownObject)[field];
    if (typeof val === "number" && Number.isFinite(val)) return acc + val;
    return acc;
  }, 0);
}

export async function GET(req: NextRequest) {
  const auth = await requireBankSection(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const allConnections = await prisma.bankConnection.findMany({
      where: { provider: "monobank" },
      include: {
        accounts: {
          select: {
            id: true,
            externalId: true,
            iban: true,
            maskedPan: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const connection = findConnectionByName(
      allConnections.map((c) => ({ id: c.id, name: c.name })),
      TARGET_CONNECTION_NAME
    );
    if (!connection) {
      return NextResponse.json(
        { error: `Не знайдено підключення monobank: ${TARGET_CONNECTION_NAME}` },
        { status: 404 }
      );
    }

    const selectedConnection = allConnections.find((c) => c.id === connection.id);
    if (!selectedConnection) {
      return NextResponse.json({ error: "Підключення не знайдено після вибірки" }, { status: 404 });
    }

    const account = findAccountBySuffix(selectedConnection.accounts, TARGET_ACCOUNT_SUFFIX);
    if (!account) {
      return NextResponse.json(
        { error: `У підключенні "${selectedConnection.name}" не знайдено рахунок з суфіксом ${TARGET_ACCOUNT_SUFFIX}` },
        { status: 404 }
      );
    }

    const { from, to } = toUtcRange(TARGET_DATE);
    const endpoint = `${MONOBANK_ACQUIRING_BASE}/api/merchant/statement?from=${from}&to=${to}`;
    const monoRes = await fetch(endpoint, {
      method: "GET",
      headers: {
        "X-Token": selectedConnection.token,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    const rawText = await monoRes.text();
    let parsed: unknown = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsed = { raw: rawText };
    }

    if (!monoRes.ok) {
      const safeError = sanitizeForUi(parsed);
      return NextResponse.json(
        {
          ok: false,
          status: monoRes.status,
          date: TARGET_DATE,
          connectionName: selectedConnection.name,
          accountSuffix: TARGET_ACCOUNT_SUFFIX,
          accountHint: account.maskedPan ?? account.iban ?? account.externalId,
          endpoint,
          error: safeError,
        },
        { status: monoRes.status }
      );
    }

    const list = Array.isArray((parsed as { list?: unknown[] } | null)?.list)
      ? ((parsed as { list: unknown[] }).list ?? [])
      : Array.isArray(parsed)
      ? parsed
      : [];
    const filteredByAccount = list.filter((row) => {
      if (row == null || typeof row !== "object") return false;
      const candidate = row as UnknownObject;
      const candidateLast4 =
        lastFour(typeof candidate.maskedPan === "string" ? candidate.maskedPan : null) ||
        lastFour(typeof candidate.pan === "string" ? candidate.pan : null);
      return candidateLast4 === TARGET_ACCOUNT_SUFFIX;
    });

    const summary = {
      totalItems: list.length,
      matchedByAccount8048: filteredByAccount.length,
      amountTotal: sumNumericField(filteredByAccount, "amount"),
      profitAmountTotal: sumNumericField(filteredByAccount, "profitAmount"),
    };

    const sanitized = sanitizeForUi(parsed);
    const filteredSanitized = sanitizeForUi(filteredByAccount);

    return NextResponse.json({
      ok: true,
      date: TARGET_DATE,
      from,
      to,
      connectionName: selectedConnection.name,
      accountSuffix: TARGET_ACCOUNT_SUFFIX,
      accountHint: account.maskedPan ?? account.iban ?? account.externalId,
      endpoint,
      summary,
      filteredItems: filteredSanitized,
      raw: sanitized,
    });
  } catch (err) {
    console.error("[bank/acquiring/statement] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Помилка запиту acquiring-виписки" },
      { status: 500 }
    );
  }
}

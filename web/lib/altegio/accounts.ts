import { prisma } from "@/lib/prisma";
import { altegioFetch } from "./client";

type RawRecord = Record<string, unknown>;

type SyncableBankAccount = {
  id: string;
  currencyCode: number;
  externalId: string;
  maskedPan: string | null;
  iban: string | null;
  connection: {
    id: string;
    name: string;
    clientName: string | null;
  };
};

export type AltegioAccount = {
  id: string;
  title: string;
  type: string | null;
  balanceKopiykas: bigint | null;
  rawBalance: number | null;
  raw: RawRecord;
};

export type AltegioBankSyncResult =
  | { status: "success"; altegioAccountId: string; altegioAccountTitle: string; altegioBalance: string }
  | { status: "warning"; reason: string; altegioAccountId?: string; altegioAccountTitle?: string }
  | { status: "skipped"; reason: string };

const ALTEGIO_ACCOUNT_STOP_WORDS = new Set([
  "фоп",
  "рахунок",
  "рахунки",
  "рах",
  "банк",
  "monobank",
  "mono",
  "iban",
  "грн",
  "uah",
  "тов",
  "пп",
  "картка",
  "карта",
]);

function resolveCompanyId(): string {
  const companyId = process.env.ALTEGIO_COMPANY_ID?.trim();
  if (!companyId) {
    throw new Error("ALTEGIO_COMPANY_ID не налаштовано для синхронізації рахунків Altegio");
  }
  return companyId;
}

function unwrapAltegioPayload<T = unknown>(raw: unknown): T | null {
  if (!raw || typeof raw !== "object") return null;
  if ("data" in raw && (raw as { data?: unknown }).data != null) {
    const data = (raw as { data?: unknown }).data;
    if (data && typeof data === "object" && "data" in (data as Record<string, unknown>)) {
      return ((data as Record<string, unknown>).data as T) ?? null;
    }
    return data as T;
  }
  return raw as T;
}

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(",", ".").replace(/\s+/g, "");
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toKopiykas(value: number): bigint {
  return BigInt(Math.round(value * 100));
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]/g, "")
    .toLowerCase()
    .replace(/[^0-9a-zа-яіїєґ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNameTokens(values: Array<string | null | undefined>): string[] {
  const tokenSet = new Set<string>();

  for (const value of values) {
    const normalized = normalizeText(value ?? "");
    if (!normalized) continue;

    for (const token of normalized.split(" ")) {
      if (token.length < 3) continue;
      if (ALTEGIO_ACCOUNT_STOP_WORDS.has(token)) continue;
      tokenSet.add(token);
    }
  }

  return Array.from(tokenSet);
}

function extractBalanceNumber(raw: RawRecord): number | null {
  const directKeys = [
    "balance",
    "actual_balance",
    "current_balance",
    "available_balance",
    "saldo",
    "sum",
    "amount",
    "total_balance",
  ];

  for (const key of directKeys) {
    const direct = asFiniteNumber(raw[key]);
    if (direct != null) return direct;

    const nested = asRecord(raw[key]);
    if (!nested) continue;

    const nestedValue =
      asFiniteNumber(nested.value) ??
      asFiniteNumber(nested.amount) ??
      asFiniteNumber(nested.sum) ??
      asFiniteNumber(nested.balance);

    if (nestedValue != null) return nestedValue;
  }

  return null;
}

function isLikelyCashAccount(account: AltegioAccount): boolean {
  const type = normalizeText(account.type ?? "");
  const title = normalizeText(account.title);

  if (type.includes("cashless") || type.includes("noncash") || type.includes("bank")) {
    return false;
  }
  if (type.includes("cash")) return true;
  if (title.includes("каса")) return true;

  return false;
}

function isLikelyForeignCurrencyAccount(account: AltegioAccount): boolean {
  const title = normalizeText(account.title);
  return (
    title.includes("usd") ||
    title.includes("eur") ||
    title.includes("євро") ||
    title.includes("долар") ||
    title.includes("валют")
  );
}

function isEligibleForAutoMatch(account: AltegioAccount): boolean {
  if (isLikelyCashAccount(account)) return false;
  if (isLikelyForeignCurrencyAccount(account)) return false;
  return true;
}

function parseAltegioAccount(raw: RawRecord): AltegioAccount | null {
  const idValue = raw.id ?? raw.account_id ?? raw.accountId;
  const titleValue = raw.title ?? raw.name ?? raw.account_title;

  if (idValue == null || titleValue == null) return null;

  const rawBalance = extractBalanceNumber(raw);

  return {
    id: String(idValue),
    title: String(titleValue).trim(),
    type: raw.type != null ? String(raw.type) : null,
    balanceKopiykas: rawBalance != null ? toKopiykas(rawBalance) : null,
    rawBalance,
    raw,
  };
}

export async function fetchAltegioAccounts(companyId = resolveCompanyId()): Promise<AltegioAccount[]> {
  const raw = await altegioFetch<unknown>(`/accounts/${companyId}`);
  const payload = unwrapAltegioPayload<unknown>(raw);

  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(asRecord(payload)?.accounts)
      ? ((asRecord(payload)?.accounts as unknown[]) ?? [])
      : [];

  const accounts = items
    .map((item) => parseAltegioAccount(asRecord(item) ?? {}))
    .filter((item): item is AltegioAccount => item != null);

  console.log("[altegio/accounts] Отримано рахунків Altegio:", {
    companyId,
    total: accounts.length,
    titles: accounts.slice(0, 20).map((account) => account.title),
  });

  return accounts;
}

function chooseMatchingAccount(
  bankAccount: SyncableBankAccount,
  altegioAccounts: AltegioAccount[],
): { match: AltegioAccount | null; error: string | null; matchedTokens: string[] } {
  const tokens = extractNameTokens([
    bankAccount.connection.clientName,
    bankAccount.connection.name,
  ]);

  if (tokens.length === 0) {
    return {
      match: null,
      error: "Не вдалося визначити токени назви для зіставлення monobank-рахунку з Altegio",
      matchedTokens: [],
    };
  }

  const scored = altegioAccounts
    .filter(isEligibleForAutoMatch)
    .map((account) => {
      const title = normalizeText(account.title);
      const matchedTokens = tokens.filter((token) => title.includes(token));
      return { account, matchedTokens, score: matchedTokens.length };
    })
    .filter((entry) => entry.score > 0);

  if (scored.length === 0) {
    return {
      match: null,
      error: `Не знайдено відповідний рахунок Altegio по назві (${tokens.join(", ")})`,
      matchedTokens: tokens,
    };
  }

  const maxScore = Math.max(...scored.map((entry) => entry.score));
  const finalists = scored.filter((entry) => entry.score === maxScore);

  if (finalists.length > 1) {
    return {
      match: null,
      error: `Неоднозначне зіставлення Altegio-рахунку: ${finalists
        .map((entry) => entry.account.title)
        .join(" | ")}`,
      matchedTokens: finalists[0]?.matchedTokens ?? tokens,
    };
  }

  return {
    match: finalists[0]?.account ?? null,
    error: null,
    matchedTokens: finalists[0]?.matchedTokens ?? tokens,
  };
}

export function shouldSyncAltegioForBankAccount(bankAccount: Pick<SyncableBankAccount, "currencyCode">): boolean {
  return bankAccount.currencyCode === 980;
}

export async function syncAltegioBalanceForBankAccount(bankAccountId: string): Promise<AltegioBankSyncResult> {
  const bankAccount = await prisma.bankAccount.findUnique({
    where: { id: bankAccountId },
    select: {
      id: true,
      currencyCode: true,
      externalId: true,
      maskedPan: true,
      iban: true,
      connection: {
        select: {
          id: true,
          name: true,
          clientName: true,
        },
      },
    },
  });

  if (!bankAccount) {
    throw new Error(`BankAccount ${bankAccountId} не знайдено`);
  }

  if (!shouldSyncAltegioForBankAccount(bankAccount)) {
    return { status: "skipped", reason: "Синхронізація пропущена для не-гривневого рахунку" };
  }

  const altegioAccounts = await fetchAltegioAccounts();
  const matchResult = chooseMatchingAccount(bankAccount, altegioAccounts);

  if (!matchResult.match) {
    await prisma.bankAccount.update({
      where: { id: bankAccount.id },
      data: {
        altegioSyncError: matchResult.error,
      },
    });

    console.warn("[altegio/accounts] Не вдалося зіставити рахунок:", {
      bankAccountId: bankAccount.id,
      connectionName: bankAccount.connection.name,
      clientName: bankAccount.connection.clientName,
      error: matchResult.error,
      tokens: matchResult.matchedTokens,
    });

    return {
      status: "warning",
      reason: matchResult.error ?? "Не вдалося зіставити рахунок Altegio",
    };
  }

  if (matchResult.match.balanceKopiykas == null) {
    const errorMessage = `Рахунок Altegio "${matchResult.match.title}" знайдено, але API не повернув баланс`;

    await prisma.bankAccount.update({
      where: { id: bankAccount.id },
      data: {
        altegioAccountId: matchResult.match.id,
        altegioAccountTitle: matchResult.match.title,
        altegioSyncError: errorMessage,
      },
    });

    console.warn("[altegio/accounts] Altegio не повернув баланс рахунку:", {
      bankAccountId: bankAccount.id,
      altegioAccountId: matchResult.match.id,
      altegioAccountTitle: matchResult.match.title,
    });

    return {
      status: "warning",
      reason: errorMessage,
      altegioAccountId: matchResult.match.id,
      altegioAccountTitle: matchResult.match.title,
    };
  }

  await prisma.bankAccount.update({
    where: { id: bankAccount.id },
    data: {
      altegioAccountId: matchResult.match.id,
      altegioAccountTitle: matchResult.match.title,
      altegioBalance: matchResult.match.balanceKopiykas,
      altegioBalanceUpdatedAt: new Date(),
      altegioSyncError: null,
    },
  });

  console.log("[altegio/accounts] Синхронізовано altegio-баланс рахунку:", {
    bankAccountId: bankAccount.id,
    monobankConnectionName: bankAccount.connection.name,
    monobankClientName: bankAccount.connection.clientName,
    altegioAccountId: matchResult.match.id,
    altegioAccountTitle: matchResult.match.title,
    altegioBalanceKopiykas: matchResult.match.balanceKopiykas.toString(),
    matchedTokens: matchResult.matchedTokens,
  });

  return {
    status: "success",
    altegioAccountId: matchResult.match.id,
    altegioAccountTitle: matchResult.match.title,
    altegioBalance: matchResult.match.balanceKopiykas.toString(),
  };
}

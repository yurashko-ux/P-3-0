import { prisma } from "@/lib/prisma";
import { altegioFetch } from "./client";

type RawRecord = Record<string, unknown>;

type SyncableBankAccount = {
  id: string;
  currencyCode: number;
  externalId: string;
  maskedPan: string | null;
  iban: string | null;
  altegioAccountId?: string | null;
  altegioAccountTitle?: string | null;
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

export type AltegioAccountMatchDiagnostics = {
  match: AltegioAccount | null;
  error: string | null;
  inputTokens: string[];
  matchedTokens: string[];
  matchSource: "saved-account-id" | "title-tokens" | "none";
};

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

function kyivYmdNow(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

function getBankAccountMatchTokens(bankAccount: SyncableBankAccount): string[] {
  return extractNameTokens([
    bankAccount.connection.clientName,
    bankAccount.connection.name,
    bankAccount.altegioAccountTitle,
  ]);
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

async function fetchZReportAccountAmountsById(
  locationId: string,
  startDateYmd: string
): Promise<Map<string, bigint>> {
  const qs = new URLSearchParams();
  qs.set("start_date", startDateYmd);
  qs.set("end_date", startDateYmd);

  const raw = await altegioFetch<unknown>(`reports/z_report/${locationId}?${qs.toString()}`);
  const payload = unwrapAltegioPayload<unknown>(raw);
  const rec = asRecord(payload) ?? {};
  const data = asRecord(rec.data) ?? rec;
  const paids = asRecord(data.paids);
  const accountsRaw = paids?.accounts;
  const out = new Map<string, bigint>();

  if (!Array.isArray(accountsRaw)) {
    return out;
  }

  for (const item of accountsRaw) {
    const row = asRecord(item);
    if (!row) continue;
    const idRaw = row.id ?? row.account_id ?? row.accountId;
    if (idRaw == null) continue;
    const amountNum =
      asFiniteNumber(row.amount) ??
      asFiniteNumber(row.sum) ??
      asFiniteNumber(row.balance) ??
      asFiniteNumber(asRecord(row.amount)?.value);
    if (amountNum == null) continue;
    out.set(String(idRaw), toKopiykas(amountNum));
  }
  return out;
}

function isLikelyCashAccount(account: AltegioAccount): boolean {
  const type = normalizeText(account.type ?? "");
  const title = normalizeText(account.title);

  if (type.includes("cashless") || type.includes("noncash") || type.includes("bank")) {
    return false;
  }
  if (type.includes("cash")) return true;
  if (title.includes("каса")) return true;
  /** Екран Altegio «Зараз в касі» зазвичай прив’язаний до готівкової каси, навіть якщо в назві лише «ФОП …». */
  if (title.includes("готів") || title.includes("gotiv")) return true;

  return false;
}

/** Безготівковий/банківський рахунок у Altegio — не те саме, що «Зараз в касі». */
function isLikelyBankLinkedTitle(account: AltegioAccount): boolean {
  const title = normalizeText(account.title);
  return (
    title.includes("mono") ||
    title.includes("monobank") ||
    title.includes("iban") ||
    title.includes("безготів") ||
    title.includes("privat") ||
    title.includes("приват") ||
    title.includes("raif") ||
    title.includes("райф") ||
    title.includes("ощад") ||
    title.includes("sense") ||
    title.includes("картк")
  );
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

/** Для зіставлення з monobank-ФОП беремо всі UAH-релевантні каси Altegio, включно з готівкою (як у UI «Зараз в касі»). */
function isEligibleForBankAltegioAutoMatch(account: AltegioAccount): boolean {
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

export function diagnoseAltegioAccountMatch(
  bankAccount: SyncableBankAccount,
  altegioAccounts: AltegioAccount[],
): AltegioAccountMatchDiagnostics {
  const savedAltegioAccountId = bankAccount.altegioAccountId?.trim() || "";
  if (savedAltegioAccountId) {
    const savedMatch = altegioAccounts.find((account) => account.id === savedAltegioAccountId) ?? null;
    if (savedMatch) {
      return {
        match: savedMatch,
        error: null,
        inputTokens: getBankAccountMatchTokens(bankAccount),
        matchedTokens: ["saved-account-id"],
        matchSource: "saved-account-id",
      };
    }
  }

  const tokens = getBankAccountMatchTokens(bankAccount);

  if (tokens.length === 0) {
    return {
      match: null,
      error: "Не вдалося визначити токени назви для зіставлення monobank-рахунку з Altegio",
      inputTokens: [],
      matchedTokens: [],
      matchSource: "none",
    };
  }

  const scored = altegioAccounts
    .filter(isEligibleForBankAltegioAutoMatch)
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
      inputTokens: tokens,
      matchedTokens: tokens,
      matchSource: "none",
    };
  }

  const maxScore = Math.max(...scored.map((entry) => entry.score));
  let finalists = scored.filter((entry) => entry.score === maxScore);

  /** Пріоритет каси (готівка), щоб «Баланс Альтеджіо» збігався з «Зараз в касі», а не з безготівковим рахунком. */
  const cashFinalists = finalists.filter((e) => isLikelyCashAccount(e.account));
  if (cashFinalists.length === 1) {
    finalists = cashFinalists;
  } else if (cashFinalists.length > 1) {
    return {
      match: null,
      error: `Неоднозначне зіставлення готівкових кас Altegio: ${cashFinalists
        .map((entry) => entry.account.title)
        .join(" | ")}`,
      inputTokens: tokens,
      matchedTokens: cashFinalists[0]?.matchedTokens ?? tokens,
      matchSource: "none",
    };
  } else {
    const nonBankFinalists = finalists.filter((e) => !isLikelyBankLinkedTitle(e.account));
    if (nonBankFinalists.length === 1) {
      finalists = nonBankFinalists;
    } else if (nonBankFinalists.length > 1) {
      return {
        match: null,
        error: `Неоднозначне зіставлення Altegio-рахунку: ${nonBankFinalists
          .map((entry) => entry.account.title)
          .join(" | ")}`,
        inputTokens: tokens,
        matchedTokens: nonBankFinalists[0]?.matchedTokens ?? tokens,
        matchSource: "none",
      };
    }
  }

  if (finalists.length > 1) {
    return {
      match: null,
      error: `Неоднозначне зіставлення Altegio-рахунку: ${finalists
        .map((entry) => entry.account.title)
        .join(" | ")}`,
      inputTokens: tokens,
      matchedTokens: finalists[0]?.matchedTokens ?? tokens,
      matchSource: "none",
    };
  }

  return {
    match: finalists[0]?.account ?? null,
    error: null,
    inputTokens: tokens,
    matchedTokens: finalists[0]?.matchedTokens ?? tokens,
    matchSource: "title-tokens",
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
      altegioAccountId: true,
      altegioAccountTitle: true,
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
  const matchResult = diagnoseAltegioAccountMatch(bankAccount, altegioAccounts);

  if (!matchResult.match) {
    await prisma.bankAccount.update({
      where: { id: bankAccount.id },
      data: {
        altegioSyncError: matchResult.error,
      },
      select: { id: true },
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
    const companyId = resolveCompanyId();
    const reportDay = kyivYmdNow();
    const zReportAmounts = await fetchZReportAccountAmountsById(companyId, reportDay).catch((err) => {
      console.warn(
        "[altegio/accounts] Не вдалося прочитати z_report для fallback балансу:",
        err instanceof Error ? err.message : String(err)
      );
      return new Map<string, bigint>();
    });
    const zReportBalance = zReportAmounts.get(matchResult.match.id) ?? null;

    if (zReportBalance != null) {
      await prisma.bankAccount.update({
        where: { id: bankAccount.id },
        data: {
          altegioAccountId: matchResult.match.id,
          altegioAccountTitle: matchResult.match.title,
          altegioBalance: zReportBalance,
          altegioBalanceUpdatedAt: new Date(),
          altegioSyncError: null,
        },
        select: { id: true },
      });

      console.log("[altegio/accounts] Синхронізовано altegio-баланс з z_report fallback:", {
        bankAccountId: bankAccount.id,
        altegioAccountId: matchResult.match.id,
        altegioAccountTitle: matchResult.match.title,
        altegioBalanceKopiykas: zReportBalance.toString(),
        reportDay,
      });

      return {
        status: "success",
        altegioAccountId: matchResult.match.id,
        altegioAccountTitle: matchResult.match.title,
        altegioBalance: zReportBalance.toString(),
      };
    }

    const errorMessage = `Рахунок Altegio "${matchResult.match.title}" знайдено, але API не повернув баланс (accounts + z_report)`;

    await prisma.bankAccount.update({
      where: { id: bankAccount.id },
      data: {
        altegioAccountId: matchResult.match.id,
        altegioAccountTitle: matchResult.match.title,
        altegioSyncError: errorMessage,
      },
      select: { id: true },
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
    select: { id: true },
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

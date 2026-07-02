import { isDepositTopUpPaymentPurpose } from "@/lib/altegio/payment-purpose-labels";
import type {
  AltegioPayerAggregate,
  BankIncomingItem,
  IncomingDayGroup,
} from "@/lib/bank/incoming-altegio-aggregate";

export type AltegioDayPayerRow = {
  payerName: string;
  amountKop: string;
  accountTitle: string;
  operationTime: string;
  paymentPurpose: string | null;
};

export type AltegioDayAccountClient = {
  payerName: string;
  totalKop: string;
  latestOperationTime: string;
  items: AltegioDayPayerRow[];
};

export type AltegioDayAccountRow = {
  accountTitle: string;
  totalKop: string;
  latestOperationTime: string;
  clients: AltegioDayAccountClient[];
};

export type AltegioDayGroup = {
  kyivDay: string;
  dayLabel: string;
  totalKop: string;
  accounts: AltegioDayAccountRow[];
};

export type BankDayItemRow = BankIncomingItem & {
  accountTitle: string;
  altegioAccountTitle: string | null;
};

export type BankAccountGroup = {
  accountTitle: string;
  altegioAccountTitle: string | null;
  rows: BankDayItemRow[];
  totalKop: string;
};

export type BankDayFlat = {
  kyivDay: string;
  dayLabel: string;
  totalKop: string;
  commissionTotalKop: string;
  fullTotalKop: string;
  rows: BankDayItemRow[];
};

export type DayAccountAlignedRow = {
  matchKey: string;
  altegioAccount: AltegioDayAccountRow | null;
  bankGroup: BankAccountGroup | null;
};

function kyivDayFromOperationTime(operationTime: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(operationTime));
}

export { kyivDayFromOperationTime as bankKyivDayFromOperationTime };

function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatKyivDayLabel(kyivDay: string): string {
  const [year, month, day] = kyivDay.split("-");
  return `${day}.${month}.${year}`;
}

/** День групування банку: еквайринг зсуваємо на −1 день. */
export function bankGroupingKyivDay(item: BankIncomingItem): string {
  const actualDay = kyivDayFromOperationTime(item.time);
  if (item.kind === "universal_bank_aggregate") return addDaysYmd(actualDay, -1);
  return actualDay;
}

export function bankActualKyivDay(item: BankIncomingItem): string {
  return kyivDayFromOperationTime(item.time);
}

export function bankCommissionKop(item: BankIncomingItem): bigint {
  if (item.commissionKop) return BigInt(item.commissionKop);
  if (item.commissionRaw) {
    const match = item.commissionRaw.match(/([\d\s]+(?:[,.]\d{1,2})?)/);
    if (match) {
      const amount = Number(match[1].replace(/\s+/g, "").replace(",", "."));
      if (Number.isFinite(amount) && amount > 0) return BigInt(Math.round(amount * 100));
    }
  }
  return 0n;
}

export function bankFullAmountKop(item: BankIncomingItem): bigint {
  return BigInt(item.amountKop || 0) + bankCommissionKop(item);
}

function sumBankRowsTotals(rows: BankDayItemRow[]): {
  totalKop: string;
  commissionTotalKop: string;
  fullTotalKop: string;
} {
  let totalKop = 0n;
  let commissionTotalKop = 0n;
  let fullTotalKop = 0n;

  for (const row of rows) {
    totalKop += BigInt(row.amountKop || 0);
    commissionTotalKop += bankCommissionKop(row);
    fullTotalKop += bankFullAmountKop(row);
  }

  return {
    totalKop: totalKop.toString(),
    commissionTotalKop: commissionTotalKop.toString(),
    fullTotalKop: fullTotalKop.toString(),
  };
}

export function regroupBankByDayWithAcquiringShift(
  byDay: IncomingDayGroup<BankIncomingItem>[],
): BankDayFlat[] {
  const bucket = new Map<string, BankDayItemRow[]>();

  for (const day of byDay) {
    for (const account of day.byAccount) {
      for (const item of account.items) {
        const groupingDay = bankGroupingKyivDay(item);
        if (!bucket.has(groupingDay)) bucket.set(groupingDay, []);
        bucket.get(groupingDay)!.push({
          ...item,
          accountTitle: account.accountTitle,
          altegioAccountTitle: account.altegioAccountTitle ?? null,
        });
      }
    }
  }

  const days = Array.from(bucket.entries()).map(([kyivDay, rows]) => {
    rows.sort((a, b) => b.time.localeCompare(a.time));
    const totals = sumBankRowsTotals(rows);
    return {
      kyivDay,
      dayLabel: formatKyivDayLabel(kyivDay),
      totalKop: totals.totalKop,
      commissionTotalKop: totals.commissionTotalKop,
      fullTotalKop: totals.fullTotalKop,
      rows,
    };
  });

  days.sort((a, b) => b.kyivDay.localeCompare(a.kyivDay));
  return days;
}

function bankDaysVisibleWithAltegio(bankDays: BankDayFlat[], altegioDays: AltegioDayGroup[]): BankDayFlat[] {
  const altegioDayKeys = new Set(altegioDays.map((day) => day.kyivDay));
  return bankDays.filter((day) => altegioDayKeys.has(day.kyivDay));
}

function normalizeAccountMatchKey(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s*\(\d{4}\)\s*$/, "")
    .replace(/^(?:фоп|фсп)\s+/i, "")
    .replace(/[^\p{L}\p{N}\s$]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Сімейства ФОП з різним написанням у Altegio та monobank. */
const ACCOUNT_FAMILY_FRAGMENTS: Array<{ family: string; fragments: string[] }> = [
  { family: "жалівців", fragments: ["жалівців", "жаліцька", "жалівця", "желіхів", "желихів"] },
  { family: "колачник", fragments: ["колачник", "колічник", "копачник", "колечник"] },
];

function accountFamilyKey(title: string): string | null {
  const key = normalizeAccountMatchKey(title);
  for (const { family, fragments } of ACCOUNT_FAMILY_FRAGMENTS) {
    if (fragments.some((fragment) => key.includes(fragment))) return family;
  }
  return null;
}

export function accountsMatchForReconcile(
  altegioTitle: string,
  bankDisplayTitle: string,
  bankAltegioTitle: string | null,
): boolean {
  const altegioKey = normalizeAccountMatchKey(altegioTitle);
  const bankKeys = [
    normalizeAccountMatchKey(bankDisplayTitle),
    bankAltegioTitle ? normalizeAccountMatchKey(bankAltegioTitle) : "",
  ].filter(Boolean);

  if (bankKeys.some((key) => key === altegioKey)) return true;
  if (bankKeys.some((key) => key.includes(altegioKey) || altegioKey.includes(key))) return true;

  const altegioFamily = accountFamilyKey(altegioTitle);
  if (altegioFamily) {
    const bankFamilies = new Set(
      [bankDisplayTitle, bankAltegioTitle ?? ""]
        .map((title) => accountFamilyKey(title))
        .filter((key): key is string => Boolean(key)),
    );
    if (bankFamilies.has(altegioFamily)) return true;
  }

  return false;
}

function groupBankDayByAccount(bankDay: BankDayFlat): BankAccountGroup[] {
  const map = new Map<string, BankDayItemRow[]>();

  for (const row of bankDay.rows) {
    const key = row.accountTitle;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }

  const groups = Array.from(map.entries()).map(([accountTitle, rows]) => {
    rows.sort((a, b) => b.time.localeCompare(a.time));
    const totalKop = rows.reduce((sum, row) => sum + BigInt(row.amountKop), 0n);
    return {
      accountTitle,
      altegioAccountTitle: rows[0]?.altegioAccountTitle ?? null,
      rows,
      totalKop: totalKop.toString(),
    };
  });

  groups.sort((a, b) => {
    const amountDiff = Number(BigInt(b.totalKop) - BigInt(a.totalKop));
    if (amountDiff !== 0) return amountDiff;
    return a.accountTitle.localeCompare(b.accountTitle, "uk");
  });

  return groups;
}

export function buildDayAccountAlignedRows(
  altegioDay: AltegioDayGroup | null,
  bankDay: BankDayFlat | null,
): DayAccountAlignedRow[] {
  const altegioAccounts = altegioDay?.accounts ?? [];
  const bankGroups = bankDay ? groupBankDayByAccount(bankDay) : [];
  const usedBankIndexes = new Set<number>();
  const rows: DayAccountAlignedRow[] = [];

  for (const altegioAccount of altegioAccounts) {
    const bankIdx = bankGroups.findIndex(
      (group, index) =>
        !usedBankIndexes.has(index)
        && accountsMatchForReconcile(
          altegioAccount.accountTitle,
          group.accountTitle,
          group.altegioAccountTitle,
        ),
    );
    if (bankIdx >= 0) usedBankIndexes.add(bankIdx);

    rows.push({
      matchKey: `altegio|${altegioAccount.accountTitle}|${bankIdx >= 0 ? bankGroups[bankIdx].accountTitle : "none"}`,
      altegioAccount,
      bankGroup: bankIdx >= 0 ? bankGroups[bankIdx] : null,
    });
  }

  for (let index = 0; index < bankGroups.length; index += 1) {
    if (usedBankIndexes.has(index)) continue;
    rows.push({
      matchKey: `bank-only|${bankGroups[index].accountTitle}`,
      altegioAccount: null,
      bankGroup: bankGroups[index],
    });
  }

  return rows;
}

function bankGroupFullTotalKop(group: BankAccountGroup): bigint {
  return group.rows.reduce((sum, row) => sum + bankFullAmountKop(row), 0n);
}

/** Рядки банку, які беремо в автозведення (без внутрішніх/невизначених). */
export function bankRowsForIncomingReconcile(rows: BankDayItemRow[]): BankDayItemRow[] {
  return rows.filter((row) => row.kind !== "unknown");
}

export function bankRowsReconcileFullTotalKop(rows: BankDayItemRow[]): bigint {
  return bankRowsForIncomingReconcile(rows).reduce((sum, row) => sum + bankFullAmountKop(row), 0n);
}

function bankCounterpartyLabel(item: BankIncomingItem): string {
  return item.counterName || item.description || item.comment || "—";
}

function bankRowLooksLikeAcquiring(row: Pick<BankIncomingItem, "description" | "comment" | "counterName">): boolean {
  const text = `${row.description || ""} ${row.comment || ""} ${row.counterName || ""}`.toLowerCase();
  const normalized = text.replace(/\s+/g, " ").trim();
  return (
    text.includes("еквайр")
    || text.includes("acquir")
    || (text.includes("покриття") && text.includes("транзакц"))
    // Частина еквайрингу приходить як «Від: AT * UNIVERSAL BANK» без слова «еквайринг».
    || normalized.includes("at * universal bank")
    || normalized.includes("at universal bank")
    || normalized.includes("універсал банк")
  );
}

export function isIncomingRowAcquiringForReconcile(row: BankIncomingItem): boolean {
  return row.kind === "universal_bank_aggregate" || bankRowLooksLikeAcquiring(row);
}

function normalizePersonName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^від:\s*/i, "")
    .replace(/^фоп\s+/i, "")
    .replace(/['ʼ'`´]/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MIN_SURNAME_PART_LENGTH = 3;

function significantNameParts(name: string): string[] {
  return normalizePersonName(name)
    .split(" ")
    .filter((part) => part.length >= MIN_SURNAME_PART_LENGTH);
}

/**
 * Прізвище для зведення:
 * - банк (3+ слова): перше — «Журавчак Марʼяна Миколаївна»
 * - Altegio (2 слова): останнє — «Марʼяна Журавчак»
 * - одне слово: вважаємо прізвищем
 */
export function extractSurnameForMatch(name: string): string | null {
  const parts = significantNameParts(name);
  if (parts.length === 0) return null;
  if (parts.length >= 3) return parts[0];
  if (parts.length === 2) return parts[parts.length - 1];
  return parts[0];
}

/** Зведення платників лише за прізвищем (ім'я / апостроф не враховуємо). */
export function personNamesMatch(left: string, right: string): boolean {
  const leftSurname = extractSurnameForMatch(left);
  const rightSurname = extractSurnameForMatch(right);
  if (!leftSurname || !rightSurname) return false;
  return leftSurname === rightSurname;
}

export { bankCounterpartyLabel, normalizePersonName };

function clientIsDepositOnly(client: AltegioDayAccountClient): boolean {
  return (
    client.items.length > 0
    && client.items.every((item) => isDepositTopUpPaymentPurpose(item.paymentPurpose || ""))
  );
}

function findAltegioClientForNamedBankRow(
  altegioAccount: AltegioDayAccountRow,
  bankRow: BankDayItemRow,
  usedClientKeys: Set<string>,
): AltegioDayAccountClient | null {
  const bankLabel = bankCounterpartyLabel(bankRow);
  const bankAmountKop = bankFullAmountKop(bankRow);
  for (const client of altegioAccount.clients) {
    if (clientIsDepositOnly(client)) continue;
    const clientKey = `${client.payerName}|${client.totalKop}`;
    if (usedClientKeys.has(clientKey)) continue;
    if (!personNamesMatch(client.payerName, bankLabel)) continue;
    if (BigInt(client.totalKop) !== bankAmountKop) continue;
    return client;
  }
  return null;
}

export type IncomingNamedClientMatch = {
  bankRowId: string;
  payerName: string;
  amountKop: string;
};

export type IncomingAcquiringBatchMatch = {
  bankRowIds: string[];
  bankFullKop: string;
  altegioRemainingKop: string;
  commissionKop: string;
};

/** Результат пошуку збігів — лише те, що справді сходиться. Часткове зведення дозволено. */
export type IncomingAccountReconcileEvaluation = {
  matchedBankRows: BankDayItemRow[];
  namedMatches: IncomingNamedClientMatch[];
  acquiringMatch: IncomingAcquiringBatchMatch | null;
  /** Банківські рядки рахунку без пари */
  unmatchedBankRows: BankDayItemRow[];
  /** Клієнти Altegio без пари (після іменованих; еквайринг не зійшовся) */
  unmatchedAltegioClients: AltegioDayAccountClient[];
  unmatchedAltegioKop: bigint;
};

/**
 * Зведення в межах одного рахунку Altegio за день:
 * 1) іменовані банк → рахунок + клієнт + сума (повна);
 * 2) еквайринг → рахунок + номінальна сума = сума решти платежів Altegio після кроку 1.
 * Не зводимо те, що не збігається.
 */
export function evaluateIncomingAccountReconcile(
  altegioAccount: AltegioDayAccountRow,
  bankDay: BankDayFlat,
): IncomingAccountReconcileEvaluation {
  if (isCashReconcileAccount(altegioAccount.accountTitle)) {
    return {
      matchedBankRows: [],
      namedMatches: [],
      acquiringMatch: null,
      unmatchedBankRows: [],
      unmatchedAltegioClients: altegioAccount.clients,
      unmatchedAltegioKop: BigInt(altegioAccount.totalKop),
    };
  }

  const allRows = bankRowsForIncomingReconcile(
    collectBankRowsForAltegioReconcile(altegioAccount, bankDay),
  );
  const namedRows = allRows.filter(
    (row) => row.kind === "named_incoming" && !bankRowLooksLikeAcquiring(row),
  );
  const universalRows = allRows.filter((row) => isIncomingRowAcquiringForReconcile(row));

  const matchedBankRows: BankDayItemRow[] = [];
  const namedMatches: IncomingNamedClientMatch[] = [];
  const usedClientKeys = new Set<string>();

  for (const namedRow of namedRows) {
    const client = findAltegioClientForNamedBankRow(altegioAccount, namedRow, usedClientKeys);
    if (!client) continue;
    const clientKey = `${client.payerName}|${client.totalKop}`;
    usedClientKeys.add(clientKey);
    matchedBankRows.push(namedRow);
    namedMatches.push({
      bankRowId: namedRow.id,
      payerName: client.payerName,
      amountKop: client.totalKop,
    });
  }

  const unmatchedAltegioClients = altegioAccount.clients.filter(
    (client) => !usedClientKeys.has(`${client.payerName}|${client.totalKop}`),
  );
  // Завдатки звіряються окремо; не повинні блокувати batch-еквайринг.
  const unmatchedForAcquiring = unmatchedAltegioClients.filter((client) => !clientIsDepositOnly(client));
  const altegioRemainingKop = unmatchedForAcquiring.reduce(
    (sum, client) => sum + BigInt(client.totalKop),
    0n,
  );

  let acquiringMatch: IncomingAcquiringBatchMatch | null = null;
  const acquiringMatchedClientKeys = new Set<string>();

  if (universalRows.length > 0 && altegioRemainingKop > 0n) {
    const universalFullKop = bankRowsReconcileFullTotalKop(universalRows);

    if (universalFullKop === altegioRemainingKop) {
      matchedBankRows.push(...universalRows);
      for (const client of unmatchedForAcquiring) {
        acquiringMatchedClientKeys.add(`${client.payerName}|${client.totalKop}`);
      }
      acquiringMatch = {
        bankRowIds: universalRows.map((row) => row.id),
        bankFullKop: universalFullKop.toString(),
        altegioRemainingKop: altegioRemainingKop.toString(),
        commissionKop: universalRows.reduce((sum, row) => sum + bankCommissionKop(row), 0n).toString(),
      };
    }
  }

  const matchedIds = new Set(matchedBankRows.map((row) => row.id));
  const unmatchedBankRows = allRows.filter((row) => !matchedIds.has(row.id));

  const stillUnmatchedAltegioClients = unmatchedAltegioClients.filter((client) => {
    const key = `${client.payerName}|${client.totalKop}`;
    if (acquiringMatchedClientKeys.has(key)) return false;
    return true;
  });
  const unmatchedAltegioKop = stillUnmatchedAltegioClients.reduce(
    (sum, client) => sum + BigInt(client.totalKop),
    0n,
  );

  return {
    matchedBankRows,
    namedMatches,
    acquiringMatch,
    unmatchedBankRows,
    unmatchedAltegioClients: stillUnmatchedAltegioClients,
    unmatchedAltegioKop,
  };
}

/** Усі банківські рядки за день для одного рахунку Altegio (кілька карток monobank). */
export function collectBankRowsForAltegioReconcile(
  altegioAccount: AltegioDayAccountRow,
  bankDay: BankDayFlat,
): BankDayItemRow[] {
  if (isCashReconcileAccount(altegioAccount.accountTitle)) return [];

  const groups = groupBankDayByAccount(bankDay);
  const merged: BankDayItemRow[] = [];

  for (const group of groups) {
    if (isCashReconcileAccount(group.accountTitle)) continue;
    if (
      !accountsMatchForReconcile(
        altegioAccount.accountTitle,
        group.accountTitle,
        group.altegioAccountTitle,
      )
    ) {
      continue;
    }
    merged.push(...bankRowsForIncomingReconcile(group.rows));
  }

  return merged;
}

export function accountDiffKop(
  altegioAccount: AltegioDayAccountRow | null,
  bankGroup: BankAccountGroup | null,
): bigint {
  const altegio = altegioAccount ? BigInt(altegioAccount.totalKop) : 0n;
  const bankFull = bankGroup ? bankGroupFullTotalKop(bankGroup) : 0n;
  return bankFull - altegio;
}

/** Δ для автозведення: Altegio vs банк (номінальна, кілька карток, без unknown). */
export function accountReconcileDiffKop(
  altegioAccount: AltegioDayAccountRow,
  bankDay: BankDayFlat,
): bigint {
  const bankFull = bankRowsReconcileFullTotalKop(
    collectBankRowsForAltegioReconcile(altegioAccount, bankDay),
  );
  return bankFull - BigInt(altegioAccount.totalKop);
}

export type EvaluatedOpenReconcilePair = {
  bankRowId: string;
  kyivDay: string;
  payerName: string;
  altegioTransactionId?: number;
  kind: "named" | "deposit";
};

function isBankDayNearPaymentDay(bankTime: string, paymentKyivDay: string): boolean {
  const bankDay = kyivDayFromOperationTime(bankTime);
  if (bankDay === paymentKyivDay) return true;
  return bankDay === addDaysYmd(paymentKyivDay, -1) || bankDay === addDaysYmd(paymentKyivDay, 1);
}

/**
 * Знаходить пари Altegio↔Банк для приховування з «Не зведених» без запису в БД.
 * Дублює логіку автозведення: іменовані + завдатки.
 */
export function evaluateOpenReconcilePairs(
  byPayer: AltegioPayerAggregate[],
  bankByDay: IncomingDayGroup<BankIncomingItem>[],
): EvaluatedOpenReconcilePair[] {
  const altegioDays = filterAltegioDaysNonCash(groupAltegioPayersByDay(byPayer));
  const bankDays = regroupBankByDayWithAcquiringShift(bankByDay);
  const visibleBankDays = bankDaysVisibleWithAltegio(bankDays, altegioDays);
  const pairs: EvaluatedOpenReconcilePair[] = [];
  const usedBankIds = new Set<string>();

  for (const altegioDay of altegioDays) {
    const bankDay = visibleBankDays.find((day) => day.kyivDay === altegioDay.kyivDay);
    if (!bankDay) continue;

    for (const account of altegioDay.accounts) {
      const evaluation = evaluateIncomingAccountReconcile(account, bankDay);
      for (const named of evaluation.namedMatches) {
        if (usedBankIds.has(named.bankRowId)) continue;
        usedBankIds.add(named.bankRowId);
        pairs.push({
          bankRowId: named.bankRowId,
          kyivDay: altegioDay.kyivDay,
          payerName: named.payerName,
          kind: "named",
        });
      }
    }
  }

  const bankNamedRows: BankDayItemRow[] = [];
  for (const day of bankDays) {
    for (const row of day.rows) {
      if (row.kind !== "named_incoming") continue;
      if (bankRowLooksLikeAcquiring(row)) continue;
      if (isCashReconcileAccount(row.accountTitle)) continue;
      if (row.altegioAccountTitle && isCashReconcileAccount(row.altegioAccountTitle)) continue;
      bankNamedRows.push(row);
    }
  }

  for (const payer of byPayer) {
    for (const item of payer.items) {
      if (!isDepositTopUpPaymentPurpose(item.paymentPurpose || "")) continue;
      if (isCashReconcileAccount(item.accountTitle)) continue;

      const paymentKyivDay = kyivDayFromOperationTime(item.operationTime);
      const amountKop = BigInt(item.amountKop);

      for (const row of bankNamedRows) {
        if (usedBankIds.has(row.id)) continue;
        if (!isBankDayNearPaymentDay(row.time, paymentKyivDay)) continue;
        if (!personNamesMatch(payer.payerName, bankCounterpartyLabel(row))) continue;
        if (bankFullAmountKop(row) !== amountKop) continue;
        if (!accountsMatchForReconcile(item.accountTitle, row.accountTitle, row.altegioAccountTitle)) {
          continue;
        }

        usedBankIds.add(row.id);
        pairs.push({
          bankRowId: row.id,
          kyivDay: paymentKyivDay,
          payerName: payer.payerName,
          altegioTransactionId: item.altegioId,
          kind: "deposit",
        });
        break;
      }
    }
  }

  return pairs;
}

/** Готівкові рахунки Altegio: Каса, Долар, Євро; решта — безготівка. */
export function isCashAltegioAccount(accountTitle: string): boolean {
  const normalized = accountTitle.trim().toLowerCase();
  if (normalized === "каса" || normalized.startsWith("каса ")) return true;
  if (normalized.includes("долар") || normalized.includes("dollar")) return true;
  if (normalized.includes("євро") || normalized.includes("евро") || normalized.includes("euro")) return true;
  return false;
}

/** Рахунки, які не беруть участі в автозведенні (готівка Altegio та placeholder «Готівка»). */
export function isCashReconcileAccount(accountTitle: string): boolean {
  if (!accountTitle?.trim()) return false;
  if (isCashAltegioAccount(accountTitle)) return true;
  const key = normalizeAccountMatchKey(accountTitle);
  return key.includes("готів");
}

export function filterAltegioDaysNonCash(days: AltegioDayGroup[]): AltegioDayGroup[] {
  return days
    .map((day) => {
      const accounts = day.accounts.filter((account) => !isCashAltegioAccount(account.accountTitle));
      if (accounts.length === 0) return null;

      const totalKop = accounts.reduce((sum, account) => sum + BigInt(account.totalKop), 0n);
      return {
        ...day,
        accounts,
        totalKop: totalKop.toString(),
      };
    })
    .filter((day): day is AltegioDayGroup => day != null);
}

export function groupAltegioPayersByDay(byPayer: AltegioPayerAggregate[]): AltegioDayGroup[] {
  const dayMap = new Map<string, AltegioDayPayerRow[]>();

  for (const payer of byPayer) {
    for (const item of payer.items) {
      const kyivDay = kyivDayFromOperationTime(item.operationTime);
      if (!dayMap.has(kyivDay)) dayMap.set(kyivDay, []);
      dayMap.get(kyivDay)!.push({
        payerName: payer.payerName,
        amountKop: item.amountKop,
        accountTitle: item.accountTitle,
        operationTime: item.operationTime,
        paymentPurpose: item.paymentPurpose,
      });
    }
  }

  const days = Array.from(dayMap.entries()).map(([kyivDay, rows]) => {
    const accountMap = new Map<string, Map<string, AltegioDayPayerRow[]>>();

    for (const row of rows) {
      const accountKey = row.accountTitle.trim() || "— без рахунку —";
      if (!accountMap.has(accountKey)) accountMap.set(accountKey, new Map());
      const clientMap = accountMap.get(accountKey)!;
      const payerKey = row.payerName.trim().toLowerCase() || "— без платника —";
      if (!clientMap.has(payerKey)) clientMap.set(payerKey, []);
      clientMap.get(payerKey)!.push(row);
    }

    const accounts: AltegioDayAccountRow[] = [];

    for (const [accountTitle, clientMap] of accountMap.entries()) {
      const clients: AltegioDayAccountClient[] = Array.from(clientMap.entries()).map(([, items]) => {
        items.sort((a, b) => b.operationTime.localeCompare(a.operationTime));
        const totalKop = items.reduce((sum, item) => sum + BigInt(item.amountKop), 0n);
        return {
          payerName: items[0]?.payerName || "— без платника —",
          totalKop: totalKop.toString(),
          latestOperationTime: items[0]?.operationTime || "",
          items,
        };
      });

      clients.sort((a, b) => {
        const timeDiff = b.latestOperationTime.localeCompare(a.latestOperationTime);
        if (timeDiff !== 0) return timeDiff;
        return a.payerName.localeCompare(b.payerName, "uk");
      });

      const allItems = clients.flatMap((client) => client.items);
      allItems.sort((a, b) => b.operationTime.localeCompare(a.operationTime));
      const accountTotalKop = clients.reduce((sum, client) => sum + BigInt(client.totalKop), 0n);

      accounts.push({
        accountTitle,
        totalKop: accountTotalKop.toString(),
        latestOperationTime: allItems[0]?.operationTime || "",
        clients,
      });
    }

    accounts.sort((a, b) => {
      const amountDiff = Number(BigInt(b.totalKop) - BigInt(a.totalKop));
      if (amountDiff !== 0) return amountDiff;
      return a.accountTitle.localeCompare(b.accountTitle, "uk");
    });

    const totalKop = accounts.reduce((sum, account) => sum + BigInt(account.totalKop), 0n);
    const [year, month, day] = kyivDay.split("-");
    return {
      kyivDay,
      dayLabel: `${day}.${month}.${year}`,
      totalKop: totalKop.toString(),
      accounts,
    };
  });

  days.sort((a, b) => b.kyivDay.localeCompare(a.kyivDay));
  return days;
}

function altegioClientMatchesAmount(client: AltegioDayAccountClient, amountKop: string): boolean {
  if (client.totalKop === amountKop) return true;
  return client.items.some((item) => item.amountKop === amountKop);
}

export function findAltegioClientOnDay(
  altegioDays: AltegioDayGroup[],
  kyivDay: string,
  payerNameHint: string,
  amountKop?: string | null,
): { account: AltegioDayAccountRow; client: AltegioDayAccountClient } | null {
  const day = altegioDays.find((item) => item.kyivDay === kyivDay);
  if (!day) return null;

  for (const account of day.accounts) {
    for (const client of account.clients) {
      if (!personNamesMatch(client.payerName, payerNameHint)) continue;
      if (amountKop && !altegioClientMatchesAmount(client, amountKop)) continue;
      return { account, client };
    }
  }
  return null;
}

export function findAltegioClientForIncomingLink(
  altegioDays: AltegioDayGroup[],
  preferredKyivDay: string,
  payerNameHint: string,
  amountKop?: string | null,
): {
  dayKyivDay: string;
  account: AltegioDayAccountRow;
  client: AltegioDayAccountClient;
} | null {
  const onPreferred = findAltegioClientOnDay(altegioDays, preferredKyivDay, payerNameHint, amountKop);
  if (onPreferred) {
    return { dayKyivDay: preferredKyivDay, ...onPreferred };
  }

  const sortedDays = [...altegioDays].sort((a, b) => b.kyivDay.localeCompare(a.kyivDay));
  for (const day of sortedDays) {
    if (day.kyivDay === preferredKyivDay) continue;
    const found = findAltegioClientOnDay(altegioDays, day.kyivDay, payerNameHint, amountKop);
    if (found) return { dayKyivDay: day.kyivDay, ...found };
  }
  return null;
}

export function findAltegioAccountOnDay(
  altegioDays: AltegioDayGroup[],
  kyivDay: string,
  accountTitleHint: string,
  altegioAccountTitleHint: string | null,
): AltegioDayAccountRow | null {
  const day = altegioDays.find((item) => item.kyivDay === kyivDay);
  if (!day) return null;

  return (
    day.accounts.find((account) =>
      accountsMatchForReconcile(accountTitleHint, account.accountTitle, altegioAccountTitleHint),
    ) ?? null
  );
}

export function buildIncomingDayAlignment(
  byPayer: AltegioPayerAggregate[],
  bankByDay: IncomingDayGroup<BankIncomingItem>[],
  kyivDay: string,
): {
  altegioDay: AltegioDayGroup | null;
  bankDay: BankDayFlat | null;
  accountRows: DayAccountAlignedRow[];
} {
  const altegioDays = filterAltegioDaysNonCash(groupAltegioPayersByDay(byPayer));
  const bankDays = bankDaysVisibleWithAltegio(
    regroupBankByDayWithAcquiringShift(bankByDay),
    altegioDays,
  );

  const altegioDay = altegioDays.find((day) => day.kyivDay === kyivDay) ?? null;
  const bankDay = bankDays.find((day) => day.kyivDay === kyivDay) ?? null;
  const accountRows = buildDayAccountAlignedRows(altegioDay, bankDay);

  return { altegioDay, bankDay, accountRows };
}

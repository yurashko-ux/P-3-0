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
    .replace(/^фоп\s+/i, "")
    .replace(/[^\p{L}\p{N}\s$]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  return bankKeys.some((key) => key.includes(altegioKey) || altegioKey.includes(key));
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

function normalizePersonName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^фоп\s+/i, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function personNamesMatch(left: string, right: string): boolean {
  const keyA = normalizePersonName(left);
  const keyB = normalizePersonName(right);
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;

  const partsA = keyA.split(" ").filter(Boolean);
  const partsB = keyB.split(" ").filter(Boolean);
  if (partsA.length >= 2 && partsB.length >= 2) {
    if (partsA[0] === partsB[0] && partsA[partsA.length - 1] === partsB[partsB.length - 1]) return true;
  }

  return keyA.includes(keyB) || keyB.includes(keyA);
}

function findAltegioClientForNamedBankRow(
  altegioAccount: AltegioDayAccountRow,
  bankRow: BankDayItemRow,
  usedClientKeys: Set<string>,
): AltegioDayAccountClient | null {
  const bankLabel = bankCounterpartyLabel(bankRow);
  for (const client of altegioAccount.clients) {
    const clientKey = `${client.payerName}|${client.totalKop}`;
    if (usedClientKeys.has(clientKey)) continue;
    if (!personNamesMatch(client.payerName, bankLabel)) continue;
    if (BigInt(client.totalKop) !== bankFullAmountKop(bankRow)) continue;
    return client;
  }
  return null;
}

function parseUniversalGrossKop(row: BankDayItemRow): bigint | null {
  const text = `${row.description || ""} ${row.comment || ""}`;
  const match = text.match(/Загалом\s+([\d\s]+(?:[,.]\d{1,2})?)\s*грн/i);
  if (!match) return null;
  const amount = Number(match[1].replace(/\s+/g, "").replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return BigInt(Math.round(amount * 100));
}

export type IncomingAccountReconcileEvaluation = {
  ok: boolean;
  reconcileRows: BankDayItemRow[];
  bankFullTotalKop: bigint;
  diffKop: bigint;
  cleanDiffKop: bigint;
  commissionKop: bigint;
  altegioRemainingKop: bigint;
  note?: string;
};

/**
 * Оцінка зведення по рахунку:
 * 1) іменовані банківські рядки — лише якщо є клієнт у Altegio з тією ж сумою;
 * 2) еквайринг — номінал (повна) vs залишок Altegio після іменованих;
 * 3) без еквайрингу — сума іменованих = Altegio.
 */
export function evaluateIncomingAccountReconcile(
  altegioAccount: AltegioDayAccountRow,
  bankDay: BankDayFlat,
): IncomingAccountReconcileEvaluation {
  const allRows = bankRowsForIncomingReconcile(
    collectBankRowsForAltegioReconcile(altegioAccount, bankDay),
  );
  const namedRows = allRows.filter((row) => row.kind === "named_incoming");
  const universalRows = allRows.filter((row) => row.kind === "universal_bank_aggregate");

  const reconcileRows: BankDayItemRow[] = [];
  const usedClientKeys = new Set<string>();
  let altegioRemaining = BigInt(altegioAccount.totalKop);

  for (const namedRow of namedRows) {
    const client = findAltegioClientForNamedBankRow(altegioAccount, namedRow, usedClientKeys);
    if (!client) continue;
    usedClientKeys.add(`${client.payerName}|${client.totalKop}`);
    altegioRemaining -= BigInt(client.totalKop);
    reconcileRows.push(namedRow);
  }

  let commissionKop = 0n;

  if (universalRows.length > 0) {
    const universalFullKop = bankRowsReconcileFullTotalKop(universalRows);
    commissionKop = universalRows.reduce((sum, row) => sum + bankCommissionKop(row), 0n);
    const grossFromComment = universalRows
      .map((row) => parseUniversalGrossKop(row))
      .find((value) => value != null) ?? universalFullKop;
    const universalFactualKop = universalFullKop - commissionKop;
    const remainingDiff = universalFullKop - altegioRemaining;
    const cleanRemainingDiff = remainingDiff - commissionKop;

    const universalMatches =
      remainingDiff === 0n ||
      cleanRemainingDiff === 0n ||
      remainingDiff === commissionKop ||
      grossFromComment === altegioRemaining ||
      universalFactualKop === altegioRemaining;

    if (!universalMatches) {
      const bankFullTotalKop = bankRowsReconcileFullTotalKop(reconcileRows) + universalFullKop;
      return {
        ok: false,
        reconcileRows: [],
        bankFullTotalKop,
        diffKop: bankFullTotalKop - BigInt(altegioAccount.totalKop),
        cleanDiffKop: bankFullTotalKop - commissionKop - BigInt(altegioAccount.totalKop),
        commissionKop,
        altegioRemainingKop: altegioRemaining,
        note:
          `еквайринг ${Number(universalFullKop) / 100} ₴ (номінал) vs залишок Altegio ${Number(altegioRemaining) / 100} ₴ після іменованих; ком. ${Number(commissionKop) / 100} ₴`,
      };
    }

    reconcileRows.push(...universalRows);
  } else if (altegioRemaining !== 0n) {
    const bankFullTotalKop = bankRowsReconcileFullTotalKop(reconcileRows);
    const unmatchedNamed = namedRows.filter((row) => !reconcileRows.includes(row));
    const note =
      unmatchedNamed.length > 0
        ? `в банку є іменовані без пари в Altegio (+${Number(bankRowsReconcileFullTotalKop(unmatchedNamed)) / 100} ₴)`
        : "суми іменованих банку не покривають Altegio";
    return {
      ok: false,
      reconcileRows: [],
      bankFullTotalKop,
      diffKop: bankFullTotalKop - BigInt(altegioAccount.totalKop),
      cleanDiffKop: bankFullTotalKop - BigInt(altegioAccount.totalKop),
      commissionKop: 0n,
      altegioRemainingKop: altegioRemaining,
      note,
    };
  }

  if (reconcileRows.length === 0) {
    return {
      ok: false,
      reconcileRows: [],
      bankFullTotalKop: 0n,
      diffKop: -BigInt(altegioAccount.totalKop),
      cleanDiffKop: -BigInt(altegioAccount.totalKop),
      commissionKop: 0n,
      altegioRemainingKop: altegioRemaining,
      note: "немає парних банківських рядків",
    };
  }

  const bankFullTotalKop = bankRowsReconcileFullTotalKop(reconcileRows);
  const diffKop = bankFullTotalKop - BigInt(altegioAccount.totalKop);
  return {
    ok: true,
    reconcileRows,
    bankFullTotalKop,
    diffKop,
    cleanDiffKop: diffKop - commissionKop,
    commissionKop,
    altegioRemainingKop: 0n,
  };
}

/** Усі банківські рядки за день для одного рахунку Altegio (кілька карток monobank). */
export function collectBankRowsForAltegioReconcile(
  altegioAccount: AltegioDayAccountRow,
  bankDay: BankDayFlat,
): BankDayItemRow[] {
  const groups = groupBankDayByAccount(bankDay);
  const merged: BankDayItemRow[] = [];

  for (const group of groups) {
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

/** Готівкові рахунки Altegio: Каса, Долар, Євро; решта — безготівка. */
export function isCashAltegioAccount(accountTitle: string): boolean {
  const normalized = accountTitle.trim().toLowerCase();
  if (normalized === "каса" || normalized.startsWith("каса ")) return true;
  if (normalized.includes("долар") || normalized.includes("dollar")) return true;
  if (normalized.includes("євро") || normalized.includes("евро") || normalized.includes("euro")) return true;
  return false;
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

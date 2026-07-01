import { altegioFetch, AltegioHttpError } from "./client";
import type { Client } from "./types";

type RawRecord = Record<string, unknown>;

export type AltegioClientCardBalance = {
  clientId: number;
  clientName: string | null;
  clientPhone: string | null;
  balance: number;
  soldAmount: number | null;
  spent: number | null;
  lastVisitDate: string | null;
};

export type FetchClientCardBalancesParams = {
  companyId?: number;
  limitPerPage?: number;
  maxPages?: number;
  /** Якщо true — лише balance !== 0 (плюсові й мінусові). */
  excludeZero?: boolean;
};

export type FetchClientCardBalancesResult = {
  companyId: number;
  source: "clients_search";
  searchStrategy: string;
  clientsScanned: number;
  pagesFetched: number;
  balanceFieldMissing: boolean;
  totalNonZero: number;
  totalPositive: number;
  totalNegative: number;
  sumBalance: number;
  clients: AltegioClientCardBalance[];
};

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

function resolveCompanyId(explicit?: number): number {
  if (explicit != null && Number.isFinite(explicit) && explicit > 0) return explicit;
  const companyId = Number(process.env.ALTEGIO_COMPANY_ID?.trim() || 0);
  if (Number.isFinite(companyId) && companyId > 0) return companyId;
  throw new Error("ALTEGIO_COMPANY_ID не налаштовано для отримання балансів клієнтів");
}

/** Баланс з картки клієнта (Сплачено − Продано), не депозитні рахунки. */
export function extractClientCardBalance(client: Client | RawRecord): number | null {
  const raw = client as RawRecord;
  return asFiniteNumber(raw.balance);
}

function parseClientCardBalanceRow(client: Client): AltegioClientCardBalance | null {
  const clientId = Number(client.id);
  if (!Number.isFinite(clientId) || clientId <= 0) return null;

  const balance = extractClientCardBalance(client);
  if (balance == null) return null;

  const raw = client as RawRecord;
  return {
    clientId,
    clientName: String(client.name || "").trim() || null,
    clientPhone: String(client.phone ?? "").trim() || null,
    balance,
    soldAmount:
      asFiniteNumber(raw.sold_amount) ??
      asFiniteNumber(raw.sold) ??
      asFiniteNumber(raw.total_spent) ??
      asFiniteNumber(raw.spent),
    spent: asFiniteNumber(raw.spent) ?? asFiniteNumber(raw.total_spent),
    lastVisitDate: String(raw.last_visit_date ?? "").trim() || null,
  };
}

function parseClientsSearchResponse(
  response: Client[] | { data?: Client[]; meta?: { total_count?: number; page?: number; page_size?: number } },
  pageSize: number,
): { clients: Client[]; hasMore: boolean } {
  let clients: Client[] = [];
  let hasMore = false;

  if (Array.isArray(response)) {
    clients = response;
    hasMore = clients.length >= pageSize;
  } else if (response && typeof response === "object" && Array.isArray(response.data)) {
    clients = response.data;
    hasMore = clients.length >= pageSize;
    const meta = response.meta;
    if (meta?.total_count != null && meta.page != null && meta.page_size != null) {
      hasMore = meta.page < Math.ceil(meta.total_count / meta.page_size);
    }
  }

  return { clients, hasMore };
}

type ClientsSearchStrategy = {
  name: string;
  buildBody: (page: number, pageSize: number) => object;
};

const CARD_BALANCE_SEARCH_STRATEGIES: ClientsSearchStrategy[] = [
  {
    name: "balance+stats+last_visit",
    buildBody: (page, pageSize) => ({
      page,
      page_size: pageSize,
      fields: [
        "id",
        "name",
        "phone",
        "email",
        "balance",
        "sold_amount",
        "spent",
        "total_spent",
        "last_visit_date",
      ],
      order_by: "last_visit_date",
      order_by_direction: "desc",
    }),
  },
  {
    name: "balance+last_visit",
    buildBody: (page, pageSize) => ({
      page,
      page_size: pageSize,
      fields: ["id", "name", "phone", "email", "balance", "last_visit_date"],
      order_by: "last_visit_date",
      order_by_direction: "desc",
    }),
  },
  {
    name: "balance_only",
    buildBody: (page, pageSize) => ({
      page,
      page_size: pageSize,
      fields: ["id", "name", "phone", "balance"],
      order_by: "id",
      order_by_direction: "desc",
    }),
  },
  {
    name: "all_fields",
    buildBody: (page, pageSize) => ({
      page,
      page_size: pageSize,
      order_by: "last_visit_date",
      order_by_direction: "desc",
    }),
  },
];

async function pickCardBalanceSearchStrategy(companyId: number): Promise<ClientsSearchStrategy> {
  for (const strategy of CARD_BALANCE_SEARCH_STRATEGIES) {
    try {
      const response = await altegioFetch<
        Client[] | { data?: Client[]; meta?: { total_count?: number; page?: number; page_size?: number } }
      >(`/company/${companyId}/clients/search`, {
        method: "POST",
        body: JSON.stringify(strategy.buildBody(1, 5)),
      });
      const { clients } = parseClientsSearchResponse(response, 5);
      const hasBalanceField = clients.some((c) => extractClientCardBalance(c) != null);
      if (hasBalanceField || clients.length === 0) {
        console.log(
          `[altegio/client-balances] ✅ clients/search стратегія: ${strategy.name}, balance у відповіді=${hasBalanceField}`,
        );
        return strategy;
      }
      console.warn(
        `[altegio/client-balances] clients/search «${strategy.name}»: поле balance відсутнє, наступна стратегія`,
      );
    } catch (err) {
      if (err instanceof AltegioHttpError && err.status === 403) {
        console.warn(`[altegio/client-balances] clients/search «${strategy.name}» → 403`);
        continue;
      }
      throw err;
    }
  }

  throw new Error(
    "clients/search не повертає поле balance. Перевірте права API-токена на клієнтів або спробуйте GET /company/{id}/client/{id} для одного клієнта.",
  );
}

async function fetchClientsPage(
  companyId: number,
  strategy: ClientsSearchStrategy,
  page: number,
  pageSize: number,
): Promise<{ clients: Client[]; hasMore: boolean }> {
  const response = await altegioFetch<
    Client[] | { data?: Client[]; meta?: { total_count?: number; page?: number; page_size?: number } }
  >(`/company/${companyId}/clients/search`, {
    method: "POST",
    body: JSON.stringify(strategy.buildBody(page, pageSize)),
  });
  return parseClientsSearchResponse(response, pageSize);
}

function isNonZeroBalance(balance: number, excludeZero: boolean): boolean {
  if (!excludeZero) return true;
  return Math.abs(balance) > 1e-9;
}

/**
 * Клієнти з ненульовим балансом на картці (поле balance, не deposits).
 * balance = Сплачено − Продано; може бути додатним (переплата) або від'ємним (борг).
 */
export async function fetchClientCardBalances(
  params: FetchClientCardBalancesParams = {},
): Promise<FetchClientCardBalancesResult> {
  const companyId = resolveCompanyId(params.companyId);
  const excludeZero = params.excludeZero !== false;
  const limitPerPage = Math.min(Math.max(params.limitPerPage ?? 100, 1), 500);
  const maxPages = Math.min(Math.max(params.maxPages ?? 50, 1), 200);

  const strategy = await pickCardBalanceSearchStrategy(companyId);
  const byClientId = new Map<number, AltegioClientCardBalance>();
  let clientsScanned = 0;
  let pagesFetched = 0;
  let balanceFieldMissing = false;

  for (let page = 1; page <= maxPages; page += 1) {
    const { clients, hasMore } = await fetchClientsPage(companyId, strategy, page, limitPerPage);
    pagesFetched += 1;

    if (clients.length === 0) break;

    let balanceHits = 0;
    for (const client of clients) {
      clientsScanned += 1;
      if (extractClientCardBalance(client) != null) balanceHits += 1;

      const parsed = parseClientCardBalanceRow(client);
      if (!parsed) continue;
      if (!isNonZeroBalance(parsed.balance, excludeZero)) continue;

      byClientId.set(parsed.clientId, parsed);
    }

    if (page === 1 && clients.length > 0 && balanceHits === 0) {
      balanceFieldMissing = true;
      throw new Error(
        `clients/search (${strategy.name}) не повертає поле balance для company ${companyId}. Це не депозити — потрібне поле balance з картки клієнта.`,
      );
    }

    console.log(
      `[altegio/client-balances] сторінка ${page}: ${clients.length} клієнтів, ненульових балансів=${byClientId.size}`,
    );

    if (!hasMore) break;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  const clients = Array.from(byClientId.values()).sort((a, b) => b.balance - a.balance);
  let totalPositive = 0;
  let totalNegative = 0;
  let sumBalance = 0;

  for (const row of clients) {
    sumBalance += row.balance;
    if (row.balance > 0) totalPositive += 1;
    else if (row.balance < 0) totalNegative += 1;
  }

  console.log(
    `[altegio/client-balances] ✅ company=${companyId}: переглянуто ${clientsScanned}, ненульових=${clients.length}, сума=${Math.round(sumBalance * 100) / 100}`,
  );

  return {
    companyId,
    source: "clients_search",
    searchStrategy: strategy.name,
    clientsScanned,
    pagesFetched,
    balanceFieldMissing,
    totalNonZero: clients.length,
    totalPositive,
    totalNegative,
    sumBalance: Math.round(sumBalance * 100) / 100,
    clients,
  };
}

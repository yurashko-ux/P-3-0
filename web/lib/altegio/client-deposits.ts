import { altegioFetch, AltegioHttpError } from "./client";
import { getCompany } from "./companies";
import { getClientsPaginated } from "./clients-search";
import { altegioUrlV2 } from "./env";
import type { Client } from "./types";

type RawRecord = Record<string, unknown>;

export type AltegioClientDepositSource = "deposits_chain" | "clients_search" | "deposits_location";

export type AltegioClientDeposit = {
  depositId: number;
  clientId: number | null;
  clientName: string | null;
  clientPhone: string | null;
  balance: number;
  initialBalance: number | null;
  blocked: boolean;
  depositTypeTitle: string | null;
  salonId: number | null;
  dateCreate: string | null;
  source: AltegioClientDepositSource;
  raw: RawRecord;
};

export type FetchChainClientDepositsParams = {
  chainId?: number;
  companyId?: number;
  balanceFrom?: number;
  balanceTo?: number;
  limitPerPage?: number;
  maxPages?: number;
};

export type FetchChainClientDepositsResult = {
  chainId: number | null;
  companyId: number | null;
  source: AltegioClientDepositSource;
  chainCandidatesTried: number[];
  balanceFrom: number;
  balanceTo: number | null;
  totalDeposits: number;
  totalBalance: number;
  pagesFetched: number;
  deposits: AltegioClientDeposit[];
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
  throw new Error("ALTEGIO_COMPANY_ID не налаштовано для отримання клієнтських балансів");
}

function addChainCandidate(ids: number[], value: unknown): void {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0 && !ids.includes(n)) ids.push(n);
}

function collectChainIdCandidatesFromObject(
  value: unknown,
  ids: number[],
  depth = 0,
  keyHint = "",
): void {
  if (depth > 4 || value == null) return;

  if (typeof value === "number" || typeof value === "string") {
    if (/salon[_-]?group|main[_-]?group|chain[_-]?id/i.test(keyHint)) {
      addChainCandidate(ids, value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectChainIdCandidatesFromObject(item, ids, depth + 1, keyHint);
    return;
  }

  if (typeof value !== "object") return;
  const rec = value as RawRecord;
  for (const [key, nested] of Object.entries(rec)) {
    const hint = `${keyHint}.${key}`;
    if (/salon[_-]?group|main[_-]?group|^group$|chain/i.test(key)) {
      if (typeof nested === "number" || typeof nested === "string") {
        addChainCandidate(ids, nested);
      } else {
        const nestedRec = asRecord(nested);
        addChainCandidate(ids, nestedRec?.id);
      }
    }
    collectChainIdCandidatesFromObject(nested, ids, depth + 1, hint);
  }
}

async function fetchChainCandidatesFromLocationV2(companyId: number): Promise<number[]> {
  const ids: number[] = [];
  try {
    const raw = await altegioFetch<unknown>(
      `/locations/${companyId}?include=salon_group,main_group`,
      {},
      3,
      350,
      30000,
      altegioUrlV2,
    );
    collectChainIdCandidatesFromObject(raw, ids);
    const data = asRecord(raw)?.data ?? raw;
    collectChainIdCandidatesFromObject(data, ids);
  } catch (err) {
    console.warn(
      `[altegio/client-deposits] ⚠️ Не вдалося отримати V2 location ${companyId} для chain_id:`,
      err instanceof Error ? err.message : String(err),
    );
  }
  return ids;
}

/**
 * Кандидати chain_id (salon_group) для deposits API.
 * business_group_id — не chain для депозитів.
 */
export async function resolveAltegioChainCandidates(explicitChainId?: number): Promise<number[]> {
  if (explicitChainId != null && Number.isFinite(explicitChainId) && explicitChainId > 0) {
    return [explicitChainId];
  }

  const fromEnv = process.env.ALTEGIO_CHAIN_ID?.trim();
  if (fromEnv) {
    const chainId = Number(fromEnv);
    if (Number.isFinite(chainId) && chainId > 0) return [chainId];
    throw new Error(`Невірний ALTEGIO_CHAIN_ID: ${fromEnv}`);
  }

  const companyId = resolveCompanyId();
  const candidates: number[] = [];

  const company = await getCompany(companyId);
  if (company) {
    const raw = company as RawRecord;
    addChainCandidate(candidates, raw.salon_group_id);
    addChainCandidate(candidates, raw.main_group_id);
    addChainCandidate(candidates, asRecord(raw.salon_group)?.id);
    addChainCandidate(candidates, asRecord(raw.main_group)?.id);
    addChainCandidate(candidates, asRecord(raw.group)?.id);
    collectChainIdCandidatesFromObject(raw, candidates);
  }

  for (const id of await fetchChainCandidatesFromLocationV2(companyId)) {
    addChainCandidate(candidates, id);
  }

  console.log(
    `[altegio/client-deposits] Кандидати chain_id для company ${companyId}:`,
    candidates.length ? candidates : "немає",
  );

  if (candidates.length === 0) {
    throw new Error(
      `Не вдалося визначити chain_id для company ${companyId}. Додайте ALTEGIO_CHAIN_ID у Vercel.`,
    );
  }

  return candidates;
}

/** @deprecated Використовуйте resolveAltegioChainCandidates */
export async function resolveAltegioChainId(explicitChainId?: number): Promise<number> {
  const candidates = await resolveAltegioChainCandidates(explicitChainId);
  return candidates[0];
}

function unwrapAltegioList(raw: unknown): { items: unknown[]; meta: RawRecord | null } {
  if (Array.isArray(raw)) {
    return { items: raw, meta: null };
  }

  const root = asRecord(raw);
  if (!root) return { items: [], meta: null };

  const meta = asRecord(root.meta);
  const data = root.data;

  if (Array.isArray(data)) {
    return { items: data, meta };
  }

  const dataRec = asRecord(data);
  if (!dataRec) {
    return { items: [], meta };
  }

  for (const key of ["deposits", "items", "accounts", "list", "rows"]) {
    const nested = dataRec[key];
    if (Array.isArray(nested)) {
      return { items: nested, meta: meta ?? dataRec };
    }
  }

  return { items: [], meta: meta ?? dataRec };
}

function parseClientDeposit(
  row: unknown,
  source: AltegioClientDepositSource,
): AltegioClientDeposit | null {
  const raw = asRecord(row);
  if (!raw) return null;

  const deposit = asRecord(raw.deposit) ?? raw;
  const depositId = Number(deposit.id ?? raw.id ?? raw.deposit_id);
  if (!Number.isFinite(depositId) || depositId <= 0) return null;

  const client =
    asRecord(raw.client) ??
    asRecord(deposit.client) ??
    asRecord(raw.user) ??
    asRecord(deposit.user);
  const depositType = asRecord(raw.deposit_type) ?? asRecord(deposit.deposit_type);

  const balance =
    asFiniteNumber(deposit.balance) ??
    asFiniteNumber(raw.balance) ??
    asFiniteNumber(raw.current_balance) ??
    0;

  const clientIdRaw = client?.id ?? deposit.user_id ?? raw.user_id ?? raw.client_id;
  const clientIdNum = Number(clientIdRaw);

  return {
    depositId,
    clientId: Number.isFinite(clientIdNum) && clientIdNum > 0 ? clientIdNum : null,
    clientName:
      String(client?.name ?? client?.display_name ?? client?.title ?? raw.client_name ?? "").trim() ||
      null,
    clientPhone: String(client?.phone ?? raw.phone ?? "").trim() || null,
    balance,
    initialBalance:
      asFiniteNumber(deposit.initial_balance) ?? asFiniteNumber(raw.initial_balance),
    blocked: Boolean(deposit.blocked ?? raw.blocked),
    depositTypeTitle:
      String(depositType?.title ?? depositType?.name ?? raw.deposit_type_title ?? "").trim() ||
      null,
    salonId: (() => {
      const salonId = Number(deposit.salon_id ?? raw.salon_id ?? raw.location_id);
      return Number.isFinite(salonId) && salonId > 0 ? salonId : null;
    })(),
    dateCreate: String(deposit.date_create ?? raw.date_create ?? "").trim() || null,
    source,
    raw,
  };
}

function parseClientBalanceRow(client: Client, source: AltegioClientDepositSource): AltegioClientDeposit | null {
  const clientId = Number(client.id);
  if (!Number.isFinite(clientId) || clientId <= 0) return null;

  const balance = asFiniteNumber(client.balance);
  if (balance == null) return null;

  return {
    depositId: clientId,
    clientId,
    clientName: String(client.name || "").trim() || null,
    clientPhone: String(client.phone ?? "").trim() || null,
    balance,
    initialBalance: null,
    blocked: false,
    depositTypeTitle: "Баланс клієнта (clients/search)",
    salonId: null,
    dateCreate: null,
    source,
    raw: client as RawRecord,
  };
}

async function fetchChainClientDepositsPage(params: {
  chainId: number;
  balanceFrom: number;
  balanceTo?: number;
  page: number;
  limit: number;
}): Promise<{ items: unknown[]; meta: RawRecord | null }> {
  const qs = new URLSearchParams();
  qs.set("balance_from", String(params.balanceFrom));
  if (params.balanceTo != null && Number.isFinite(params.balanceTo)) {
    qs.set("balance_to", String(params.balanceTo));
  }
  qs.set("page", String(params.page));
  qs.set("limit", String(params.limit));

  const path = `/deposits/chain/${params.chainId}?${qs.toString()}`;
  console.log(`[altegio/client-deposits] GET ${path}`);

  const raw = await altegioFetch<unknown>(path);
  return unwrapAltegioList(raw);
}

function isAltegioAccessDenied(err: unknown): boolean {
  return err instanceof AltegioHttpError && (err.status === 403 || err.status === 404);
}

async function probeDepositsChain(chainId: number, balanceFrom: number): Promise<boolean> {
  try {
    const qs = new URLSearchParams({
      balance_from: String(balanceFrom),
      page: "1",
      limit: "1",
    });
    await altegioFetch<unknown>(`/deposits/chain/${chainId}?${qs.toString()}`);
    return true;
  } catch (err) {
    if (isAltegioAccessDenied(err)) {
      const status = err instanceof AltegioHttpError ? err.status : "?";
      console.warn(`[altegio/client-deposits] chain_id=${chainId} → ${status} (пропускаємо)`);
      return false;
    }
    throw err;
  }
}

function hasMorePages(meta: RawRecord | null, page: number, limit: number, itemsCount: number): boolean {
  if (itemsCount <= 0) return false;
  if (itemsCount < limit) return false;

  const total = asFiniteNumber(meta?.total) ?? asFiniteNumber(meta?.total_count);
  const lastPage = asFiniteNumber(meta?.last_page) ?? asFiniteNumber(meta?.pages);
  const currentPage = asFiniteNumber(meta?.current_page) ?? asFiniteNumber(meta?.page);

  if (total != null && total > page * limit) return true;
  if (lastPage != null && page < lastPage) return true;
  if (currentPage != null && lastPage != null && currentPage < lastPage) return true;

  return itemsCount >= limit;
}

async function fetchDepositsFromChain(params: {
  chainId: number;
  balanceFrom: number;
  balanceTo?: number;
  limitPerPage: number;
  maxPages: number;
}): Promise<{ deposits: AltegioClientDeposit[]; pagesFetched: number }> {
  const byDepositId = new Map<number, AltegioClientDeposit>();
  let pagesFetched = 0;

  for (let page = 1; page <= params.maxPages; page += 1) {
    const { items, meta } = await fetchChainClientDepositsPage({
      chainId: params.chainId,
      balanceFrom: params.balanceFrom,
      balanceTo: params.balanceTo,
      page,
      limit: params.limitPerPage,
    });

    pagesFetched += 1;

    for (const row of items) {
      const parsed = parseClientDeposit(row, "deposits_chain");
      if (!parsed || parsed.balance < params.balanceFrom) continue;
      if (params.balanceTo != null && parsed.balance > params.balanceTo) continue;
      byDepositId.set(parsed.depositId, parsed);
    }

    console.log(
      `[altegio/client-deposits] chain ${params.chainId} сторінка ${page}: ${items.length} рядків, рахунків=${byDepositId.size}`,
    );

    if (!hasMorePages(meta, page, params.limitPerPage, items.length)) break;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  return {
    deposits: Array.from(byDepositId.values()).sort((a, b) => b.balance - a.balance),
    pagesFetched,
  };
}

type ClientsSearchStrategy = {
  name: string;
  buildBody: (page: number, pageSize: number, balanceFrom: number) => object;
};

const CLIENTS_SEARCH_STRATEGIES: ClientsSearchStrategy[] = [
  {
    name: "last_visit_date+balance",
    buildBody: (page, pageSize) => ({
      page,
      page_size: pageSize,
      fields: ["id", "name", "phone", "email", "balance"],
      order_by: "last_visit_date",
      order_by_direction: "desc",
    }),
  },
  {
    name: "id+balance",
    buildBody: (page, pageSize) => ({
      page,
      page_size: pageSize,
      fields: ["id", "name", "phone", "balance"],
      order_by: "id",
      order_by_direction: "desc",
    }),
  },
  {
    name: "balance_filter",
    buildBody: (page, pageSize, balanceFrom) => ({
      page,
      page_size: pageSize,
      fields: ["id", "name", "phone", "balance"],
      filters: [{ field: "balance", operation: "greater", value: balanceFrom }],
    }),
  },
  {
    name: "minimal+balance",
    buildBody: (page, pageSize) => ({
      page,
      page_size: pageSize,
      fields: ["id", "name", "phone", "balance"],
    }),
  },
];

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

async function pickClientsSearchStrategy(
  companyId: number,
  balanceFrom: number,
): Promise<ClientsSearchStrategy> {
  for (const strategy of CLIENTS_SEARCH_STRATEGIES) {
    try {
      const response = await altegioFetch<
        Client[] | { data?: Client[]; meta?: { total_count?: number; page?: number; page_size?: number } }
      >(`/company/${companyId}/clients/search`, {
        method: "POST",
        body: JSON.stringify(strategy.buildBody(1, 1, balanceFrom)),
      });
      parseClientsSearchResponse(response, 1);
      console.log(`[altegio/client-deposits] ✅ clients/search стратегія: ${strategy.name}`);
      return strategy;
    } catch (err) {
      if (err instanceof AltegioHttpError && err.status === 403) {
        console.warn(`[altegio/client-deposits] clients/search «${strategy.name}» → 403 Insufficient rights`);
        continue;
      }
      throw err;
    }
  }

  throw new Error(
    "Недостатньо прав Altegio для clients/search з полем balance (403). Перевірте права API-токена в маркетплейсі.",
  );
}

async function fetchClientsPageWithStrategy(
  companyId: number,
  strategy: ClientsSearchStrategy,
  page: number,
  pageSize: number,
  balanceFrom: number,
): Promise<{ clients: Client[]; hasMore: boolean }> {
  const response = await altegioFetch<
    Client[] | { data?: Client[]; meta?: { total_count?: number; page?: number; page_size?: number } }
  >(`/company/${companyId}/clients/search`, {
    method: "POST",
    body: JSON.stringify(strategy.buildBody(page, pageSize, balanceFrom)),
  });
  return parseClientsSearchResponse(response, pageSize);
}

async function fetchLocationClientDeposits(
  companyId: number,
  clientId: number,
): Promise<AltegioClientDeposit[]> {
  try {
    const raw = await altegioFetch<unknown>(`/deposits/company/${companyId}/client/${clientId}`);
    const { items } = unwrapAltegioList(raw);
    const parsed: AltegioClientDeposit[] = [];
    for (const row of items) {
      const deposit = parseClientDeposit(row, "deposits_location");
      if (deposit) parsed.push(deposit);
    }
    return parsed;
  } catch (err) {
    if (isAltegioAccessDenied(err)) return [];
    throw err;
  }
}

async function fetchPositiveBalancesFromClientsSearch(params: {
  companyId: number;
  balanceFrom: number;
  balanceTo?: number;
  limitPerPage: number;
  maxPages: number;
}): Promise<{ deposits: AltegioClientDeposit[]; pagesFetched: number; strategy: string }> {
  const strategy = await pickClientsSearchStrategy(params.companyId, params.balanceFrom);
  const byClientId = new Map<number, AltegioClientDeposit>();
  let pagesFetched = 0;

  for (let page = 1; page <= params.maxPages; page += 1) {
    const { clients, hasMore } = await fetchClientsPageWithStrategy(
      params.companyId,
      strategy,
      page,
      params.limitPerPage,
      params.balanceFrom,
    );
    pagesFetched += 1;

    if (clients.length === 0) break;

    for (const client of clients) {
      const parsed = parseClientBalanceRow(client, "clients_search");
      if (!parsed) continue;
      if (parsed.balance < params.balanceFrom) continue;
      if (params.balanceTo != null && parsed.balance > params.balanceTo) continue;
      byClientId.set(parsed.clientId!, parsed);
    }

    console.log(
      `[altegio/client-deposits] clients/search (${strategy.name}) сторінка ${page}: ${clients.length} клієнтів, з балансом=${byClientId.size}`,
    );

    if (!hasMore) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return {
    deposits: Array.from(byClientId.values()).sort((a, b) => b.balance - a.balance),
    pagesFetched,
    strategy: strategy.name,
  };
}

async function fetchPositiveBalancesFromLocationDeposits(params: {
  companyId: number;
  balanceFrom: number;
  balanceTo?: number;
  limitPerPage: number;
  maxPages: number;
}): Promise<{ deposits: AltegioClientDeposit[]; pagesFetched: number; clientsChecked: number }> {
  const byDepositId = new Map<number, AltegioClientDeposit>();
  let pagesFetched = 0;
  let clientsChecked = 0;
  const maxClients = Math.min(params.limitPerPage * params.maxPages, 200);

  for (let page = 1; page <= params.maxPages; page += 1) {
    const { clients, hasMore } = await getClientsPaginated(
      params.companyId,
      page,
      params.limitPerPage,
    );
    pagesFetched += 1;
    if (clients.length === 0) break;

    for (const client of clients) {
      if (clientsChecked >= maxClients) break;
      clientsChecked += 1;

      const clientId = Number(client.id);
      if (!Number.isFinite(clientId) || clientId <= 0) continue;

      const locationDeposits = await fetchLocationClientDeposits(params.companyId, clientId);
      for (const deposit of locationDeposits) {
        if (deposit.balance < params.balanceFrom) continue;
        if (params.balanceTo != null && deposit.balance > params.balanceTo) continue;
        byDepositId.set(deposit.depositId, deposit);
      }

      if (locationDeposits.length === 0) {
        const fromBalanceField = parseClientBalanceRow(client, "deposits_location");
        if (
          fromBalanceField &&
          fromBalanceField.balance >= params.balanceFrom &&
          (params.balanceTo == null || fromBalanceField.balance <= params.balanceTo)
        ) {
          byDepositId.set(fromBalanceField.depositId, fromBalanceField);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 80));
    }

    console.log(
      `[altegio/client-deposits] deposits/company fallback сторінка ${page}: перевірено ${clientsChecked} клієнтів, рахунків=${byDepositId.size}`,
    );

    if (clientsChecked >= maxClients || !hasMore) break;
  }

  return {
    deposits: Array.from(byDepositId.values()).sort((a, b) => b.balance - a.balance),
    pagesFetched,
    clientsChecked,
  };
}

/**
 * Отримує клієнтські рахунки з позитивним балансом.
 * 1) GET /deposits/chain/{chain_id} (пріоритет)
 * 2) Fallback: POST /company/{id}/clients/search + фільтр balance на нашому боці
 */
export async function fetchChainClientDeposits(
  params: FetchChainClientDepositsParams = {},
): Promise<FetchChainClientDepositsResult> {
  const companyId = resolveCompanyId(params.companyId);
  const balanceFrom = params.balanceFrom ?? 0.01;
  const balanceTo = params.balanceTo;
  const limitPerPage = Math.min(Math.max(params.limitPerPage ?? 200, 1), 500);
  const maxPages = Math.min(Math.max(params.maxPages ?? 50, 1), 200);

  const chainCandidates = await resolveAltegioChainCandidates(params.chainId);
  let workingChainId: number | null = null;

  for (const candidate of chainCandidates) {
    if (await probeDepositsChain(candidate, balanceFrom)) {
      workingChainId = candidate;
      break;
    }
  }

  if (workingChainId != null) {
    try {
      const chainResult = await fetchDepositsFromChain({
        chainId: workingChainId,
        balanceFrom,
        balanceTo,
        limitPerPage,
        maxPages,
      });
      const totalBalance = chainResult.deposits.reduce((sum, item) => sum + item.balance, 0);

      console.log(
        `[altegio/client-deposits] ✅ deposits/chain chain=${workingChainId}: рахунків=${chainResult.deposits.length}, сума=${Math.round(totalBalance * 100) / 100} грн`,
      );

      return {
        chainId: workingChainId,
        companyId,
        source: "deposits_chain",
        chainCandidatesTried: chainCandidates,
        balanceFrom,
        balanceTo: balanceTo ?? null,
        totalDeposits: chainResult.deposits.length,
        totalBalance: Math.round(totalBalance * 100) / 100,
        pagesFetched: chainResult.pagesFetched,
        deposits: chainResult.deposits,
      };
    } catch (err) {
      if (!isAltegioAccessDenied(err)) throw err;
      console.warn(
        `[altegio/client-deposits] ⚠️ deposits/chain chain=${workingChainId} заборонено (403/404), fallback`,
      );
    }
  }

  console.warn(
    `[altegio/client-deposits] ⚠️ deposits/chain недоступний для кандидатів [${chainCandidates.join(", ")}]; fallback clients/search company=${companyId}`,
  );

  try {
    const searchResult = await fetchPositiveBalancesFromClientsSearch({
      companyId,
      balanceFrom,
      balanceTo,
      limitPerPage,
      maxPages,
    });
    const totalBalance = searchResult.deposits.reduce((sum, item) => sum + item.balance, 0);

    console.log(
      `[altegio/client-deposits] ✅ clients/search (${searchResult.strategy}): клієнтів=${searchResult.deposits.length}, сума=${Math.round(totalBalance * 100) / 100} грн`,
    );

    return {
      chainId: workingChainId,
      companyId,
      source: "clients_search",
      chainCandidatesTried: chainCandidates,
      balanceFrom,
      balanceTo: balanceTo ?? null,
      totalDeposits: searchResult.deposits.length,
      totalBalance: Math.round(totalBalance * 100) / 100,
      pagesFetched: searchResult.pagesFetched,
      deposits: searchResult.deposits,
    };
  } catch (err) {
    if (!(err instanceof AltegioHttpError && err.status === 403) && !(err instanceof Error && err.message.includes("403"))) {
      throw err;
    }
    console.warn(
      `[altegio/client-deposits] ⚠️ clients/search заборонено; fallback deposits/company/{location}/client/{id}`,
    );
  }

  const locationResult = await fetchPositiveBalancesFromLocationDeposits({
    companyId,
    balanceFrom,
    balanceTo,
    limitPerPage: Math.min(limitPerPage, 100),
    maxPages,
  });
  const totalBalance = locationResult.deposits.reduce((sum, item) => sum + item.balance, 0);

  if (locationResult.deposits.length === 0) {
    throw new Error(
      "Недостатньо прав Altegio (403) для deposits/chain і clients/search. Увімкніть права на клієнтські рахунки (deposits) у маркетплейсі або використайте токен з правами рівня мережі.",
    );
  }

  console.log(
    `[altegio/client-deposits] ✅ deposits/company fallback: клієнтів перевірено=${locationResult.clientsChecked}, рахунків=${locationResult.deposits.length}, сума=${Math.round(totalBalance * 100) / 100} грн`,
  );

  return {
    chainId: workingChainId,
    companyId,
    source: "deposits_location",
    chainCandidatesTried: chainCandidates,
    balanceFrom,
    balanceTo: balanceTo ?? null,
    totalDeposits: locationResult.deposits.length,
    totalBalance: Math.round(totalBalance * 100) / 100,
    pagesFetched: locationResult.pagesFetched,
    deposits: locationResult.deposits,
  };
}

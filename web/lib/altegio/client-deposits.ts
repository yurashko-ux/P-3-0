import { altegioFetch, AltegioHttpError } from "./client";
import { getCompany } from "./companies";
import { getClient } from "./clients";
import { fetchClientCardBalanceByClientId } from "./client-balances";
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
  /** Включити рахунки з балансом 0 (модуль «Рахунки клієнта»). */
  includeZeroBalance?: boolean;
  limitPerPage?: number;
  maxPages?: number;
  /** Скільки клієнтів максимум перевірити в deposits/company fallback. */
  maxClientsToScan?: number;
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
  clientsChecked?: number;
  locationDepositsForbidden?: number;
  locationDepositsEmpty?: number;
  clientsWithAccounts?: number;
  includeZeroBalance?: boolean;
  clientsSearchStrategy?: string;
  balanceFieldMissingInSearch?: boolean;
  deposits: AltegioClientDeposit[];
};

export type ClientDepositsHttpProbe = {
  path: string;
  httpStatus: number | null;
  message: string;
  itemsCount?: number;
};

export type ClientDepositsDiagnostics = {
  companyId: number;
  chainCandidates: number[];
  userPermissions: {
    clients_deposits_access?: boolean;
    clients_deposits_create_access?: boolean;
    clients_deposits_history_access?: boolean;
    clients_deposits_topup_access?: boolean;
    fetchError?: string;
  } | null;
  chainProbes: Array<ClientDepositsHttpProbe & { chainId: number }>;
  locationProbe: (ClientDepositsHttpProbe & { clientId: number }) | null;
  recommendations: string[];
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

function extractClientBalance(client: Client | RawRecord): number | null {
  const raw = client as RawRecord;
  const directKeys = [
    "balance",
    "client_balance",
    "deposit_balance",
    "deposits_balance",
    "account_balance",
    "money_balance",
    "paid_balance",
  ];

  for (const key of directKeys) {
    const value = asFiniteNumber(raw[key]);
    if (value != null) return value;
  }

  const depositAccounts = raw.deposit_accounts ?? raw.deposits ?? raw.accounts;
  if (Array.isArray(depositAccounts)) {
    let sum = 0;
    let hasAny = false;
    for (const row of depositAccounts) {
      const rec = asRecord(row);
      const deposit = asRecord(rec?.deposit) ?? rec;
      const value =
        asFiniteNumber(deposit?.balance) ??
        asFiniteNumber(rec?.balance) ??
        asFiniteNumber(row);
      if (value != null) {
        sum += value;
        hasAny = true;
      }
    }
    if (hasAny) return sum;
  }

  const singleDeposit = asRecord(raw.deposit);
  if (singleDeposit) {
    const value = asFiniteNumber(singleDeposit.balance);
    if (value != null) return value;
  }

  return null;
}

function unwrapDepositsPayload(raw: unknown): unknown[] {
  const fromList = unwrapAltegioList(raw);
  if (fromList.items.length > 0) return fromList.items;

  const root = asRecord(raw);
  const data = asRecord(root?.data) ?? root;
  if (!data) return [];

  for (const key of ["deposits", "deposit_accounts", "accounts", "items"]) {
    const nested = data[key];
    if (Array.isArray(nested) && nested.length > 0) return nested;
  }

  if (asRecord(data.deposit)) return [data.deposit];
  if (data.id != null && data.balance != null) return [data];

  return [];
}

function enrichDepositWithClient(deposit: AltegioClientDeposit, client: Client): AltegioClientDeposit {
  const clientId = Number(client.id);
  return {
    ...deposit,
    clientId:
      deposit.clientId ??
      (Number.isFinite(clientId) && clientId > 0 ? clientId : null),
    clientName: deposit.clientName ?? (String(client.name || "").trim() || null),
    clientPhone: deposit.clientPhone ?? (String(client.phone ?? "").trim() || null),
  };
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

  const clientIdRaw =
    client?.id ??
    deposit.user_id ??
    raw.user_id ??
    deposit.client_id ??
    raw.client_id;
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

  const balance = extractClientBalance(client);
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

function extractAltegioErrorMessage(err: AltegioHttpError): string {
  try {
    const parsed = JSON.parse(err.responseBody) as { meta?: { message?: string }; error?: string };
    return String(parsed?.meta?.message ?? parsed?.error ?? err.responseBody).slice(0, 300);
  } catch {
    return err.responseBody.slice(0, 300) || err.message;
  }
}

async function probeDepositsHttp(path: string): Promise<ClientDepositsHttpProbe> {
  try {
    const raw = await altegioFetch<unknown>(path);
    const items = unwrapDepositsPayload(raw);
    return { path, httpStatus: 200, message: "OK", itemsCount: items.length };
  } catch (err) {
    if (err instanceof AltegioHttpError) {
      return {
        path,
        httpStatus: err.status,
        message: extractAltegioErrorMessage(err),
      };
    }
    return {
      path,
      httpStatus: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Швидка діагностика: права user token + пробні виклики deposits/chain та deposits/company.
 * Не перебирає сотні клієнтів — ~3–5 запитів до Altegio.
 */
export async function diagnoseClientDepositsAccess(params?: {
  chainId?: number;
  companyId?: number;
}): Promise<ClientDepositsDiagnostics> {
  const companyId = resolveCompanyId(params?.companyId);
  const chainCandidates = await resolveAltegioChainCandidates(params?.chainId);
  const recommendations: string[] = [];

  let userPermissions: ClientDepositsDiagnostics["userPermissions"] = null;
  try {
    const raw = await altegioFetch<unknown>(`/user/permissions/${companyId}`);
    const data = asRecord(asRecord(raw)?.data) ?? asRecord(raw);
    const clients = asRecord(data?.clients) ?? data;
    userPermissions = {
      clients_deposits_access: Boolean(clients?.clients_deposits_access),
      clients_deposits_create_access: Boolean(clients?.clients_deposits_create_access),
      clients_deposits_history_access: Boolean(clients?.clients_deposits_history_access),
      clients_deposits_topup_access: Boolean(clients?.clients_deposits_topup_access),
    };
  } catch (err) {
    userPermissions = {
      fetchError: err instanceof Error ? err.message : String(err),
    };
  }

  const chainProbes: ClientDepositsDiagnostics["chainProbes"] = [];
  for (const chainId of chainCandidates.slice(0, 2)) {
    const probe = await probeDepositsHttp(
      `/deposits/chain/${chainId}?balance_from=0.01&page=1&limit=1`,
    );
    chainProbes.push({ chainId, ...probe });
  }

  let locationProbe: ClientDepositsDiagnostics["locationProbe"] = null;
  try {
    const { clients } = await getClientsPaginated(companyId, 1, 1);
    const clientId = Number(clients[0]?.id);
    if (Number.isFinite(clientId) && clientId > 0) {
      const probe = await probeDepositsHttp(`/deposits/company/${companyId}/client/${clientId}`);
      locationProbe = { clientId, ...probe };
    }
  } catch (err) {
    locationProbe = {
      clientId: 0,
      path: `/deposits/company/${companyId}/client/{id}`,
      httpStatus: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const chainForbidden = chainProbes.every((p) => p.httpStatus === 403 || p.httpStatus === 404);
  const locationForbidden = locationProbe?.httpStatus === 403 || locationProbe?.httpStatus === 404;

  if (userPermissions?.clients_deposits_access === false) {
    recommendations.push(
      "У ролі користувача User Token немає clients_deposits_access — увімкніть «Рахунки клієнта» в Налаштування → Права доступу (не лише в маркетплейсі).",
    );
  }

  if (chainForbidden) {
    recommendations.push(
      `deposits/chain повертає 403/404 для chain_id [${chainCandidates.join(", ")}]. Потрібен доступ на рівні мережі (salon_group) + прив’язка користувача токена до мережі.`,
    );
  }

  if (locationForbidden) {
    recommendations.push(
      "deposits/company повертає 403/404 — права маркетплейсу увімкнені, але User Token не має доступу до перегляду рахунків у філії.",
    );
  }

  if (
    userPermissions?.clients_deposits_access !== false &&
    !chainForbidden &&
    !locationForbidden &&
    chainProbes.every((p) => p.httpStatus === 200 && (p.itemsCount ?? 0) === 0) &&
    locationProbe?.httpStatus === 200 &&
    (locationProbe.itemsCount ?? 0) === 0
  ) {
    recommendations.push(
      "API відповідає 200, але рахунків з балансом ≥ 0.01 не знайдено — перевірте в UI Altegio, чи є клієнти з позитивним балансом.",
    );
  }

  recommendations.push(
    "Після зміни прав у маркетплейсі Altegio перевидати User Token (API Access) і оновити ALTEGIO_USER_TOKEN у Vercel.",
  );

  if (userPermissions?.clients_deposits_access === true && locationProbe?.httpStatus === 200) {
    recommendations.push(
      "deposits/company працює — для списку як у UI «Рахунки клієнта» використовуйте includeZeroBalance=1 (баланс 0 теж включається). deposits/chain недоступний — потрібен обхід по клієнтах.",
    );
    // прибрати загальну пораду про токен, якщо права вже є
    const tokenIdx = recommendations.findIndex((r) => r.includes("перевидати User Token"));
    if (tokenIdx >= 0) recommendations.splice(tokenIdx, 1);
  }

  console.log("[altegio/client-deposits] diagnose:", {
    companyId,
    chainCandidates,
    userPermissions,
    chainProbes: chainProbes.map((p) => ({ chainId: p.chainId, status: p.httpStatus, msg: p.message })),
    locationProbe,
  });

  return {
    companyId,
    chainCandidates,
    userPermissions,
    chainProbes,
    locationProbe,
    recommendations,
  };
}

function buildClientDepositsFailureMessage(
  chainCandidates: number[],
  locationStats: { clientsChecked: number; forbidden: number; empty: number },
  diagnostics: ClientDepositsDiagnostics,
): string {
  const parts = [
    `Клієнтські рахунки не знайдено.`,
    `chain_id=${chainCandidates.join(", ")}: ${diagnostics.chainProbes.map((p) => `HTTP ${p.httpStatus ?? "?"}`).join(", ") || "недоступний"}.`,
    `deposits/company: перевірено ${locationStats.clientsChecked} клієнтів (403=${locationStats.forbidden}, порожньо=${locationStats.empty}).`,
  ];

  if (diagnostics.userPermissions?.clients_deposits_access === false) {
    parts.push("User token: clients_deposits_access=false.");
  } else if (diagnostics.userPermissions?.clients_deposits_access === true) {
    parts.push("User token: clients_deposits_access=true.");
  }

  if (locationStats.forbidden >= 5 || diagnostics.chainProbes.every((p) => p.httpStatus === 403)) {
    parts.push(
      "Права в маркетплейсі ≠ права User Token: перевидати токен після увімкнення deposits або перевірити роль користувача в філії/мережі.",
    );
  }

  return parts.join(" ");
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
    name: "all_fields+last_visit",
    buildBody: (page, pageSize) => ({
      page,
      page_size: pageSize,
      order_by: "last_visit_date",
      order_by_direction: "desc",
    }),
  },
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
): Promise<{ deposits: AltegioClientDeposit[]; accessDenied: boolean }> {
  const paths = [
    `/deposits/company/${companyId}/client/${clientId}`,
    `/company/${companyId}/client/${clientId}/deposits`,
  ];

  let accessDenied = false;

  for (const path of paths) {
    try {
      const raw = await altegioFetch<unknown>(path);
      const parsed: AltegioClientDeposit[] = [];
      for (const row of unwrapDepositsPayload(raw)) {
        const deposit = parseClientDeposit(row, "deposits_location");
        if (deposit) parsed.push(deposit);
      }
      if (parsed.length > 0) return { deposits: parsed, accessDenied: false };
    } catch (err) {
      if (isAltegioAccessDenied(err)) {
        accessDenied = true;
        continue;
      }
      throw err;
    }
  }

  return { deposits: [], accessDenied };
}

function phoneCandidatesForDepositsApi(phone: string): string[] {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  const candidates = [trimmed];
  if (digits) candidates.push(digits);
  if (digits.length === 12 && digits.startsWith("380")) {
    candidates.push(`+${digits}`);
  }
  return [...new Set(candidates.filter(Boolean))];
}

/** GET /deposits/chain/{chain_id}/phone/{phone} — усі депозитні рахунки клієнта в мережі. */
async function fetchChainClientDepositsByPhone(
  chainId: number,
  phone: string,
): Promise<AltegioClientDeposit[]> {
  for (const phoneValue of phoneCandidatesForDepositsApi(phone)) {
    const path = `/deposits/chain/${chainId}/phone/${encodeURIComponent(phoneValue)}`;
    try {
      const raw = await altegioFetch<unknown>(path);
      const parsed: AltegioClientDeposit[] = [];
      for (const row of unwrapDepositsPayload(raw)) {
        const deposit = parseClientDeposit(row, "deposits_chain");
        if (deposit) parsed.push(deposit);
      }
      if (parsed.length > 0) return parsed;
    } catch (err) {
      if (isAltegioAccessDenied(err)) continue;
      console.warn(`[altegio/client-deposits] chain phone ${phoneValue}:`, err);
    }
  }
  return [];
}

async function fetchPositiveBalancesFromClientsSearch(params: {
  companyId: number;
  balanceFrom: number;
  balanceTo?: number;
  limitPerPage: number;
  maxPages: number;
}): Promise<{
  deposits: AltegioClientDeposit[];
  pagesFetched: number;
  strategy: string;
  balanceFieldMissing: boolean;
}> {
  const strategy = await pickClientsSearchStrategy(params.companyId, params.balanceFrom);
  const byClientId = new Map<number, AltegioClientDeposit>();
  let pagesFetched = 0;
  let balanceFieldMissing = false;

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

    let balanceFieldHits = 0;
    for (const client of clients) {
      if (extractClientBalance(client) != null) balanceFieldHits += 1;
      const parsed = parseClientBalanceRow(client, "clients_search");
      if (!parsed) continue;
      if (parsed.balance < params.balanceFrom) continue;
      if (params.balanceTo != null && parsed.balance > params.balanceTo) continue;
      byClientId.set(parsed.clientId!, parsed);
    }

    if (page === 1 && clients.length > 0 && balanceFieldHits === 0) {
      balanceFieldMissing = true;
      console.warn(
        `[altegio/client-deposits] clients/search (${strategy.name}): поле balance відсутнє у відповіді API — переходимо до deposits/company`,
      );
      break;
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
    balanceFieldMissing,
  };
}

async function fetchPositiveBalancesFromLocationDeposits(params: {
  companyId: number;
  balanceFrom: number;
  balanceTo?: number;
  includeZeroBalance: boolean;
  limitPerPage: number;
  maxPages: number;
  maxClientsToScan: number;
}): Promise<{
  deposits: AltegioClientDeposit[];
  pagesFetched: number;
  clientsChecked: number;
  forbidden: number;
  empty: number;
  clientsWithAccounts: number;
}> {
  const byDepositId = new Map<number, AltegioClientDeposit>();
  let pagesFetched = 0;
  let clientsChecked = 0;
  let forbidden = 0;
  let empty = 0;
  let clientsWithAccounts = 0;
  let consecutiveForbidden = 0;
  const maxClients = Math.min(params.limitPerPage * params.maxPages, params.maxClientsToScan);

  const passesBalanceFilter = (balance: number): boolean => {
    if (params.includeZeroBalance) {
      if (params.balanceTo != null && balance > params.balanceTo) return false;
      return true;
    }
    if (balance < params.balanceFrom) return false;
    if (params.balanceTo != null && balance > params.balanceTo) return false;
    return true;
  };

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

      const { deposits: locationDeposits, accessDenied } = await fetchLocationClientDeposits(
        params.companyId,
        clientId,
      );

      if (accessDenied && locationDeposits.length === 0) {
        forbidden += 1;
        consecutiveForbidden += 1;
      } else if (locationDeposits.length === 0) {
        empty += 1;
        consecutiveForbidden = 0;
      } else {
        clientsWithAccounts += 1;
        consecutiveForbidden = 0;
      }

      for (const deposit of locationDeposits) {
        const enriched = enrichDepositWithClient(deposit, client);
        if (!passesBalanceFilter(enriched.balance)) continue;
        byDepositId.set(enriched.depositId, enriched);
      }

      if (locationDeposits.length === 0) {
        const fromBalanceField = parseClientBalanceRow(client, "deposits_location");
        if (fromBalanceField && passesBalanceFilter(fromBalanceField.balance)) {
          byDepositId.set(fromBalanceField.depositId, fromBalanceField);
        }
      }

      if (consecutiveForbidden >= 5) {
        console.warn(
          `[altegio/client-deposits] deposits/company: 5 поспіль 403 — зупиняємо (немає прав на перегляд рахунків)`,
        );
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 60));
    }

    console.log(
      `[altegio/client-deposits] deposits/company fallback сторінка ${page}: перевірено ${clientsChecked} клієнтів, з рахунками=${clientsWithAccounts}, 403=${forbidden}, без рахунків=${empty}, записів=${byDepositId.size}`,
    );

    if (consecutiveForbidden >= 5 || clientsChecked >= maxClients || !hasMore) break;
  }

  return {
    deposits: Array.from(byDepositId.values()).sort((a, b) => b.balance - a.balance),
    pagesFetched,
    clientsChecked,
    forbidden,
    empty,
    clientsWithAccounts,
  };
}

/**
 * Отримує клієнтські рахунки з позитивним балансом.
 * 1) GET /deposits/chain/{chain_id} (пріоритет)
 * 2) Fallback: GET /deposits/company/{location_id}/client/{client_id}
 */
export async function fetchChainClientDeposits(
  params: FetchChainClientDepositsParams = {},
): Promise<FetchChainClientDepositsResult> {
  const companyId = resolveCompanyId(params.companyId);
  const includeZeroBalance = params.includeZeroBalance === true;
  const balanceFrom = includeZeroBalance ? 0 : (params.balanceFrom ?? 0.01);
  const balanceTo = params.balanceTo;
  const limitPerPage = Math.min(Math.max(params.limitPerPage ?? 200, 1), 500);
  const maxPages = Math.min(Math.max(params.maxPages ?? 50, 1), 200);
  const maxClientsToScan = Math.min(
    Math.max(params.maxClientsToScan ?? (includeZeroBalance ? 3000 : 400), 1),
    10000,
  );

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
    `[altegio/client-deposits] ⚠️ deposits/chain недоступний для кандидатів [${chainCandidates.join(", ")}]; fallback deposits/company company=${companyId}`,
  );

  const locationResult = await fetchPositiveBalancesFromLocationDeposits({
    companyId,
    balanceFrom,
    balanceTo,
    includeZeroBalance,
    limitPerPage: Math.min(limitPerPage, includeZeroBalance ? 100 : 50),
    maxPages: Math.min(maxPages, includeZeroBalance ? 100 : 30),
    maxClientsToScan,
  });
  const totalBalance = locationResult.deposits.reduce((sum, item) => sum + item.balance, 0);

  if (locationResult.deposits.length === 0) {
    const diagnostics = await diagnoseClientDepositsAccess({
      chainId: params.chainId,
      companyId,
    });
    const extra =
      locationResult.clientsWithAccounts > 0
        ? ` Знайдено ${locationResult.clientsWithAccounts} клієнтів з рахунками, але жоден не пройшов фільтр balanceFrom=${balanceFrom}.`
        : locationResult.clientsChecked >= maxClientsToScan
          ? ` Перевірено ${locationResult.clientsChecked} клієнтів (ліміт). Збільште maxClientsToScan або увімкніть includeZeroBalance=1.`
          : "";
    const err = new Error(
      buildClientDepositsFailureMessage(
        chainCandidates,
        {
          clientsChecked: locationResult.clientsChecked,
          forbidden: locationResult.forbidden,
          empty: locationResult.empty,
        },
        diagnostics,
      ) + extra,
    ) as Error & { diagnostics?: ClientDepositsDiagnostics };
    err.diagnostics = diagnostics;
    throw err;
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
    clientsChecked: locationResult.clientsChecked,
    locationDepositsForbidden: locationResult.forbidden,
    locationDepositsEmpty: locationResult.empty,
    clientsWithAccounts: locationResult.clientsWithAccounts,
    includeZeroBalance,
    deposits: locationResult.deposits,
  };
}

async function resolveClientCardBalanceDeposit(
  companyId: number,
  clientId: number,
): Promise<AltegioClientDeposit | null> {
  const fromSearch = await fetchClientCardBalanceByClientId(companyId, clientId).catch(() => null);
  if (fromSearch) {
    const parsed = parseClientBalanceRow(fromSearch, "deposits_location");
    if (parsed) return parsed;
  }

  const client = await getClient(companyId, clientId).catch(() => null);
  if (!client) return null;
  return parseClientBalanceRow(client, "deposits_location");
}

function sumPositiveDepositBalance(deposits: AltegioClientDeposit[]): number {
  return deposits
    .filter((item) => item.balance > 0)
    .reduce((sum, item) => sum + item.balance, 0);
}

async function fetchClientDepositsWithBalanceFallback(
  companyId: number,
  clientId: number,
): Promise<AltegioClientDeposit[]> {
  const { deposits: locationDeposits } = await fetchLocationClientDeposits(companyId, clientId);
  const client = await getClient(companyId, clientId).catch(() => null);

  let enriched: AltegioClientDeposit[] = [];
  if (locationDeposits.length > 0) {
    enriched = locationDeposits.map((deposit) =>
      client
        ? enrichDepositWithClient(deposit, client)
        : { ...deposit, clientId: deposit.clientId ?? clientId },
    );
  }

  if (sumPositiveDepositBalance(enriched) > 0) {
    return enriched;
  }

  const phone = client?.phone?.trim();
  if (phone) {
    try {
      const chainCandidates = await resolveAltegioChainCandidates();
      for (const chainId of chainCandidates) {
        const byPhone = await fetchChainClientDepositsByPhone(chainId, phone);
        const enrichedPhone = byPhone.map((deposit) =>
          client
            ? enrichDepositWithClient(deposit, client)
            : { ...deposit, clientId: deposit.clientId ?? clientId },
        );
        if (sumPositiveDepositBalance(enrichedPhone) > 0) {
          return enrichedPhone;
        }
        if (enrichedPhone.length > 0 && enriched.length === 0) {
          enriched = enrichedPhone;
        }
      }
    } catch (err) {
      console.warn(`[altegio/client-deposits] chain phone fallback clientId=${clientId}:`, err);
    }
  }

  if (sumPositiveDepositBalance(enriched) > 0) {
    return enriched;
  }

  // Останній fallback — balance з картки клієнта (clients/search).
  const fromCard = await resolveClientCardBalanceDeposit(companyId, clientId);
  if (fromCard != null && fromCard.balance > 0) {
    return [fromCard];
  }

  if (enriched.length > 0) return enriched;
  return fromCard ? [fromCard] : [];
}

/**
 * Швидке завантаження балансів лише для відомих clientId (вкладка ЗАВДАТКИ).
 */
export async function fetchDepositsForClientIds(params: {
  clientIds: number[];
  companyId?: number;
  concurrency?: number;
}): Promise<{
  deposits: AltegioClientDeposit[];
  totalBalance: number;
  clientsFetched: number;
  errors: string[];
}> {
  const companyId = resolveCompanyId(params.companyId);
  const uniqueIds = [...new Set(params.clientIds.filter((id) => Number.isFinite(id) && id > 0))];
  const concurrency = Math.min(Math.max(params.concurrency ?? 6, 1), 12);
  const deposits: AltegioClientDeposit[] = [];
  const errors: string[] = [];

  for (let index = 0; index < uniqueIds.length; index += concurrency) {
    const batch = uniqueIds.slice(index, index + concurrency);
    await Promise.all(
      batch.map(async (clientId) => {
        try {
          const clientDeposits = await fetchClientDepositsWithBalanceFallback(companyId, clientId);
          if (clientDeposits.length === 0) return;
          deposits.push(...clientDeposits);
        } catch (err) {
          errors.push(`clientId=${clientId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    );
  }

  const totalBalance = deposits.reduce((sum, item) => sum + item.balance, 0);
  return {
    deposits,
    totalBalance: Math.round(totalBalance * 100) / 100,
    clientsFetched: uniqueIds.length,
    errors,
  };
}

import { altegioFetch } from "./client";
import { getCompany } from "./companies";

type RawRecord = Record<string, unknown>;

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
  raw: RawRecord;
};

export type FetchChainClientDepositsParams = {
  chainId?: number;
  balanceFrom?: number;
  balanceTo?: number;
  limitPerPage?: number;
  maxPages?: number;
};

export type FetchChainClientDepositsResult = {
  chainId: number;
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

function parseClientDeposit(row: unknown): AltegioClientDeposit | null {
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
    dateCreate:
      String(deposit.date_create ?? raw.date_create ?? "").trim() || null,
    raw,
  };
}

/**
 * Визначає chain_id (мережу) для deposits API.
 * Пріоритет: ALTEGIO_CHAIN_ID → поля company (salon_group_id, business_group_id, …).
 */
export async function resolveAltegioChainId(): Promise<number> {
  const fromEnv = process.env.ALTEGIO_CHAIN_ID?.trim();
  if (fromEnv) {
    const chainId = Number(fromEnv);
    if (Number.isFinite(chainId) && chainId > 0) return chainId;
    throw new Error(`Невірний ALTEGIO_CHAIN_ID: ${fromEnv}`);
  }

  const companyIdStr = process.env.ALTEGIO_COMPANY_ID?.trim();
  if (!companyIdStr) {
    throw new Error(
      "Потрібен ALTEGIO_CHAIN_ID або ALTEGIO_COMPANY_ID для отримання клієнтських балансів",
    );
  }

  const companyId = Number(companyIdStr);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    throw new Error(`Невірний ALTEGIO_COMPANY_ID: ${companyIdStr}`);
  }

  const company = await getCompany(companyId);
  if (!company) {
    throw new Error(`Компанія Altegio ${companyId} не знайдена`);
  }

  const raw = company as RawRecord;
  const groupRaw = asRecord(raw.business_group) ?? asRecord(raw.main_group) ?? asRecord(raw.salon_group);
  const candidates = [
    raw.salon_group_id,
    raw.business_group_id,
    raw.main_group_id,
    raw.group_id,
    groupRaw?.id,
  ];

  for (const candidate of candidates) {
    const chainId = Number(candidate);
    if (Number.isFinite(chainId) && chainId > 0) {
      console.log(
        `[altegio/client-deposits] chain_id=${chainId} визначено автоматично з company ${companyId}`,
      );
      return chainId;
    }
  }

  throw new Error(
    `Не вдалося визначити chain_id для company ${companyId}. Додайте ALTEGIO_CHAIN_ID у Vercel.`,
  );
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

function hasMorePages(meta: RawRecord | null, page: number, limit: number, itemsCount: number): boolean {
  if (itemsCount <= 0) return false;
  if (itemsCount < limit) return false;

  const total = asFiniteNumber(meta?.total) ?? asFiniteNumber(meta?.total_count);
  const lastPage = asFiniteNumber(meta?.last_page) ?? asFiniteNumber(meta?.pages);
  const currentPage = asFiniteNumber(meta?.current_page) ?? asFiniteNumber(meta?.page);

  if (total != null && total > page * limit) return true;
  if (lastPage != null && page < lastPage) return true;
  if (currentPage != null && lastPage != null && currentPage < lastPage) return true;

  // Якщо meta немає, але сторінка повна — пробуємо наступну
  return itemsCount >= limit;
}

/**
 * Отримує клієнтські рахунки (депозити) мережі з позитивним балансом.
 * API: GET /deposits/chain/{chain_id}?balance_from=…&page=…&limit=…
 */
export async function fetchChainClientDeposits(
  params: FetchChainClientDepositsParams = {},
): Promise<FetchChainClientDepositsResult> {
  const chainId = params.chainId ?? (await resolveAltegioChainId());
  const balanceFrom = params.balanceFrom ?? 0.01;
  const balanceTo = params.balanceTo;
  const limitPerPage = Math.min(Math.max(params.limitPerPage ?? 200, 1), 500);
  const maxPages = Math.min(Math.max(params.maxPages ?? 50, 1), 200);

  const byDepositId = new Map<number, AltegioClientDeposit>();
  let pagesFetched = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const { items, meta } = await fetchChainClientDepositsPage({
      chainId,
      balanceFrom,
      balanceTo,
      page,
      limit: limitPerPage,
    });

    pagesFetched += 1;

    for (const row of items) {
      const parsed = parseClientDeposit(row);
      if (!parsed || parsed.balance < balanceFrom) continue;
      if (balanceTo != null && parsed.balance > balanceTo) continue;
      byDepositId.set(parsed.depositId, parsed);
    }

    console.log(
      `[altegio/client-deposits] Сторінка ${page}: отримано ${items.length} рядків, унікальних рахунків: ${byDepositId.size}`,
    );

    if (!hasMorePages(meta, page, limitPerPage, items.length)) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  const deposits = Array.from(byDepositId.values()).sort((a, b) => b.balance - a.balance);
  const totalBalance = deposits.reduce((sum, item) => sum + item.balance, 0);

  console.log(
    `[altegio/client-deposits] Підсумок chain=${chainId}: рахунків=${deposits.length}, сума балансів=${Math.round(totalBalance * 100) / 100} грн, сторінок=${pagesFetched}`,
  );

  return {
    chainId,
    balanceFrom,
    balanceTo: balanceTo ?? null,
    totalDeposits: deposits.length,
    totalBalance: Math.round(totalBalance * 100) / 100,
    pagesFetched,
    deposits,
  };
}

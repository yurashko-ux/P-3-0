// Форма відповіді дашборду власника. Спільна для API і сторінки.

/** paid — є чек; free — безкоштовна консультація відбулась; no_check — прийшов, чека немає;
 *  no_show — не прийшов; planned — ще попереду; unmarked — день минув, а статус не поставили. */
export type VisitStatus = "paid" | "free" | "no_check" | "no_show" | "planned" | "unmarked";

export type AccountKind = "cash" | "bank" | "deposit" | "unknown";

export type DashboardAccountRow = {
  title: string;
  kind: AccountKind;
  currency: string;
  amountUah: number;
  /** Сума у валюті рахунку; null — в оплаті її не записано. */
  amountFx: number | null;
};

export type DashboardTitleRow = { title: string; count: number; sum: number };

export type DashboardMasterRow = {
  name: string;
  visits: number;
  sum: number;
  bookedMin: number;
  shiftMin: number;
  /** Частка зайнятого часу зміни 0..1; null — графіка на період немає. */
  load: number | null;
};

export type DashboardVisitRow = {
  id: string;
  day: string;
  time: string;
  client: string;
  master: string;
  services: string[];
  goods: string[];
  sum: number;
  payments: string[];
  status: VisitStatus;
  isConsultation: boolean;
};

export type DashboardStorageRow = {
  title: string;
  /** Оцінка в грн: волосся з доларовою ціною — за робочим курсом дня, решта — за обліковою собівартістю. */
  valueUah: number;
  /** Сума волосся в доларах; null — на складі немає волосся з доларовою ціною. */
  valueUsd: number | null;
  saleUah: number;
  positions: number;
  missingCost: number;
};

export type DashboardData = {
  ok: true;
  period: { from: string; to: string; days: number; today: string; isFuture: boolean; includesToday: boolean };
  fx: { usd: number | null; eur: number | null; day: string | null };
  revenue: { total: number; services: number; goods: number; clients: number; checks: number; avgCheck: number | null };
  paid: { total: number; cash: number; bank: number; deposit: number; unknown: number; debt: number };
  accounts: DashboardAccountRow[];
  income: { total: number; goodsCost: number; hairCost: number; missingCostLines: number };
  visits: {
    total: number;
    clients: number;
    paid: number;
    free: number;
    noCheck: number;
    noShow: number;
    planned: number;
    unmarked: number;
  };
  planned: { count: number; clients: number; servicesSum: number };
  servicesDone: DashboardTitleRow[];
  servicesPlanned: DashboardTitleRow[];
  goods: DashboardTitleRow[];
  masters: DashboardMasterRow[];
  today: {
    total: number;
    paid: { count: number; sum: number };
    inSalon: { count: number; sum: number };
    waiting: { count: number; sum: number };
    noShow: number;
  };
  deposits: { balance: number; accounts: number; topup: number; spend: number };
  warehouse: { totalUah: number; totalUsd: number | null; storages: DashboardStorageRow[] };
  funnel: { newLeads: number; leadsInChat: number; consultBooked: number; consultDone: number; paidBooked: number } | null;
  admin: {
    created: { total: number; consultations: number; paid: number };
    calls: { incoming: number; outgoing: number; missed: number };
    chats: { clients: number; leads: number; clientsAnswered: number; leadsAnswered: number };
  } | null;
  rows: DashboardVisitRow[];
  rowsTruncated: boolean;
};

/** Залишок одного рахунку для блоку «Залишки в касах». */
export type DashboardCashAccount = {
  title: string;
  /** true — готівкова каса, false — безготівковий рахунок (баланс monobank). */
  cash: boolean;
  currency: "UAH" | "USD" | "EUR";
  /** У валюті рахунку. null — суми немає (стартовий залишок не заданий або банк не підключений). */
  balance: number | null;
  openingPending: boolean;
  /** Розбіжність останньої касовки: факт мінус очікувана. null — розбіжності немає. */
  variance: number | null;
};

export type DashboardCash = {
  ok: true;
  accounts: DashboardCashAccount[];
  deposits: { balance: number; clients: number };
};

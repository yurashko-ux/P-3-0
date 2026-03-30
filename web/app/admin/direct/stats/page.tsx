// web/app/admin/direct/stats/page.tsx
// Сторінка статистики Direct

"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { StateIcon } from "@/app/admin/direct/_components/StateIcon";
import { DirectPeriodStatsKpiBar } from "@/app/admin/direct/_components/DirectPeriodStatsKpiBar";

type FooterBlock = {
  createdConsultations: number;
  successfulConsultations: number;
  cancelledOrNoShow: number;
  sales: number;
  createdPaidSum: number;
  plannedPaidSum: number;
  consultationCreated?: number;
  consultationOnlineCount?: number;
  consultationPlanned?: number;
  consultationPlannedOnlineCount?: number;
  consultationRealized?: number;
  consultationNoShow?: number;
  consultationCancelled?: number;
  consultationRescheduledCount?: number;
  noSaleCount?: number;
  newPaidClients?: number;
  newClientsCount?: number;
  newLeadsCount?: number;
  recordsCreatedSum?: number;
  recordsRealizedSum?: number;
  rebookingsCount?: number;
  upsalesGoodsSum?: number;
  noRebookCount?: number;
  recordsCancelledCount?: number;
  recordsNoShowCount?: number;
  recordsRestoredCount?: number;
  paidPastNoRebookCount?: number;
  returnedClientsCount?: number | null;
  turnoverToday?: number;
  consultationPlannedFuture?: number;
  consultationBookedPast?: number;
  consultationBookedPastOnlineCount?: number;
  consultationBookedToday?: number;
  consultationBookedTodayOnlineCount?: number;
  plannedPaidSumToMonthEnd?: number;
  plannedPaidSumNextMonth?: number;
  plannedPaidSumPlus2Months?: number;
  recordsPlannedCountToday?: number;
  recordsPlannedSumToday?: number;
  recordsRealizedCountToday?: number;
};

type MastersStatsRow = {
  masterId: string;
  masterName: string;
  role: string;
  clients: number;
  consultBooked: number;
  consultAttended: number;
  paidAttended: number;
  rebooksCreated: number;
  futureSum?: number;
  monthToEndSum?: number;
  /** Майбутні в поточному місяці (букінг 1–15 / 16–кінець), грн — колонки D та допоміжно для фільтра рядків */
  futureMonthFromStartUAH?: number;
  futureMonthToEndUAH?: number;
  /** Створені нові записи поточного місяця (з 1-го числа по сьогодні, Kyiv), грн — колонка C */
  turnoverMonthToDateUAH?: number;
  nextMonthSum?: number;
  plus2MonthSum?: number;
  servicesSum?: number;
  hairSum?: number;
  goodsSum?: number;
};

function getTodayKyiv(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${year}-${month}-${day}`;
}

/** Додає/віднімає дні до дати YYYY-MM-DD */
function addDays(iso: string, delta: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function formatReportDateLabel(iso: string): string {
  const today = getTodayKyiv();
  if (iso === today) return "Сьогодні";
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("uk-UA", { day: "numeric", month: "long", year: "numeric" });
}

/** Рядок з record-created-counts?includeClients=1 (F4) */
type F4ClientRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  instagramUsername: string;
  paidServiceRecordCreatedAt: string | null;
};

function formatF4ClientDisplayName(c: F4ClientRow): string {
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return name || c.instagramUsername || "—";
}

function formatF4RecordDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/** Багаторядковий title для колонки «Записів» (F4): дата, під нею ім’я; між клієнтами — порожній рядок. */
function buildF4RecordsTooltipTitle(clients: F4ClientRow[] | undefined, count: number): string {
  if (!clients || clients.length === 0) {
    if (count > 0) {
      return "Нові записи F4 (перший платний). Дані клієнтів недоступні.";
    }
    return "Нові записи F4 (перший платний): немає за обраний період.";
  }
  const blocks = clients.map((c) => {
    const dateLine = formatF4RecordDate(c.paidServiceRecordCreatedAt);
    const nameLine = formatF4ClientDisplayName(c);
    return `${dateLine}\n${nameLine}`;
  });
  return `Нові записи F4 (перший платний):\n\n${blocks.join("\n\n")}`;
}

function DirectStatsPageContent() {
  // Місячний фільтр (masters-stats): календарний YYYY-MM у Europe/Kyiv — той самий, що «Звіт за:» / KPI
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    try {
      const m = getTodayKyiv().slice(0, 7);
      return m < "2026-01" ? "2026-01" : m;
    } catch {
      const m = new Date().toISOString().slice(0, 7);
      return m < "2026-01" ? "2026-01" : m;
    }
  });

  const [mastersStats, setMastersStats] = useState<{
    loading: boolean;
    error: string | null;
    rows: MastersStatsRow[];
    totalClients: number;
  }>({ loading: false, error: null, rows: [], totalClients: 0 });

  // KPI по періодах: джерело даних — таблиця (GET /api/admin/direct/clients з тими ж фільтрами).
  const [periodStats, setPeriodStats] = useState<{
    past: FooterBlock;
    today: FooterBlock;
    future: FooterBlock;
  } | null>(null);
  // Дата для звіту «Звіт за:» — історія звітів, можна прокручувати по датах
  const [selectedReportDate, setSelectedReportDate] = useState<string>(() => getTodayKyiv());
  // Кількість клієнтів для поточних фільтрів (з відповіді periodStats); без фільтрів — totalOnly.
  const [filteredCount, setFilteredCount] = useState<number | null>(null);
  const [totalClientsCount, setTotalClientsCount] = useState<number | null>(null);
  const [periodDebug, setPeriodDebug] = useState<Record<string, unknown> | null>(null);
  /** Завантаження блоку KPI по періодах (низ сторінки) */
  const [periodKpiLoading, setPeriodKpiLoading] = useState(true);
  const [periodKpiError, setPeriodKpiError] = useState<string | null>(null);
  /** F4: record-created-counts — нові записи (перший платний: paidRecordsInHistoryCount=0, не перезапис), cost>0, дата створення запису. */
  const [recordCreatedF4, setRecordCreatedF4] = useState<{
    monthToDate: number;
    today: number;
    clientsMonthToDate?: F4ClientRow[];
    clientsToday?: F4ClientRow[];
  } | null>(null);
  const searchParams = useSearchParams();

  const todayKyiv = getTodayKyiv();
  const minReportDate = "2026-01-01";
  const maxReportDate = addDays(todayKyiv, 60); // дозволяємо майбутні дати для планування

  useEffect(() => {
    let cancelled = false;
    async function loadCount() {
      try {
        const res = await fetch("/api/admin/direct/clients?totalOnly=1", { cache: "no-store" });
        const data = await res.json();
        if (cancelled || !data?.ok) return;
        if (typeof data.totalCount === "number") setTotalClientsCount(data.totalCount);
      } catch {
        if (!cancelled) setTotalClientsCount(null);
      }
    }
    void loadCount();
    return () => { cancelled = true; };
  }, []);

  // Єдиний джерело даних для KPI таблиць і блоку «KPI по періодах» у низу сторінки. day — дата звіту.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setPeriodKpiLoading(true);
      setPeriodKpiError(null);
      try {
        const params = new URLSearchParams();
        params.set("statsOnly", "1");
        params.set("statsFullPicture", "1");
        params.set("day", selectedReportDate);
        params.set("_t", String(Date.now()));
        const res = await fetch(`/api/admin/direct/clients?${params.toString()}`, {
          cache: "no-store",
          credentials: "include",
          headers: { "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
        });
        let data: { ok?: boolean; error?: string; periodStats?: unknown; totalCount?: number; _debug?: unknown } | null = null;
        try {
          data = await res.json();
        } catch (parseErr) {
          console.error("[DirectStatsPage] KPI periodStats: не JSON у відповіді", parseErr);
        }
        if (cancelled) return;
        if (!res.ok || !data?.ok) {
          console.warn("[DirectStatsPage] KPI periodStats: помилка відповіді", {
            httpStatus: res.status,
            apiOk: data?.ok,
          });
          setPeriodStats(null);
          setFilteredCount(null);
          setPeriodDebug(null);
          setPeriodKpiError(
            !res.ok
              ? `Не вдалося завантажити KPI (HTTP ${res.status})`
              : typeof data?.error === "string"
                ? data.error
                : "Відповідь API без успішного periodStats"
          );
          return;
        }
        const s = (data.periodStats ?? {}) as { past?: FooterBlock; today?: FooterBlock; future?: FooterBlock };
        setPeriodStats({
          past: (s.past ?? {}) as FooterBlock,
          today: (s.today ?? {}) as FooterBlock,
          future: (s.future ?? {}) as FooterBlock,
        });
        setFilteredCount(typeof data.totalCount === "number" ? data.totalCount : null);
        setPeriodDebug(searchParams.get("debug") ? (data._debug as Record<string, unknown> | null) ?? null : null);
        setPeriodKpiError(null);
      } catch (e) {
        console.error("[DirectStatsPage] KPI periodStats: виняток при fetch", e);
        if (!cancelled) {
          setPeriodStats(null);
          setFilteredCount(null);
          setPeriodDebug(null);
          setPeriodKpiError("Не вдалося завантажити KPI по періодах");
        }
      } finally {
        if (!cancelled) setPeriodKpiLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [searchParams, selectedReportDate]);

  // F4: Prisma count — history=0, not rebooking, місяць/день по paidServiceRecordCreatedAt (Kyiv)
  useEffect(() => {
    let cancelled = false;
    async function loadF4() {
      try {
        const params = new URLSearchParams();
        params.set("day", selectedReportDate);
        params.set("includeClients", "1");
        params.set("_t", String(Date.now()));
        const res = await fetch(`/api/admin/direct/stats/record-created-counts?${params.toString()}`, {
          cache: "no-store",
          credentials: "include",
          headers: { "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
        });
        const data = await res.json();
        if (cancelled || !data?.ok) {
          if (!cancelled) setRecordCreatedF4(null);
          return;
        }
        const parseF4Rows = (raw: unknown): F4ClientRow[] => {
          if (!Array.isArray(raw)) return [];
          return raw.filter(
            (x): x is F4ClientRow =>
              x != null &&
              typeof x === "object" &&
              typeof (x as F4ClientRow).id === "string" &&
              typeof (x as F4ClientRow).instagramUsername === "string"
          );
        };
        setRecordCreatedF4({
          monthToDate: typeof data.monthToDate === "number" ? data.monthToDate : 0,
          today: typeof data.today === "number" ? data.today : 0,
          clientsMonthToDate: parseF4Rows(data.clientsMonthToDate),
          clientsToday: parseF4Rows(data.clientsToday),
        });
      } catch {
        if (!cancelled) setRecordCreatedF4(null);
      }
    }
    void loadF4();
    return () => { cancelled = true; };
  }, [selectedReportDate]);

  function getFooterVal(block: FooterBlock, key: string, column: "past" | "today" | "future"): number {
    const v = (block as Record<string, number | undefined>)[key];
    if (typeof v === "number") return v;
    // Обчислені поля: Офлайн = total − Онлайн
    if (key === "consultationOfflineCount") {
      const created = block.consultationCreated ?? block.createdConsultations ?? 0;
      const online = block.consultationOnlineCount ?? 0;
      return Math.max(0, created - online);
    }
    if (key === "consultationPlannedOfflineCount") {
      const planned = block.consultationPlanned ?? block.consultationPlannedFuture ?? 0;
      const online = block.consultationPlannedOnlineCount ?? 0;
      return Math.max(0, planned - online);
    }
    // Заплановано: кожна колонка має своє поле (0 є валідним, тому не використовуємо ??)
    if (key === "consultationBookedTotal") {
      if (column === "past") return block.consultationBookedPast ?? 0;
      if (column === "today") return block.consultationBookedToday ?? 0;
      return block.consultationPlannedFuture ?? 0;
    }
    if (key === "consultationBookedOnlineCount") {
      if (column === "past") return block.consultationBookedPastOnlineCount ?? 0;
      if (column === "today") return block.consultationBookedTodayOnlineCount ?? 0;
      return block.consultationPlannedOnlineCount ?? 0;
    }
    if (key === "consultationBookedOfflineCount") {
      const total = column === "past" ? (block.consultationBookedPast ?? 0)
        : column === "today" ? (block.consultationBookedToday ?? 0)
        : (block.consultationPlannedFuture ?? 0);
      const online = column === "past" ? (block.consultationBookedPastOnlineCount ?? 0)
        : column === "today" ? (block.consultationBookedTodayOnlineCount ?? 0)
        : (block.consultationPlannedOnlineCount ?? 0);
      return Math.max(0, total - online);
    }
    // Маппінг для past/future (лише базові поля)
    switch (key) {
      case "consultationCreated": return block.createdConsultations ?? block.consultationCreated ?? 0;
      case "consultationRealized": return block.successfulConsultations ?? block.consultationRealized ?? 0;
      case "consultationCancelled": return block.consultationCancelled ?? block.cancelledOrNoShow ?? 0;
      case "newPaidClients": return block.newPaidClients ?? block.sales ?? 0;
      case "soldCount": return block.newPaidClients ?? block.sales ?? 0;
      case "recordsCreatedSum": return block.recordsCreatedSum ?? block.createdPaidSum ?? 0;
      case "recordsRealizedSum": return block.recordsRealizedSum ?? 0;
      default: return 0;
    }
  }

  function formatFooterCell(block: FooterBlock, key: string, unit: string, numberOnly?: boolean, column?: "past" | "today" | "future"): string {
    // Повернуто клієнтів для сьогодні: показувати «—», якщо значення відсутнє (критеріїв поки немає)
    if (key === "returnedClientsCount" && column === "today" && (block.returnedClientsCount == null)) {
      return "—";
    }
    const val = getFooterVal(block, key, column ?? "past");
    if (unit === "тис. грн") {
      const thousands = val / 1000;
      const str = thousands % 1 === 0 ? String(Math.round(thousands)) : thousands.toFixed(1);
      if (numberOnly) return str;
      return `${str} ${unit}`;
    }
    return `${val} ${unit}`;
  }

  const monthOptions = useMemo(() => {
    // Доступні місяці: від 2026-01, +24 місяці.
    // НЕ використовувати toISOString().slice(0,7) — це UTC-місяць; у Kyiv 1-ше число «наступного» місяця
    // часто потрапляє в попередній UTC-місяць → плутанина (наприклад value 2026-03 з підписом «квітень»).
    const out: Array<{ value: string; label: string }> = [];
    let y = 2026;
    let mo = 1;
    for (let i = 0; i < 24; i++) {
      const value = `${y}-${String(mo).padStart(2, "0")}`;
      const label = new Intl.DateTimeFormat("uk-UA", {
        month: "long",
        year: "numeric",
        timeZone: "Europe/Kyiv",
      }).format(new Date(Date.UTC(y, mo - 1, 15, 12, 0, 0)));
      out.push({ value, label });
      mo += 1;
      if (mo > 12) {
        mo = 1;
        y += 1;
      }
    }
    return out;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadStats() {
      try {
        setMastersStats((s) => ({ ...s, loading: true, error: null }));
        const params = new URLSearchParams();
        params.set('month', selectedMonth);
        params.set('_t', String(Date.now()));

        const res = await fetch(`/api/admin/direct/masters-stats?${params.toString()}`, {
          cache: 'no-store',
          credentials: 'include',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            Pragma: 'no-cache',
          },
        });
        const data = await res.json();
        if (!data?.ok) throw new Error(data?.error || 'Не вдалося завантажити статистику');
        if (cancelled) return;

        const mastersRows: MastersStatsRow[] = Array.isArray(data.masters) ? data.masters : [];
        const unassignedRow: MastersStatsRow | null = data.unassigned && typeof data.unassigned === 'object' ? data.unassigned : null;
        const rows = unassignedRow ? [...mastersRows, unassignedRow] : mastersRows;

        setMastersStats({
          loading: false,
          error: null,
          rows,
          totalClients: typeof data.totalClients === 'number' ? data.totalClients : 0,
        });
      } catch (err) {
        if (cancelled) return;
        setMastersStats((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }
    void loadStats();
    return () => {
      cancelled = true;
    };
  }, [selectedMonth]);

  const formatUAHExact = (amountUAH: number): string => {
    const n = Math.round(amountUAH);
    return `${n.toLocaleString('uk-UA')} грн`;
  };

  // Формат як у колонці "Продажі": округляємо до тисяч і показуємо "тис."
  const formatUAHThousands = (amountUAH: number): string => {
    const n = Math.round(amountUAH);
    return `${Math.round(n / 1000).toLocaleString('uk-UA')} тис.`;
  };

  /** Таблиця «Записи Майбутні»: суми в тис.; «—» лише якщо значення невідоме (undefined), нуль показуємо явно */
  const formatFutureThousands = (uah: number | undefined): string => {
    if (uah == null) return '—';
    if (uah <= 0) return '0 тис.';
    return `${Math.round(uah / 1000).toLocaleString('uk-UA')} тис.`;
  };

  const firstTokenLower = (s: string) => (s.trim().split(/\s+/)[0] || '').toLowerCase();

  /** Ключ для збігу «Галина» / Мар'яна vs Мар'яна (без апострофів) */
  const masterNameMatchKey = (s: string) => firstTokenLower(s).replace(/[''ʼ`]/g, '');

  const findFutureRowByExcelName = (excelName: string): MastersStatsRow | undefined => {
    const t = masterNameMatchKey(excelName);
    return (mastersStats.rows || []).find((row) => masterNameMatchKey(row.masterName) === t);
  };

  // KPI-таблиця: робимо максимально компактно — ховаємо рядки, де всі значення = 0
  const compactStatsRows = useMemo(() => {
    const rows = mastersStats.rows || [];
    const nonZero = (r: MastersStatsRow) =>
      (r.clients || 0) > 0 ||
      (r.consultBooked || 0) > 0 ||
      (r.consultAttended || 0) > 0 ||
      (r.paidAttended || 0) > 0 ||
      (r.rebooksCreated || 0) > 0 ||
      (r.futureSum || 0) > 0 ||
      (r.monthToEndSum || 0) > 0 ||
      (r.turnoverMonthToDateUAH || 0) > 0 ||
      (r.futureMonthFromStartUAH || 0) > 0 ||
      (r.futureMonthToEndUAH || 0) > 0 ||
      (r.nextMonthSum || 0) > 0 ||
      (r.plus2MonthSum || 0) > 0 ||
      (r.servicesSum || 0) > 0 ||
      (r.hairSum || 0) > 0 ||
      (r.goodsSum || 0) > 0;
    const filtered = rows.filter((r) => nonZero(r) || r.masterId === 'unassigned');
    // Якщо все нуль — показуємо як є (щоб не було порожньо)
    return filtered.length ? filtered : rows;
  }, [mastersStats.rows]);

  const statsTotals = useMemo(() => {
    const rows = mastersStats.rows || [];
    // Підсумки по всіх рядках (включно "Без майстра"), щоб цифри сходились з загальним.
    return rows.reduce(
      (acc, r) => {
        acc.clients += r.clients || 0;
        acc.consultBooked += r.consultBooked || 0;
        acc.consultAttended += r.consultAttended || 0;
        acc.paidAttended += r.paidAttended || 0;
        acc.rebooksCreated += r.rebooksCreated || 0;
        acc.futureSum += r.futureSum || 0;
        acc.monthToEndSum += r.monthToEndSum || 0;
        acc.futureMonthFromStartUAH += r.futureMonthFromStartUAH || 0;
        acc.futureMonthToEndUAH += r.futureMonthToEndUAH || 0;
        acc.turnoverMonthToDateUAH += r.turnoverMonthToDateUAH || 0;
        acc.nextMonthSum += r.nextMonthSum || 0;
        acc.plus2MonthSum += r.plus2MonthSum || 0;
        acc.servicesSum += r.servicesSum || 0;
        acc.hairSum += r.hairSum || 0;
        acc.goodsSum += r.goodsSum || 0;
        return acc;
      },
      {
        clients: 0,
        consultBooked: 0,
        consultAttended: 0,
        paidAttended: 0,
        rebooksCreated: 0,
        futureSum: 0,
        monthToEndSum: 0,
        futureMonthFromStartUAH: 0,
        futureMonthToEndUAH: 0,
        turnoverMonthToDateUAH: 0,
        nextMonthSum: 0,
        plus2MonthSum: 0,
        servicesSum: 0,
        hairSum: 0,
        goodsSum: 0,
      }
    );
  }, [mastersStats.rows]);

  // Імена рядків для блоків статистики (формат Excel)
  const excelRowNames = ["Галина", "Олена", "Маряна", "Олександра"];

  const futureExcelRows = useMemo(
    () => excelRowNames.map((name) => ({ name, row: findFutureRowByExcelName(name) })),
    [mastersStats.rows]
  );

  const futureExcelTotals = useMemo(() => {
    return futureExcelRows.reduce(
      (acc, item) => {
        const row = item.row;
        acc.turnoverMonthToDateUAH += row?.turnoverMonthToDateUAH ?? 0;
        acc.monthToEndSum += row?.monthToEndSum ?? 0;
        acc.nextMonthSum += row?.nextMonthSum ?? 0;
        acc.plus2MonthSum += row?.plus2MonthSum ?? 0;
        return acc;
      },
      {
        turnoverMonthToDateUAH: 0,
        monthToEndSum: 0,
        nextMonthSum: 0,
        plus2MonthSum: 0,
      }
    );
  }, [futureExcelRows]);

  return (
    <div className="w-full max-w-full px-1 py-6">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            Статистика <span className="text-base">▲</span>
          </h1>
          <div className="text-sm text-gray-600">
            {selectedMonth} • клієнтів: {filteredCount ?? totalClientsCount ?? mastersStats.totalClients}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm">Місяць</span>
            <select
              className="select select-bordered select-xs"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Два блоки Excel: місяць (KPI + masters-stats) і денний зріз (та сама дата, що «Звіт за:») */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6 w-full max-w-full">
        {(["month", "today"] as const).map((blockId) => {
          const isMonth = blockId === "month";
          const kpiBlock = isMonth ? periodStats?.past : periodStats?.today;
          const kpiCol: "past" | "today" = isMonth ? "past" : "today";
          const futureMonthToEndTotal = futureExcelTotals.monthToEndSum;
          const futureNextMonthTotal = futureExcelTotals.nextMonthSum;
          const futurePlus2MonthsTotal = futureExcelTotals.plus2MonthSum;
          const createdMonthTotal = futureExcelTotals.turnoverMonthToDateUAH;
          const futureGrandTotal = createdMonthTotal + futureMonthToEndTotal;
          const consultRowKeys = [
            "consultationCreated",
            "consultationBookedTotal",
            "consultationRealized",
            "consultationCancelled",
            "soldCount",
            "noSaleCount",
            "consultationRescheduledCount",
          ] as const;
          const recordsRowKeys = [
            { key: "recordsCreatedSum" as const, money: true },
            { key: "plannedPaidSum" as const, money: true },
            { key: "recordsRealizedSum" as const, money: true },
            { key: "recordsCancelledCount" as const, money: false },
            { key: "rebookingsCount" as const, money: false },
            { key: "noRebookCount" as const, money: false },
            { key: "recordsRestoredCount" as const, money: false },
          ];
          return (
            <div key={blockId} className="card bg-base-100 shadow-sm w-full min-w-0">
              <div className="card-body p-4 w-full min-w-0">
                <h2 className="text-lg font-semibold mb-3">
                  {isMonth ? "Поточний місяць" : "Сьогодні"}
                </h2>
                {!isMonth ? (
                  <p className="text-[10px] text-gray-500 mb-2">
                    Денні цифри — за датою з блоку «Звіт за:» ({formatReportDateLabel(selectedReportDate)}), узгоджено з KPI внизу сторінки.
                  </p>
                ) : null}
                <div className="overflow-x-auto space-y-6 w-full">
                  {/* 1. Ліди: рядки 3–8 Excel */}
                  <div className="w-full">
                    <div className="font-medium mb-1 text-[10px]">Ліди</div>
                    <table className="table table-xs border-separate border-spacing-0 text-[7px] w-full min-w-max">
                      <thead>
                        <tr className="text-[10px]">
                          <th data-cell="B3" data-block={blockId} className="w-24 whitespace-nowrap">Ліди</th>
                          <th data-cell="C3" data-block={blockId} className="whitespace-nowrap px-1">Кількість</th>
                          <th data-cell="D3" data-block={blockId} className="whitespace-normal text-center leading-tight px-0.5">
                            Консультації<br />
                            План
                          </th>
                          <th data-cell="E3" data-block={blockId} className="whitespace-normal text-center leading-tight px-0.5">
                            Консультації<br />
                            Факт
                          </th>
                          <th data-cell="F3" data-block={blockId} className="whitespace-normal text-center leading-tight px-0.5">
                            Конверсія<br />
                            Лід/План
                          </th>
                          <th data-cell="G3" data-block={blockId} className="whitespace-normal text-center leading-tight px-0.5">
                            Конверсія<br />
                            План/Факт
                          </th>
                          <th data-cell="H3" data-block={blockId} className="whitespace-nowrap px-1">Записів</th>
                          <th data-cell="I3" data-block={blockId} className="whitespace-nowrap px-1">Конверсія</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td data-cell="B4" data-block={blockId} className="font-medium">Ліди</td>
                          {(["C", "D", "E", "F", "G", "H", "I"] as const).map((col) => {
                            let cellValue: number | string = `${col}4`;
                            if (col === "H") {
                              cellValue = recordCreatedF4
                                ? isMonth
                                  ? recordCreatedF4.monthToDate
                                  : recordCreatedF4.today
                                : periodStats
                                  ? 0
                                  : `${col}4`;
                            } else if (periodStats) {
                              const leadsMonth = periodStats.past?.newLeadsCount ?? 0;
                              const leadsToday = periodStats.today?.newLeadsCount ?? 0;
                              const factMonth = getFooterVal(periodStats.past, "consultationRealized", "past");
                              const factToday = getFooterVal(periodStats.today, "consultationRealized", "today");
                              const planMonth =
                                getFooterVal(periodStats.past, "consultationBookedTotal", "past")
                                + getFooterVal(periodStats.today, "consultationBookedTotal", "today");
                              const planToday = getFooterVal(periodStats.today, "consultationBookedTotal", "today");
                              const cNum = isMonth ? leadsMonth : leadsToday;
                              const dNum = isMonth ? planMonth : planToday;
                              const eNum = isMonth ? factMonth : factToday;
                              if (col === "C") {
                                cellValue = cNum;
                              } else if (col === "D") {
                                cellValue = dNum;
                              } else if (col === "E") {
                                cellValue = eNum;
                              } else if (col === "F") {
                                const pct = cNum > 0 ? Math.round((dNum / cNum) * 1000) / 10 : 0;
                                cellValue = `${pct}%`;
                              } else if (col === "G") {
                                const pct = dNum > 0 ? Math.round((eNum / dNum) * 1000) / 10 : 0;
                                cellValue = `${pct}%`;
                              } else if (col === "I") {
                                const recordsNum = recordCreatedF4
                                  ? isMonth
                                    ? recordCreatedF4.monthToDate
                                    : recordCreatedF4.today
                                  : 0;
                                const pctI =
                                  eNum > 0 ? Math.round((recordsNum / eNum) * 100) : 0;
                                cellValue = `${pctI}%`;
                              }
                            }
                            const isHCol = col === "H";
                            const f4CountBlock = isMonth
                              ? recordCreatedF4?.monthToDate ?? 0
                              : recordCreatedF4?.today ?? 0;
                            const f4ClientsBlock = isMonth
                              ? recordCreatedF4?.clientsMonthToDate
                              : recordCreatedF4?.clientsToday;
                            const hTooltipTitle =
                              isHCol && recordCreatedF4
                                ? buildF4RecordsTooltipTitle(f4ClientsBlock, f4CountBlock)
                                : isHCol
                                  ? "Завантаження…"
                                  : undefined;
                            return (
                              <td key={col} data-cell={`${col}4`} data-block={blockId}>
                                {isHCol ? (
                                  <span className="cursor-help" title={hTooltipTitle}>
                                    {cellValue}
                                  </span>
                                ) : (
                                  cellValue
                                )}
                              </td>
                            );
                          })}
                        </tr>
                        {excelRowNames.map((name, i) => {
                          const row = 5 + i;
                          const cols = ["C", "D", "E", "F", "G", "H", "I"];
                          return (
                            <tr key={name}>
                              <td data-cell={`B${row}`} data-block={blockId} className="font-medium">{name}</td>
                              {cols.map((col) => (
                                <td key={col} data-cell={`${col}${row}`} data-block={blockId}>{`${col}${row}`}</td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {/* 2. Консультації: рядки 11–16 Excel */}
                  <div className="w-full">
                    <div className="font-medium mb-1 text-[7px]">Консультації</div>
                    <table className="table table-xs border-separate border-spacing-0 text-[7px] w-full table-fixed">
                      <thead>
                        <tr>
                          <th data-cell="B11" data-block={blockId} className="w-24">Консультації</th>
                          <th data-cell="C11" data-block={blockId}>Створено Нових</th>
                          <th data-cell="D11" data-block={blockId}>Заплановані</th>
                          <th data-cell="E11" data-block={blockId}>Проведені</th>
                          <th data-cell="F11" data-block={blockId}>Скасовані</th>
                          <th data-cell="G11" data-block={blockId}>Продано</th>
                          <th data-cell="H11" data-block={blockId}>Не продано</th>
                          <th data-cell="I11" data-block={blockId}>Відновлено</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td data-cell="B12" data-block={blockId} className="font-medium">Консультації</td>
                          {kpiBlock
                            ? (["C", "D", "E", "F", "G", "H", "I"] as const).map((col, idx) => (
                                <td
                                  key={col}
                                  data-cell={`${col}12`}
                                  data-block={blockId}
                                  className="tabular-nums"
                                >
                                  {getFooterVal(kpiBlock, consultRowKeys[idx], kpiCol)}
                                </td>
                              ))
                            : ["C", "D", "E", "F", "G", "H", "I"].map((col) => (
                                <td key={col} data-cell={`${col}12`} data-block={blockId}>
                                  …
                                </td>
                              ))}
                        </tr>
                        {excelRowNames.map((name, i) => {
                          const row = 13 + i;
                          const cols = ["C", "D", "E", "F", "G", "H", "I"];
                          return (
                            <tr key={name}>
                              <td data-cell={`B${row}`} data-block={blockId} className="font-medium">{name}</td>
                              {cols.map((col) => (
                                <td key={col} data-cell={`${col}${row}`} data-block={blockId}>{`${col}${row}`}</td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {/* 3. Записи (минулі): рядки 19–24 Excel */}
                  <div className="w-full">
                    <div className="font-medium mb-1 text-[7px]">Записи</div>
                    <table className="table table-xs border-separate border-spacing-0 text-[7px] w-full table-fixed">
                      <thead>
                        <tr>
                          <th data-cell="B19" data-block={blockId} className="w-24">Записи Минулі</th>
                          <th data-cell="C19" data-block={blockId}>Створені Нові (грн.)</th>
                          <th data-cell="D19" data-block={blockId}>Заплановані</th>
                          <th data-cell="E19" data-block={blockId}>Реалізовані</th>
                          <th data-cell="F19" data-block={blockId}>Скасовані</th>
                          <th data-cell="G19" data-block={blockId}>Перезаписи</th>
                          <th data-cell="H19" data-block={blockId}>Без Перезапису</th>
                          <th data-cell="I19" data-block={blockId}>Відновлено</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td data-cell="B20" data-block={blockId} className="font-medium">Минулі записи</td>
                          {kpiBlock
                            ? (["C", "D", "E", "F", "G", "H", "I"] as const).map((col, idx) => {
                                const { key, money } = recordsRowKeys[idx];
                                return (
                                  <td
                                    key={col}
                                    data-cell={`${col}20`}
                                    data-block={blockId}
                                    className="tabular-nums text-right"
                                  >
                                    {money
                                      ? formatFooterCell(kpiBlock, key, "тис. грн", false, kpiCol)
                                      : `${getFooterVal(kpiBlock, key, kpiCol)} шт`}
                                  </td>
                                );
                              })
                            : ["C", "D", "E", "F", "G", "H", "I"].map((col) => (
                                <td key={col} data-cell={`${col}20`} data-block={blockId}>
                                  …
                                </td>
                              ))}
                        </tr>
                        {excelRowNames.map((name, i) => {
                          const row = 21 + i;
                          const cols = ["C", "D", "E", "F", "G", "H", "I"];
                          return (
                            <tr key={name}>
                              <td data-cell={`B${row}`} data-block={blockId} className="font-medium">{name}</td>
                              {cols.map((col) => (
                                <td key={col} data-cell={`${col}${row}`} data-block={blockId}>{`${col}${row}`}</td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {/* 4. Записи Майбутні: у місячній картці — masters-stats; у денній — заглушки (майбутнє не «за день») */}
                  <div className="w-full">
                    <div className="font-medium mb-1 text-[7px]">Записи Майбутні</div>
                    <table className="table table-xs border-separate border-spacing-0 text-[7px] w-full table-fixed">
                      <thead>
                        <tr>
                          <th data-cell="B27" data-block={blockId} className="w-24">Записи Майбутні</th>
                          <th
                            data-cell="C27"
                            data-block={blockId}
                            title="Повна сума всіх створених платних записів поточного місяця по даті створення запису. Показуємо в тис.; точна сума є в hover."
                          >
                            З початку місяця
                          </th>
                          <th
                            data-cell="D27"
                            data-block={blockId}
                            title="Сума майбутніх записів до кінця поточного місяця за букінг-датою. Показуємо в тис.; точна сума є в hover."
                          >
                            До Кінця місяця
                          </th>
                          <th
                            data-cell="E27"
                            data-block={blockId}
                            title="Сума «З початку місяця» + «До Кінця місяця». Показуємо в тис.; точна сума є в hover."
                          >
                            Разом
                          </th>
                          <th data-cell="F27" data-block={blockId}>Наступного місяця</th>
                          <th data-cell="G27" data-block={blockId}>+ 2 міс.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {isMonth ? (
                          <>
                            <tr>
                              <td data-cell="B28" data-block={blockId} className="font-medium">Майбутні записи</td>
                              <td
                                data-cell="C28"
                                data-block={blockId}
                                className="text-right tabular-nums"
                                title={formatUAHExact(createdMonthTotal)}
                              >
                                {periodKpiLoading || !kpiBlock ? "…" : formatFutureThousands(createdMonthTotal)}
                              </td>
                              <td
                                data-cell="D28"
                                data-block={blockId}
                                className="text-right tabular-nums"
                                title={formatUAHExact(futureMonthToEndTotal)}
                              >
                                {periodKpiLoading ? "…" : formatFutureThousands(futureMonthToEndTotal)}
                              </td>
                              <td
                                data-cell="E28"
                                data-block={blockId}
                                className="text-right tabular-nums font-medium"
                                title={formatUAHExact(futureGrandTotal)}
                              >
                                {periodKpiLoading ? "…" : formatFutureThousands(futureGrandTotal)}
                              </td>
                              <td
                                data-cell="F28"
                                data-block={blockId}
                                className="text-right tabular-nums"
                                title={formatUAHExact(futureNextMonthTotal)}
                              >
                                {periodKpiLoading ? "…" : formatFutureThousands(futureNextMonthTotal)}
                              </td>
                              <td
                                data-cell="G28"
                                data-block={blockId}
                                className="text-right tabular-nums"
                                title={formatUAHExact(futurePlus2MonthsTotal)}
                              >
                                {periodKpiLoading ? "…" : formatFutureThousands(futurePlus2MonthsTotal)}
                              </td>
                            </tr>
                            {futureExcelRows.map(({ name, row: mr }, i) => {
                              const row = 29 + i;
                              const c = mr?.turnoverMonthToDateUAH;
                              const d = mr?.monthToEndSum;
                              const e = (mr?.turnoverMonthToDateUAH ?? 0) + (mr?.monthToEndSum ?? 0);
                              const f = mr?.nextMonthSum;
                              const g = mr?.plus2MonthSum;
                              return (
                                <tr key={name}>
                                  <td data-cell={`B${row}`} data-block={blockId} className="font-medium">{name}</td>
                                  <td
                                    data-cell={`C${row}`}
                                    data-block={blockId}
                                    className="text-right tabular-nums"
                                    title={
                                      mr
                                        ? formatUAHExact(c ?? 0)
                                        : "Майстра не знайдено в KPI; показано 0 грн."
                                    }
                                  >
                                    {mastersStats.loading ? "…" : formatFutureThousands(mr ? (c ?? 0) : 0)}
                                  </td>
                                  <td
                                    data-cell={`D${row}`}
                                    data-block={blockId}
                                    className="text-right tabular-nums"
                                    title={
                                      mr
                                        ? formatUAHExact(d ?? 0)
                                        : "Майстра не знайдено в KPI; показано 0 грн."
                                    }
                                  >
                                    {mastersStats.loading ? "…" : formatFutureThousands(mr ? (d ?? 0) : 0)}
                                  </td>
                                  <td
                                    data-cell={`E${row}`}
                                    data-block={blockId}
                                    className="text-right tabular-nums"
                                    title={
                                      mr
                                        ? formatUAHExact(e)
                                        : "Майстра не знайдено в KPI; показано 0 грн."
                                    }
                                  >
                                    {mastersStats.loading ? "…" : formatFutureThousands(mr ? e : 0)}
                                  </td>
                                  <td
                                    data-cell={`F${row}`}
                                    data-block={blockId}
                                    className="text-right tabular-nums"
                                    title={
                                      mr
                                        ? formatUAHExact(f ?? 0)
                                        : "Майстра не знайдено в KPI; показано 0 грн."
                                    }
                                  >
                                    {mastersStats.loading ? "…" : formatFutureThousands(mr ? (f ?? 0) : 0)}
                                  </td>
                                  <td
                                    data-cell={`G${row}`}
                                    data-block={blockId}
                                    className="text-right tabular-nums"
                                    title={
                                      mr
                                        ? formatUAHExact(g ?? 0)
                                        : "Майстра не знайдено в KPI; показано 0 грн."
                                    }
                                  >
                                    {mastersStats.loading ? "…" : formatFutureThousands(mr ? (g ?? 0) : 0)}
                                  </td>
                                </tr>
                              );
                            })}
                          </>
                        ) : (
                          <>
                            <tr>
                              <td data-cell="B28" data-block={blockId} className="font-medium">Майбутні записи</td>
                              {(["C", "D", "E", "F", "G"] as const).map((col) => (
                                <td key={col} data-cell={`${col}28`} data-block={blockId} className="text-[9px] text-gray-500">
                                  —
                                </td>
                              ))}
                            </tr>
                            {excelRowNames.map((name, i) => {
                              const row = 29 + i;
                              return (
                                <tr key={name}>
                                  <td data-cell={`B${row}`} data-block={blockId} className="font-medium">{name}</td>
                                  {(["C", "D", "E", "F", "G"] as const).map((col) => (
                                    <td key={col} data-cell={`${col}${row}`} data-block={blockId}>
                                      —
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Звіт за обрану дату — історія звітів, можна прокручувати по датах */}
      <div className="w-1/2 mr-auto">
        <div className="card bg-base-100 shadow-sm mb-6">
          <div className="card-body p-4">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <h2 className="text-lg font-semibold">Звіт за: {formatReportDateLabel(selectedReportDate)}</h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="btn btn-square btn-xs btn-ghost"
                onClick={() => setSelectedReportDate((d) => addDays(d, -1))}
                disabled={selectedReportDate <= minReportDate}
                title="Попередній день"
                aria-label="Попередній день"
              >
                ←
              </button>
              <input
                type="date"
                value={selectedReportDate}
                min={minReportDate}
                max={maxReportDate}
                onChange={(e) => setSelectedReportDate(e.target.value)}
                className="input input-bordered input-xs w-36"
                title="Оберіть дату звіту"
              />
              <button
                type="button"
                className="btn btn-square btn-xs btn-ghost"
                onClick={() => setSelectedReportDate((d) => addDays(d, 1))}
                disabled={selectedReportDate >= maxReportDate}
                title="Наступний день"
                aria-label="Наступний день"
              >
                →
              </button>
              {selectedReportDate !== todayKyiv && (
                <button
                  type="button"
                  className="btn btn-xs btn-ghost text-primary"
                  onClick={() => setSelectedReportDate(todayKyiv)}
                  title="Перейти до сьогодні"
                >
                  Сьогодні
                </button>
              )}
            </div>
          </div>
          {searchParams.get("debug") && periodDebug && (
            <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800 text-sm font-mono overflow-x-auto">
              <div className="font-semibold text-amber-800 dark:text-amber-200 mb-2">🔍 Діагностика (periods API)</div>
              <div>todayKyiv: <strong>{String(periodDebug.todayKyiv)}</strong></div>
              <div>dayParam: {String(periodDebug.dayParam)}</div>
              <div>newLeadsCount: <strong>{String(periodDebug.newLeadsCount)}</strong></div>
              {(periodDebug as any).planFact && (
                <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800">
                  <div className="font-medium">План/Факт (перевірка):</div>
                  <pre className="mt-1 text-xs overflow-x-auto">{JSON.stringify((periodDebug as any).planFact, null, 2)}</pre>
                </div>
              )}
              {Array.isArray(periodDebug.recentClientsLast2Days) && (periodDebug.recentClientsLast2Days as any[]).length > 0 && (
                <div className="mt-2">
                  <div className="font-medium">Останні клієнти (2 дні):</div>
                  <pre className="mt-1 text-xs overflow-x-auto">{JSON.stringify(periodDebug.recentClientsLast2Days, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
          {periodStats ? (
            <div className="flex gap-6 flex-wrap">
              {/* Таблиця Створено */}
              <div className="overflow-x-auto flex-1 min-w-0 rounded-lg overflow-hidden">
                <table className="table table-pin-rows table-xs border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th className="w-48">Назва</th>
                      <th className="w-32">Створено</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: "Нові консультації", stateIcon: "consultation-booked", key: "consultationCreated", unit: "шт", block: 1 },
                      { label: "Нові ліди", stateIcon: "new-lead", key: "newLeadsCount", unit: "шт", block: 1 },
                      { label: "Новий клієнт", icon: "🔥", key: "newPaidClients", unit: "шт", block: 1 },
                      { label: "Створено записів", icon: "📋", key: "recordsCreatedSum", unit: "тис. грн", block: 2 },
                      { label: "Створено перезаписів", icon: "🔁", key: "rebookingsCount", unit: "шт", block: 2 },
                      { label: "Відновлено консультацій", prefixIcon: "♻️", stateIcon: "consultation-booked", key: "consultationRescheduledCount", unit: "шт", block: 3 },
                      { label: "Відновлено записів", icon: "♻️📋", key: "recordsRestoredCount", unit: "шт", block: 3 },
                      { label: "Повернуто клієнтів", icon: "♻️👤", key: "returnedClientsCount", unit: "шт", block: 3 },
                    ].map((c, i, arr) => {
                      const prevBlock = arr[i - 1]?.block;
                      const isFirstInBlock = prevBlock !== c.block;
                      const borderCls = isFirstInBlock && i > 0 ? "!border-t-4 !border-gray-500 dark:!border-gray-400" : "";
                      return (
                      <tr key={i}>
                        <td className={`whitespace-nowrap ${borderCls}`}>{c.label}</td>
                        <td className={`whitespace-nowrap ${borderCls}`}>
                          <span className="inline-flex items-center gap-1">
                            {"prefixIcon" in c && c.prefixIcon ? <>{c.prefixIcon}</> : null}
                            {c.stateIcon ? (
                              <StateIcon state={c.stateIcon} size={20} />
                            ) : (
                              <>{c.icon ?? ""}</>
                            )}
                            <span> - </span>
                            <span>
                              {c.key === "recordsCreatedSum"
                                ? (() => {
                                    const val = getFooterVal(periodStats.today, "recordsCreatedSum", "today");
                                    const thousands = Math.round(val / 1000);
                                    return <>{thousands} <span className="text-[10px] opacity-80">тис.</span></>;
                                  })()
                                : formatFooterCell(
                                    periodStats.today,
                                    c.key,
                                    c.unit,
                                    c.unit === "тис. грн",
                                    "today"
                                  )}
                            </span>
                          </span>
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>
              {/* Таблиця Реалізовано/Не реалізовано */}
              <div className="overflow-x-auto flex-1 min-w-0 rounded-lg overflow-hidden">
                <table className="table table-pin-rows table-xs border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th className="w-48">Назва</th>
                      <th className="w-32 text-[10px] leading-tight whitespace-normal" title="Реалізовано/Не реалізовано">Реал./Не реал.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: "Консульт. План/Факт", consultIcon: true, checkIcon: true, key: "consultationPlanFact", unit: "шт", planFact: true, block: 1 },
                      { label: "Запис План", clipboardIcon: true, checkIcon: true, key: "recordsPlan", unit: "тис. грн", recordsPlanOnly: true, block: 1 },
                      { label: "Запис Факт", clipboardIcon: true, checkIcon: true, key: "recordsFact", unit: "тис. грн", recordsFactOnly: true, block: 1 },
                      { label: "Скасовано (конс)", consultIcon: true, emoji: "🚫", key: "consultationCancelled", unit: "шт", block: 2 },
                      { label: "Не прийшов (конс)", consultIcon: true, emoji: "❌", key: "consultationNoShow", unit: "шт", block: 2 },
                      { label: "Без продажу", icon: "💔", key: "noSaleCount", unit: "шт", block: 2 },
                      { label: "Скасовано (записи)", clipboardIcon: true, emoji: "🚫", key: "recordsCancelledCount", unit: "шт", block: 3 },
                      { label: "Не прийшов (записи)", clipboardIcon: true, emoji: "❌", key: "recordsNoShowCount", unit: "шт", block: 3 },
                      { label: "Без перезапису", icon: "⚠️", key: "noRebookCount", unit: "шт", block: 3 },
                    ].map((m, i, arr) => {
                      const prevBlock = arr[i - 1]?.block;
                      const isFirstInBlock = prevBlock !== m.block;
                      const borderCls = isFirstInBlock && i > 0 ? "!border-t-4 !border-gray-500 dark:!border-gray-400" : "";
                      return (
                      <tr key={i}>
                        <td className={`whitespace-nowrap ${borderCls}`}>{m.label}</td>
                        <td className={`whitespace-nowrap ${borderCls}`}>
                          <span className="inline-flex items-center gap-1">
                            {m.consultIcon ? (
                              <span className="inline-flex items-center gap-1">
                                <StateIcon state="consultation-booked" size={20} />
                                <span>{m.checkIcon ? "✅" : m.emoji}</span>
                              </span>
                            ) : m.clipboardIcon ? (
                              <span className="inline-flex items-center gap-1">
                                <span>📋</span>
                                <span>{m.checkIcon ? "✅" : m.emoji}</span>
                              </span>
                            ) : (
                              <>{m.icon}</>
                            )}
                            <span> - </span>
                            <span>
                              {"planFact" in m && m.planFact && m.key === "consultationPlanFact"
                                ? (() => {
                                    const plan = periodStats.today.consultationBookedToday ?? 0;
                                    const fact = getFooterVal(periodStats.today, "consultationRealized", "today");
                                    const factStr = plan > 0 && fact === 0 ? "?" : String(fact);
                                    return `${plan} / ${factStr} шт`;
                                  })()
                                : "recordsPlanOnly" in m && m.recordsPlanOnly
                                  ? (() => {
                                      const planC = periodStats.today.recordsPlannedCountToday ?? 0;
                                      const planS = Math.round((periodStats.today.recordsPlannedSumToday ?? 0) / 1000);
                                      return <>{planC} і {planS} <span className="text-[10px] opacity-80">тис.</span></>;
                                    })()
                                : "recordsFactOnly" in m && m.recordsFactOnly
                                  ? (() => {
                                      const planC = periodStats.today.recordsPlannedCountToday ?? 0;
                                      const planS = periodStats.today.recordsPlannedSumToday ?? 0;
                                      const factC = periodStats.today.recordsRealizedCountToday ?? 0;
                                      const factS = Math.round((periodStats.today.recordsRealizedSum ?? 0) / 1000);
                                      const hasPlan = planC > 0 || planS > 0;
                                      const hasNoFact = factC === 0 && factS === 0;
                                      return hasPlan && hasNoFact ? "?" : <>{factC} і {factS} <span className="text-[10px] opacity-80">тис.</span></>;
                                    })()
                                  : formatFooterCell(periodStats.today, m.key, m.unit, m.unit === "тис. грн", "today")}
                            </span>
                          </span>
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-8 text-gray-500">
              Завантаження…
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Таблиця KPI: канонічне джерело даних для періодів; футер Direct споживає той самий API. */}
      <div className="card bg-base-100 shadow-sm mb-6">
        <div className="card-body p-4">
          <h2 className="text-lg font-semibold mb-3">KPI по періодах</h2>
          {periodStats ? (
            <div className="overflow-x-auto">
              <table className="table table-pin-rows table-xs">
                <thead>
                  <tr>
                    <th className="w-48">Показник</th>
                    <th className="text-center">З початку місяця</th>
                    <th className="text-center" title={selectedReportDate === todayKyiv ? undefined : `Дані за ${formatReportDateLabel(selectedReportDate)}`}>
                      {selectedReportDate === todayKyiv ? "Сьогодні" : selectedReportDate.slice(8, 10) + "." + selectedReportDate.slice(5, 7)}
                    </th>
                    <th className="text-center">До кінця місяця</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-gray-100">
                    <td colSpan={4} className="font-medium">Консультації</td>
                  </tr>
                  {/* Створено = кількість створених консультацій за період (З початку місяця / Сьогодні); ті самі значення, що в футері */}
                  {[
                    { label: "Створено", stateIcon: "consultation-booked", key: "consultationCreated", unit: "шт" },
                    { label: "Онлайн", icon: "💻", key: "consultationOnlineCount", unit: "шт" },
                    { label: "Офлайн", stateIcon: "consultation-booked", key: "consultationOfflineCount", unit: "шт" },
                    { label: "Заплановано", stateIcon: "consultation-booked", key: "consultationBookedTotal", unit: "шт" },
                    { label: "Онлайн", icon: "💻", key: "consultationBookedOnlineCount", unit: "шт" },
                    { label: "Офлайн", stateIcon: "consultation-booked", key: "consultationBookedOfflineCount", unit: "шт" },
                    { label: "Відбулось", icon: "✅", key: "consultationRealized", unit: "шт" },
                    { label: "Не прийшов", icon: "❌", key: "consultationNoShow", unit: "шт" },
                    { label: "Скасовано", icon: "🚫", key: "consultationCancelled", unit: "шт" },
                    { label: "Без продажу", icon: "💔", key: "noSaleCount", unit: "шт" },
                    { label: "Новий клієнт", icon: "🔥", key: "soldCount", unit: "шт" },
                    { label: "Відновлена консультація", stateIcon: "returned", key: "consultationRescheduledCount", unit: "шт" },
                  ].map((row, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap">
                        {(row as { stateIcon?: string; icon?: string }).stateIcon ? (
                          <span className="inline-flex items-center gap-1.5">
                            <StateIcon state={(row as { stateIcon: string }).stateIcon} size={20} />
                            {row.label}
                          </span>
                        ) : (
                          <>{row.icon} {row.label}</>
                        )}
                      </td>
                      <td className="text-center">{formatFooterCell(periodStats.past, row.key, row.unit, false, "past")}</td>
                      <td className="text-center">{formatFooterCell(periodStats.today, row.key, row.unit, false, "today")}</td>
                      <td className="text-center">{formatFooterCell(periodStats.future, row.key, row.unit, false, "future")}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-100">
                    <td colSpan={4} className="font-medium">Записи</td>
                  </tr>
                  <tr>
                    <td className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-sm">🔵</span>
                        Нові Ліди
                      </span>
                    </td>
                    <td className="text-center">{formatFooterCell(periodStats.past, "newLeadsCount", "шт", true, "past")}</td>
                    <td className="text-center">{formatFooterCell(periodStats.today, "newLeadsCount", "шт", true, "today")}</td>
                    <td className="text-center">—</td>
                  </tr>
                  <tr>
                    <td className="whitespace-nowrap"><span className="mx-1" aria-hidden> </span>💰 Фін. Рез. (Оборот)</td>
                    <td className="text-center">{formatFooterCell(periodStats.past, "turnoverToday", "тис. грн", false, "past")}</td>
                    <td className="text-center">{formatFooterCell(periodStats.today, "turnoverToday", "тис. грн", false, "today")}</td>
                    <td className="text-center">{formatFooterCell(periodStats.future, "turnoverToday", "тис. грн", false, "future")}</td>
                  </tr>
                  {[
                    { label: "Нові клієнти", icon: "•", key: "newClientsCount", unit: "шт", blueDot: true },
                    { label: "Створено записів", icon: "📋", key: "recordsCreatedSum", unit: "тис. грн" },
                    { label: "Заплановано", icon: "⏳", key: "plannedPaidSum", unit: "тис. грн" },
                    { label: "Реалізовано", icon: "✅", key: "recordsRealizedSum", unit: "тис. грн" },
                    { label: "Перезаписи", icon: "🔁", key: "rebookingsCount", unit: "шт" },
                    { label: "Допродажі", icon: "💅", key: "upsalesGoodsSum", unit: "тис. грн" },
                    { label: "Без перезапису", icon: "⚠️", key: "noRebookCount", unit: "шт" },
                    { label: "Повернутий клієнт", stateIcon: "returned", key: "returnedClientsCount", unit: "шт" },
                    { label: "Скасовано", icon: "🚫", key: "recordsCancelledCount", unit: "шт" },
                    { label: "Не прийшов", icon: "❌", key: "recordsNoShowCount", unit: "шт" },
                  ].map((row, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap">
                        {row.blueDot ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-sm">🔵</span> {row.label}
                          </span>
                        ) : "stateIcon" in row && row.stateIcon ? (
                          <span className="inline-flex items-center gap-1.5">
                            <StateIcon state={row.stateIcon} size={20} />
                            {row.label}
                          </span>
                        ) : (
                          <>{row.icon} {row.label}</>
                        )}
                      </td>
                      <td className="text-center">{formatFooterCell(periodStats.past, row.key, row.unit, Boolean("numberOnly" in row && row.numberOnly), "past")}</td>
                      <td className="text-center">{formatFooterCell(periodStats.today, row.key, row.unit, Boolean("numberOnly" in row && row.numberOnly), "today")}</td>
                      <td className="text-center">{formatFooterCell(periodStats.future, row.key, row.unit, Boolean("numberOnly" in row && row.numberOnly), "future")}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="whitespace-nowrap">
                      <span className="mx-1" aria-hidden> </span>
                      <span className="font-medium text-gray-600">Клієнти:</span>
                      <span className="ml-1.5 inline-flex items-center gap-1" title="Нові">
                        <span className="text-sm">🔵</span>
                      </span>
                      <span className="ml-1 inline-flex items-center gap-1" title="Повернуті">
                        <StateIcon state="returned" size={16} />
                      </span>
                    </td>
                    <td className="text-center">
                      {(periodStats.past.newClientsCount ?? 0)} / {(periodStats.past.returnedClientsCount ?? 0)} шт
                    </td>
                    <td className="text-center">
                      {(periodStats.today.newClientsCount ?? 0)} / {periodStats.today.returnedClientsCount == null ? "—" : periodStats.today.returnedClientsCount} шт
                    </td>
                    <td className="text-center">—</td>
                  </tr>
                  <tr className="bg-gray-100">
                    <td colSpan={4} className="font-medium">До кінця місяця (майбутнє)</td>
                  </tr>
                  <tr>
                    <td className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-sm">🟡</span>
                        Записів: Майбутніх
                      </span>
                    </td>
                    <td className="text-center">—</td>
                    <td className="text-center">—</td>
                    <td className="text-center">{formatFooterCell(periodStats.future, "plannedPaidSumToMonthEnd", "тис. грн")}</td>
                  </tr>
                  <tr>
                    <td className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-sm">🟡</span>
                        До кінця місяця
                      </span>
                    </td>
                    <td className="text-center">—</td>
                    <td className="text-center">—</td>
                    <td className="text-center">{formatFooterCell(periodStats.future, "plannedPaidSumToMonthEnd", "тис. грн")}</td>
                  </tr>
                  <tr>
                    <td className="whitespace-nowrap">➡️ Наступного місяця</td>
                    <td className="text-center">—</td>
                    <td className="text-center">—</td>
                    <td className="text-center">{formatFooterCell(periodStats.future, "plannedPaidSumNextMonth", "тис. грн")}</td>
                  </tr>
                  <tr>
                    <td className="whitespace-nowrap">⏭️ +2 міс.</td>
                    <td className="text-center">—</td>
                    <td className="text-center">—</td>
                    <td className="text-center">{formatFooterCell(periodStats.future, "plannedPaidSumPlus2Months", "тис. грн")}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex items-center justify-center py-8 text-gray-500">
              Завантаження KPI…
            </div>
          )}
        </div>
      </div>

      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-4">
          {mastersStats.loading ? (
            <div className="flex items-center justify-center py-12">
              <span className="loading loading-spinner loading-lg"></span>
            </div>
          ) : mastersStats.error ? (
            <div className="alert alert-error">
              <span>Помилка статистики: {mastersStats.error}</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="inline-block w-max min-w-full">
                <table
                  className="table table-compact table-xs w-auto leading-tight border-collapse"
                  style={{ tableLayout: "auto" }}
                >
                  <thead>
                    <tr>
                      <th className="text-[12px] py-0.5 px-1 whitespace-nowrap w-[120px] max-w-[120px] text-base-content">
                        Майстер
                      </th>
                      <th className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[52px] text-base-content" title={`${statsTotals.clients}`}>
                        <div className="flex flex-col items-end leading-none">
                          <span>Кл</span>
                          <span className="text-[11px] opacity-60">{statsTotals.clients}</span>
                        </div>
                      </th>
                      <th className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[58px] text-base-content" title={`${statsTotals.consultBooked}`}>
                        <div className="flex flex-col items-end leading-none">
                          <span>Конс</span>
                          <span className="text-[11px] opacity-60">{statsTotals.consultBooked}</span>
                        </div>
                      </th>
                      <th className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[52px] text-base-content" title={`${statsTotals.consultAttended}`}>
                        <div className="flex flex-col items-end leading-none">
                          <span>✅К</span>
                          <span className="text-[11px] opacity-60">{statsTotals.consultAttended}</span>
                        </div>
                      </th>
                      <th className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[52px] text-base-content" title={`${statsTotals.paidAttended}`}>
                        <div className="flex flex-col items-end leading-none">
                          <span>✅З</span>
                          <span className="text-[11px] opacity-60">{statsTotals.paidAttended}</span>
                        </div>
                      </th>
                      <th className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[66px] text-base-content" title={`${statsTotals.rebooksCreated}`}>
                        <div className="flex flex-col items-end leading-none">
                          <span>🔁</span>
                          <span className="text-[11px] opacity-60">{statsTotals.rebooksCreated}</span>
                        </div>
                      </th>
                      <th
                        className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content"
                        title={formatUAHExact(statsTotals.futureSum)}
                      >
                        <div className="flex flex-col items-end leading-none">
                          <span>Майб</span>
                          <span className="text-[11px] opacity-60">{statsTotals.futureSum > 0 ? formatUAHThousands(statsTotals.futureSum) : '0 тис.'}</span>
                        </div>
                      </th>
                      <th
                        className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content"
                        title={formatUAHExact(statsTotals.monthToEndSum)}
                      >
                        <div className="flex flex-col items-end leading-none">
                          <span>До кін</span>
                          <span className="text-[11px] opacity-60">{statsTotals.monthToEndSum > 0 ? formatUAHThousands(statsTotals.monthToEndSum) : '0 тис.'}</span>
                        </div>
                      </th>
                      <th
                        className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content"
                        title={formatUAHExact(statsTotals.nextMonthSum)}
                      >
                        <div className="flex flex-col items-end leading-none">
                          <span>Наст</span>
                          <span className="text-[11px] opacity-60">{statsTotals.nextMonthSum > 0 ? formatUAHThousands(statsTotals.nextMonthSum) : '0 тис.'}</span>
                        </div>
                      </th>
                      <th
                        className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content"
                        title={formatUAHExact(statsTotals.plus2MonthSum)}
                      >
                        <div className="flex flex-col items-end leading-none">
                          <span>+2</span>
                          <span className="text-[11px] opacity-60">{statsTotals.plus2MonthSum > 0 ? formatUAHThousands(statsTotals.plus2MonthSum) : '0 тис.'}</span>
                        </div>
                      </th>
                      <th
                        className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content"
                        title={formatUAHExact(statsTotals.servicesSum)}
                      >
                        <div className="flex flex-col items-end leading-none">
                          <span>Послуги</span>
                          <span className="text-[11px] opacity-60">{statsTotals.servicesSum > 0 ? formatUAHThousands(statsTotals.servicesSum) : '0 тис.'}</span>
                        </div>
                      </th>
                      <th
                        className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content"
                        title={formatUAHExact(statsTotals.hairSum)}
                      >
                        <div className="flex flex-col items-end leading-none">
                          <span>Волосся</span>
                          <span className="text-[11px] opacity-60">{statsTotals.hairSum > 0 ? formatUAHThousands(statsTotals.hairSum) : '0 тис.'}</span>
                        </div>
                      </th>
                      <th
                        className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content"
                        title={formatUAHExact(statsTotals.goodsSum)}
                      >
                        <div className="flex flex-col items-end leading-none">
                          <span>Товар</span>
                          <span className="text-[11px] opacity-60">{statsTotals.goodsSum > 0 ? formatUAHThousands(statsTotals.goodsSum) : '0 тис.'}</span>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {compactStatsRows.map((r) => (
                      <tr key={r.masterId}>
                        <td className="text-[12px] whitespace-nowrap py-0.5 px-1 w-[120px] max-w-[120px] text-base-content">
                          <span className="font-medium block truncate" title={r.masterName}>
                            {r.masterName}
                          </span>
                        </td>
                        <td className="text-[12px] text-right py-0.5 px-1 w-[52px] text-base-content tabular-nums">{r.clients}</td>
                        <td className="text-[12px] text-right py-0.5 px-1 w-[58px] text-base-content tabular-nums">{r.consultBooked}</td>
                        <td className="text-[12px] text-right py-0.5 px-1 w-[52px] text-base-content tabular-nums">{r.consultAttended}</td>
                        <td className="text-[12px] text-right py-0.5 px-1 w-[52px] text-base-content tabular-nums">{r.paidAttended}</td>
                        <td
                          className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[66px] text-base-content tabular-nums"
                          title={
                            r.paidAttended > 0
                              ? `${r.rebooksCreated} / ${r.paidAttended} = ${Math.round((r.rebooksCreated / r.paidAttended) * 1000) / 10}%`
                              : ''
                          }
                        >
                          {r.rebooksCreated}
                          {r.paidAttended > 0 ? (
                            <span className="ml-1 text-[12px] opacity-60">({Math.round((r.rebooksCreated / r.paidAttended) * 1000) / 10}%)</span>
                          ) : null}
                        </td>
                        <td
                          className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content tabular-nums"
                          title={typeof r.futureSum === 'number' ? formatUAHExact(r.futureSum) : ''}
                        >
                          {typeof r.futureSum === 'number' && r.futureSum > 0 ? formatUAHThousands(r.futureSum) : '-'}
                        </td>
                        <td
                          className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content tabular-nums"
                          title={typeof r.monthToEndSum === 'number' ? formatUAHExact(r.monthToEndSum) : ''}
                        >
                          {typeof r.monthToEndSum === 'number' && r.monthToEndSum > 0 ? formatUAHThousands(r.monthToEndSum) : '-'}
                        </td>
                        <td
                          className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content tabular-nums"
                          title={typeof r.nextMonthSum === 'number' ? formatUAHExact(r.nextMonthSum) : ''}
                        >
                          {typeof r.nextMonthSum === 'number' && r.nextMonthSum > 0 ? formatUAHThousands(r.nextMonthSum) : '-'}
                        </td>
                        <td
                          className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content tabular-nums"
                          title={typeof r.plus2MonthSum === 'number' ? formatUAHExact(r.plus2MonthSum) : ''}
                        >
                          {typeof r.plus2MonthSum === 'number' && r.plus2MonthSum > 0 ? formatUAHThousands(r.plus2MonthSum) : '-'}
                        </td>
                        <td
                          className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content tabular-nums"
                          title={typeof r.servicesSum === 'number' ? formatUAHExact(r.servicesSum) : ''}
                        >
                          {typeof r.servicesSum === 'number' && r.servicesSum > 0 ? formatUAHThousands(r.servicesSum) : '-'}
                        </td>
                        <td
                          className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content tabular-nums"
                          title={typeof r.hairSum === 'number' ? formatUAHExact(r.hairSum) : ''}
                        >
                          {typeof r.hairSum === 'number' && r.hairSum > 0 ? formatUAHThousands(r.hairSum) : '-'}
                        </td>
                        <td
                          className="text-[12px] text-right py-0.5 px-1 whitespace-nowrap w-[78px] text-base-content tabular-nums"
                          title={typeof r.goodsSum === 'number' ? formatUAHExact(r.goodsSum) : ''}
                        >
                          {typeof r.goodsSum === 'number' && r.goodsSum > 0 ? formatUAHThousands(r.goodsSum) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      <DirectPeriodStatsKpiBar
        stats={periodStats}
        loading={periodKpiLoading}
        emptyOrErrorText={periodKpiError}
      />
    </div>
  );
}

export default function DirectStatsPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-full px-1 py-6 flex items-center justify-center min-h-[200px]">
          <span className="loading loading-spinner loading-lg" />
        </div>
      }
    >
      <DirectStatsPageContent />
    </Suspense>
  );
}

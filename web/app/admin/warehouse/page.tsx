"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { WarehouseCreateButton } from "./_components/WarehouseCreateButton";

type WarehouseStorage = { id: string; title: string };
type StockRow = {
  id: string;
  quantity: number;
  costPerUnit: number;
  valueUah: number;
  product: {
    id: string;
    sku: number | null;
    title: string;
    category: string | null;
    groupId: string | null;
    groupTitle: string | null;
    unit: string;
    isHair: boolean;
    lengthCm: number | null;
    weightGrams: number | null;
    costPerUnit: number;
    costUsd: number;
  };
  storage: { id: string; title: string };
};

type Dashboard = {
  ok: boolean;
  error?: string;
  period: {
    year: number;
    month: number;
    isLive: boolean;
    snapshotMissing: boolean;
    snapshotCapturedAt: string | null;
    lastSyncedAt: string | null;
  };
  balance: {
    totalUah: number;
    hairUah: number;
    productCount: number;
    stockRowCount: number;
    hairProductCount: number;
  } | null;
  filteredTotals: { rows: number; valueUah: number; hairUah: number };
  storages: WarehouseStorage[];
  groups?: Array<{ id: string; title: string }>;
  categories: string[];
  stocks: StockRow[];
};

type SortKey = "sku" | "title" | "category" | "qty" | "value" | "storage";

function formatMoney(value: number): string {
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(Math.round(value || 0));
}

function formatQty(value: number): string {
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(value || 0);
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "ще не синхронізовано";
  return new Date(iso).toLocaleString("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString("uk-UA", { month: "long", year: "numeric" });
}

/** Altegio віддає «рс» — у таблиці залишків показуємо «шт». */
function displayUnit(unit: string): string {
  const normalized = String(unit || "").trim().toLowerCase();
  if (!normalized || normalized === "рс" || normalized === "pc" || normalized === "pcs") return "шт";
  return unit;
}

export default function WarehousePage() {
  const now = useMemo(() => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Kyiv",
      year: "numeric",
      month: "2-digit",
    }).formatToParts(new Date());
    return {
      year: Number(parts.find((p) => p.type === "year")?.value || 0),
      month: Number(parts.find((p) => p.type === "month")?.value || 0),
    };
  }, []);

  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [year, setYear] = useState(now.year);
  const [month, setMonth] = useState(now.month);
  const [query, setQuery] = useState("");
  const [draftQuery, setDraftQuery] = useState("");
  const [hair, setHair] = useState<"all" | "yes" | "no">("all");
  const [storageId, setStorageId] = useState("");
  const [category, setCategory] = useState("");
  const [groupId, setGroupId] = useState("");
  const [sort, setSort] = useState<SortKey>("title");
  const [order, setOrder] = useState<"asc" | "desc">("asc");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        year: String(year),
        month: String(month),
        q: query,
        hair,
        storageId,
        category,
        groupId,
        sort,
        order,
      });
      const res = await fetch(`/api/admin/warehouse?${params.toString()}`, { credentials: "include" });
      const json = (await res.json()) as Dashboard;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
      if (storageId && !(json.storages || []).some((s) => s.id === storageId)) {
        setStorageId("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка завантаження");
    } finally {
      setLoading(false);
    }
  }, [year, month, query, hair, storageId, category, groupId, sort, order]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(draftQuery.trim()), 400);
    return () => clearTimeout(timer);
  }, [draftQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSort = (key: SortKey) => {
    if (sort === key) {
      setOrder((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSort(key);
    setOrder(key === "qty" || key === "value" ? "desc" : "asc");
  };

  const handleSync = async () => {
    setSyncing(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/warehouse/import", { method: "POST", credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Помилка синхронізації");
      }
      setNotice(
        `Оновлено з Altegio: ${json.result.products} товарів, ${json.result.stockRows} рядків залишків, волосся ${json.result.hairProducts}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка синхронізації");
    } finally {
      setSyncing(false);
    }
  };

  const years = [now.year, now.year - 1, now.year - 2];
  const sortMark = (key: SortKey) => (sort === key ? (order === "asc" ? " ↑" : " ↓") : "");
  const stocks = data?.stocks || [];
  const costTotal = stocks.reduce((sum, row) => sum + (Number(row.costPerUnit) || 0), 0);
  const valueTotal = stocks.reduce((sum, row) => sum + (Number(row.valueUah) || 0), 0);

  return (
    <main>
      <section className="mx-auto p-3">
        {notice && <div className="alert alert-success text-sm py-2 mb-3">{notice}</div>}
        {error && <div className="alert alert-error text-sm py-2 mb-3">{error}</div>}

        <div className="flex flex-col lg:flex-row gap-3 items-start">
          <div className="order-2 lg:order-1 flex-1 min-w-0 w-full space-y-2">
            {data?.period.snapshotMissing && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                Немає знімка за {monthLabel(year, month)}. Для минулих місяців знімок з’являється після синхронізації в
                тому місяці. Оберіть поточний місяць або натисніть «Оновити з Altegio».
              </p>
            )}

            {loading && <p className="text-sm text-gray-500">Завантаження…</p>}

            {!loading && (
              <div className="overflow-x-auto bg-white rounded-xl border">
                <table className="table table-xs w-full">
                  <thead className="sticky top-10 z-10 bg-white shadow-sm [&_th]:bg-white">
                    <tr>
                      <th className="w-10">№</th>
                      <th>
                        <button type="button" className="font-semibold" onClick={() => handleSort("sku")}>
                          Код Товару{sortMark("sku")}
                        </button>
                      </th>
                      <th>
                        <button type="button" className="font-semibold" onClick={() => handleSort("title")}>
                          Назва Товару{sortMark("title")}
                        </button>
                      </th>
                      <th>
                        <button type="button" className="font-semibold" onClick={() => handleSort("category")}>
                          Категорія{sortMark("category")}
                        </button>
                      </th>
                      <th>
                        <button type="button" className="font-semibold" onClick={() => handleSort("storage")}>
                          Склад{sortMark("storage")}
                        </button>
                      </th>
                      <th className="text-right">
                        <button type="button" className="font-semibold" onClick={() => handleSort("qty")}>
                          К-сть{sortMark("qty")}
                        </button>
                      </th>
                      <th className="text-right">
                        <span className="font-semibold">Собівартість</span>
                        <div className="text-[11px] font-semibold text-gray-700 tabular-nums">
                          {formatMoney(costTotal)} грн
                        </div>
                      </th>
                      <th className="text-right">
                        <button type="button" className="font-semibold" onClick={() => handleSort("value")}>
                          Сума{sortMark("value")}
                        </button>
                        <div className="text-[11px] font-semibold text-gray-700 tabular-nums">
                          {formatMoney(valueTotal)} грн
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {stocks.map((row, index) => (
                      <tr key={row.id} className={row.product.isHair ? "bg-rose-50" : ""}>
                        <td className="tabular-nums text-gray-500">{index + 1}</td>
                        <td className="tabular-nums text-gray-500">{row.product.sku ?? "—"}</td>
                        <td>
                          {row.product.title}
                          {row.product.lengthCm ? ` · ${row.product.lengthCm} см` : ""}
                          {row.product.weightGrams ? ` · ${row.product.weightGrams} г` : ""}
                        </td>
                        <td>{row.product.groupTitle || row.product.category || "—"}</td>
                        <td>{row.storage.title}</td>
                        <td className="text-right tabular-nums">
                          {formatQty(row.quantity)} {displayUnit(row.product.unit)}
                        </td>
                        <td className="text-right tabular-nums">{formatMoney(row.costPerUnit)} грн</td>
                        <td className="text-right tabular-nums font-medium">{formatMoney(row.valueUah)} грн</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!stocks.length && !data?.period.snapshotMissing && (
                  <p className="p-4 text-sm text-gray-500">
                    Немає рядків. Натисніть «Оновити з Altegio», щоб залити каталог і залишки.
                  </p>
                )}
              </div>
            )}
          </div>

          <aside className="order-1 lg:order-2 w-full lg:w-[280px] shrink-0 lg:sticky lg:top-12 space-y-2">
            <div className="bg-white border rounded-xl p-2.5 space-y-2">
              <p className="text-[11px] leading-snug text-gray-600">
                Залишки — дзеркало Altegio. <b>Прийомку, списання й інвентаризацію робіть у вкладці Документи</b> — вони
                одразу йдуть у склад Altegio.
              </p>
              <button
                type="button"
                className="btn btn-sm btn-primary min-h-0 h-8 w-full"
                onClick={() => void handleSync()}
                disabled={syncing}
              >
                {syncing ? "Оновлення…" : "Оновити з Altegio"}
              </button>
            </div>

            <div className="bg-white border rounded-xl p-2.5 space-y-1">
              <StatLine label="Сума залишків" value={`${formatMoney(data?.filteredTotals.valueUah || 0)} грн`} />
              <StatLine label="Волосся" value={`${formatMoney(data?.filteredTotals.hairUah || 0)} грн`} />
              <StatLine label="Рядків" value={String(data?.filteredTotals.rows || 0)} />
              <StatLine label="Оновлено" value={formatDateTime(data?.period.lastSyncedAt || null)} />
            </div>

            <div className="bg-white border rounded-xl p-2.5 space-y-2">
              <label className="form-control w-full">
                <span className="label-text text-[11px]">Період (кінець місяця)</span>
                <div className="flex gap-1">
                  <select
                    className="select select-bordered select-sm flex-1"
                    value={month}
                    onChange={(e) => setMonth(Number(e.target.value))}
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>
                        {m.toString().padStart(2, "0")}
                      </option>
                    ))}
                  </select>
                  <select
                    className="select select-bordered select-sm flex-1"
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
              <label className="form-control w-full">
                <span className="label-text text-[11px]">Склад</span>
                <div className="flex items-center gap-1">
                  <select
                    className="select select-bordered select-sm flex-1 min-w-0"
                    value={storageId}
                    onChange={(e) => setStorageId(e.target.value)}
                  >
                    <option value="">Усі</option>
                    {(data?.storages || []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                  <WarehouseCreateButton
                    kind="storage"
                    compact
                    onCreated={(row) => {
                      setNotice(`Склад «${row.title}» створено в Kresco і Altegio.`);
                      setStorageId(row.id);
                      void load();
                    }}
                  />
                </div>
              </label>
              <label className="form-control w-full">
                <span className="label-text text-[11px]">Група</span>
                <div className="flex items-center gap-1">
                  <select
                    className="select select-bordered select-sm flex-1 min-w-0"
                    value={groupId}
                    onChange={(e) => setGroupId(e.target.value)}
                  >
                    <option value="">Усі</option>
                    {(data?.groups || []).map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.title}
                      </option>
                    ))}
                  </select>
                  <WarehouseCreateButton
                    kind="group"
                    compact
                    onCreated={(row) => {
                      setNotice(`Групу «${row.title}» створено.`);
                      setGroupId(row.id);
                      void load();
                    }}
                  />
                </div>
              </label>
              <label className="form-control w-full">
                <span className="label-text text-[11px]">Група / категорія</span>
                <select
                  className="select select-bordered select-sm w-full"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">Усі</option>
                  {(data?.categories || []).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-control w-full">
                <span className="label-text text-[11px]">Тип</span>
                <select
                  className="select select-bordered select-sm w-full"
                  value={hair}
                  onChange={(e) => setHair(e.target.value as "all" | "yes" | "no")}
                >
                  <option value="all">Усі товари</option>
                  <option value="yes">Волосся</option>
                  <option value="no">Інший товар</option>
                </select>
              </label>
              <label className="form-control w-full">
                <span className="label-text text-[11px]">Пошук</span>
                <input
                  className="input input-bordered input-sm w-full"
                  placeholder="Номер, назва…"
                  value={draftQuery}
                  onChange={(e) => setDraftQuery(e.target.value)}
                />
              </label>
              {data?.period.isLive && (
                <p className="text-[11px] text-gray-500 leading-snug">
                  Живі залишки на зараз ({monthLabel(year, month)}). Минулий місяць — зріз на момент останнього оновлення
                  в тому місяці.
                </p>
              )}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] text-gray-500 shrink-0">{label}</span>
      <span className="text-xs font-bold text-right break-words">{value}</span>
    </div>
  );
}

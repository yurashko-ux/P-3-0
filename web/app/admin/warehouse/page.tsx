"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
  const [includeZero, setIncludeZero] = useState(false);
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
      if (includeZero) params.set("includeZero", "1");
      const res = await fetch(`/api/admin/warehouse?${params.toString()}`, { credentials: "include" });
      const json = (await res.json()) as Dashboard;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка завантаження");
    } finally {
      setLoading(false);
    }
  }, [year, month, query, hair, storageId, category, groupId, includeZero, sort, order]);

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

  return (
    <main>
      <section className="max-w-7xl mx-auto p-3 space-y-3">
        <div className="flex flex-wrap items-start gap-2">
          <p className="text-xs text-gray-600 bg-white border rounded-xl px-3 py-2 flex-1">
            Залишки — дзеркало Altegio (каса салону списує там). <b>Прийомку, списання й інвентаризацію робіть у вкладці Документи</b> — вони одразу йдуть у склад Altegio. Не дублюйте той самий прихід у кабінеті Altegio. Журнал запису, каса й банк не чіпаємо.
          </p>
          <button
            type="button"
            className="btn btn-sm btn-primary min-h-0 h-8"
            onClick={() => void handleSync()}
            disabled={syncing}
          >
            {syncing ? "Оновлення…" : "Оновити з Altegio"}
          </button>
        </div>

        {notice && <div className="alert alert-success text-sm py-2">{notice}</div>}
        {error && <div className="alert alert-error text-sm py-2">{error}</div>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatCard label="Сума залишків" value={`${formatMoney(data?.filteredTotals.valueUah || 0)} грн`} />
          <StatCard label="Волосся" value={`${formatMoney(data?.filteredTotals.hairUah || 0)} грн`} />
          <StatCard label="Рядків" value={String(data?.filteredTotals.rows || 0)} />
          <StatCard
            label="Оновлено"
            value={formatDateTime(data?.period.lastSyncedAt || null)}
          />
        </div>

        <div className="bg-white border rounded-xl p-3 flex flex-wrap gap-2 items-end">
          <label className="form-control">
            <span className="label-text text-[11px]">Період (кінець місяця)</span>
            <div className="flex gap-1">
              <select className="select select-bordered select-sm" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m.toString().padStart(2, "0")}
                  </option>
                ))}
              </select>
              <select className="select select-bordered select-sm" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <label className="form-control">
            <span className="label-text text-[11px]">Склад</span>
            <select className="select select-bordered select-sm min-w-[140px]" value={storageId} onChange={(e) => setStorageId(e.target.value)}>
              <option value="">Усі</option>
              {(data?.storages || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <label className="form-control">
            <span className="label-text text-[11px]">Група</span>
            <select className="select select-bordered select-sm min-w-[160px]" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">Усі</option>
              {(data?.groups || []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
          <label className="form-control">
            <span className="label-text text-[11px]">Група / категорія</span>
            <select className="select select-bordered select-sm min-w-[160px]" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Усі</option>
              {(data?.categories || []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="form-control">
            <span className="label-text text-[11px]">Тип</span>
            <select
              className="select select-bordered select-sm"
              value={hair}
              onChange={(e) => setHair(e.target.value as "all" | "yes" | "no")}
            >
              <option value="all">Усі товари</option>
              <option value="yes">Волосся</option>
              <option value="no">Інший товар</option>
            </select>
          </label>
          <label className="form-control">
            <span className="label-text text-[11px]">Пошук</span>
            <input
              className="input input-bordered input-sm w-48"
              placeholder="Номер, назва…"
              value={draftQuery}
              onChange={(e) => setDraftQuery(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-1 text-xs pb-2">
            <input type="checkbox" checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)} />
            показати нульові
          </label>
        </div>

        {data?.period.snapshotMissing && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            Немає знімка за {monthLabel(year, month)}. Для минулих місяців знімок з’являється після синхронізації в тому місяці. Оберіть поточний місяць або натисніть «Оновити з Altegio».
          </p>
        )}

        {data?.period.isLive && (
          <p className="text-[11px] text-gray-500">
            Показано живі залишки на зараз ({monthLabel(year, month)}). Минулий місяць — зріз на момент останнього оновлення в тому місяці.
          </p>
        )}

        {loading && <p className="text-sm text-gray-500">Завантаження…</p>}

        {!loading && (
          <div className="overflow-x-auto bg-white rounded-xl border">
            <table className="table table-xs">
              <thead>
                <tr>
                  <th>
                    <button type="button" className="font-semibold" onClick={() => handleSort("sku")}>
                      №{sortMark("sku")}
                    </button>
                  </th>
                  <th>
                    <button type="button" className="font-semibold" onClick={() => handleSort("title")}>
                      Товар{sortMark("title")}
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
                  <th className="text-right">Собівартість</th>
                  <th className="text-right">
                    <button type="button" className="font-semibold" onClick={() => handleSort("value")}>
                      Сума{sortMark("value")}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(data?.stocks || []).map((row) => (
                  <tr key={row.id} className={row.product.isHair ? "bg-rose-50" : ""}>
                    <td className="tabular-nums text-gray-500">{row.product.sku ?? "—"}</td>
                    <td>
                      {row.product.title}
                      {row.product.lengthCm ? ` · ${row.product.lengthCm} см` : ""}
                      {row.product.weightGrams ? ` · ${row.product.weightGrams} г` : ""}
                    </td>
                    <td>{row.product.groupTitle || row.product.category || "—"}</td>
                    <td>{row.storage.title}</td>
                    <td className="text-right tabular-nums">
                      {formatQty(row.quantity)} {row.product.unit}
                    </td>
                    <td className="text-right tabular-nums">{formatMoney(row.costPerUnit)} грн</td>
                    <td className="text-right tabular-nums font-medium">{formatMoney(row.valueUah)} грн</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data?.stocks?.length && !data?.period.snapshotMissing && (
              <p className="p-4 text-sm text-gray-500">Немає рядків. Натисніть «Оновити з Altegio», щоб залити каталог і залишки.</p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border p-3">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="text-sm font-bold mt-1 break-words">{value}</p>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WarehouseCreateButton } from "./_components/WarehouseCreateButton";
import { WarehouseColumnFilter, WarehouseFilterOption } from "./_components/WarehouseColumnFilter";
import { useWarehouseSearch } from "./_components/WarehouseChrome";
import { WarehouseMovementLog } from "./_components/WarehouseMovementLog";
import type { WarehouseMovementKind, WarehouseMovementLogRow } from "@/lib/warehouse/movement-log-types";

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
  khvostyMerge?: { targetGroupId?: string; movedKresco: number; deletedKrescoGroups: string[]; error?: string };
  stocks: StockRow[];
  movementLog?: WarehouseMovementLogRow[];
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
  const { searchDraft } = useWarehouseSearch();
  const [hair, setHair] = useState<"all" | "yes" | "no">("all");
  const [storageId, setStorageId] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [movementKinds, setMovementKinds] = useState<WarehouseMovementKind[]>([]);
  const [sort, setSort] = useState<SortKey>("title");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const createdGroupsRef = useRef<Array<{ id: string; title: string }>>([]);

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
        groupIds: groupIds.join(","),
        sort,
        order,
        _: String(Date.now()),
      });
      const res = await fetch(`/api/admin/warehouse?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      const json = (await res.json()) as Dashboard;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const extras = createdGroupsRef.current;
      const mergedGroups = [...(json.groups || [])];
      for (const extra of extras) {
        if (!mergedGroups.some((g) => g.id === extra.id || g.title === extra.title)) {
          mergedGroups.push(extra);
        }
      }
      if (json.khvostyMerge?.targetGroupId && !mergedGroups.some((g) => g.title === "Хвости")) {
        mergedGroups.unshift({ id: json.khvostyMerge.targetGroupId, title: "Хвости" });
      }
      mergedGroups.sort((a, b) => {
        if (a.title === "Хвости") return -1;
        if (b.title === "Хвости") return 1;
        return a.title.localeCompare(b.title, "uk");
      });
      setData({ ...json, groups: mergedGroups });
      if (json.khvostyMerge?.error) {
        setNotice(`Злиття у «Хвости»: ${json.khvostyMerge.error}`);
      } else if (json.khvostyMerge && json.khvostyMerge.movedKresco > 0) {
        const deleted = json.khvostyMerge.deletedKrescoGroups.length
          ? `; видалено порожні: ${json.khvostyMerge.deletedKrescoGroups.join(", ")}`
          : "";
        setNotice(`У «Хвости» перенесено ${json.khvostyMerge.movedKresco} карток${deleted}.`);
      }
      if (storageId && !(json.storages || []).some((s) => s.id === storageId)) {
        setStorageId("");
      }
      const knownGroupIds = new Set(mergedGroups.map((g) => g.id));
      if (groupIds.some((id) => !knownGroupIds.has(id))) {
        setGroupIds(groupIds.filter((id) => knownGroupIds.has(id)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка завантаження");
    } finally {
      setLoading(false);
    }
  }, [year, month, query, hair, storageId, groupIds, sort, order]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchDraft.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchDraft]);

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
  const periodActive = month !== now.month || year !== now.year;

  const onCreatedGroup = (row: { id: string; title: string }) => {
    createdGroupsRef.current = [
      ...createdGroupsRef.current.filter((g) => g.id !== row.id && g.title !== row.title),
      { id: row.id, title: row.title },
    ];
    setNotice(`Групу «${row.title}» створено лише в Kresco.`);
    setData((prev) => {
      if (!prev) return prev;
      const groups = [
        ...(prev.groups || []).filter((g) => g.id !== row.id && g.title !== row.title),
        { id: row.id, title: row.title },
      ].sort((a, b) => {
        if (a.title === "Хвости") return -1;
        if (b.title === "Хвости") return 1;
        return a.title.localeCompare(b.title, "uk");
      });
      return { ...prev, groups };
    });
    setGroupIds((prev) => (prev.includes(row.id) ? prev : [...prev, row.id]));
  };

  return (
    <main>
      <section className="mx-auto p-3">
        {notice && (
          <div
            className={`alert text-sm py-2 mb-3 ${
              notice.startsWith("Злиття у") ? "alert-warning" : "alert-success"
            }`}
          >
            {notice}
          </div>
        )}
        {error && <div className="alert alert-error text-sm py-2 mb-3">{error}</div>}

        <div className="flex flex-col md:flex-row gap-3 items-start">
          <aside className="w-full md:w-[280px] shrink-0 md:sticky md:top-12 space-y-2">
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
              {data?.period.isLive && (
                <p className="text-[11px] text-gray-500 leading-snug">
                  Живі залишки на зараз ({monthLabel(year, month)}). Минулий місяць — зріз на момент останнього оновлення
                  в тому місяці.
                </p>
              )}
            </div>

            <div className="bg-white border rounded-xl p-2.5 space-y-1">
              <StatLine label="Сума залишків" value={`${formatMoney(data?.filteredTotals.valueUah || 0)} грн`} />
              <StatLine label="Волосся" value={`${formatMoney(data?.filteredTotals.hairUah || 0)} грн`} />
              <StatLine label="Рядків" value={String(data?.filteredTotals.rows || 0)} />
              <StatLine label="Оновлено" value={formatDateTime(data?.period.lastSyncedAt || null)} />
            </div>

            <WarehouseMovementLog
              rows={data?.movementLog || []}
              kinds={movementKinds}
              onKindsChange={setMovementKinds}
            />
          </aside>

          <div className="flex-1 min-w-0 w-full space-y-2">
            {data?.period.snapshotMissing && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                Немає знімка за {monthLabel(year, month)}. Для минулих місяців знімок з’являється після синхронізації в
                тому місяці. Оберіть поточний місяць або натисніть «Оновити з Altegio».
              </p>
            )}

            {loading && <p className="text-sm text-gray-500">Завантаження…</p>}

            <div className="overflow-x-auto bg-white rounded-xl border">
                <table className="table table-xs w-full">
                  <thead className="sticky top-10 z-10 bg-white shadow-sm [&_th]:bg-white">
                    <tr>
                      <th className="w-14">
                        <div className="flex items-center gap-1">
                          <span>№</span>
                          <WarehouseColumnFilter columnLabel="Період" active={periodActive}>
                            {(close) => (
                              <div className="space-y-2">
                                <p className="text-[11px] text-gray-500 px-2">Кінець місяця</p>
                                <div className="flex gap-1 px-2">
                                  <select
                                    className="select select-bordered select-xs flex-1"
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
                                    className="select select-bordered select-xs flex-1"
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
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-xs w-full"
                                  onClick={() => {
                                    setMonth(now.month);
                                    setYear(now.year);
                                    close();
                                  }}
                                >
                                  Поточний місяць
                                </button>
                              </div>
                            )}
                          </WarehouseColumnFilter>
                        </div>
                      </th>
                      <th>
                        <button type="button" className="font-semibold" onClick={() => handleSort("title")}>
                          Код Товару{sortMark("title")}
                        </button>
                      </th>
                      <th>
                        <div className="flex items-center gap-1">
                          <span className="font-semibold">Назва Товару</span>
                          <WarehouseColumnFilter columnLabel="Тип" active={hair !== "all"}>
                            {(close) => (
                              <div className="space-y-0.5">
                                {(
                                  [
                                    ["all", "Усі товари"],
                                    ["yes", "Волосся"],
                                    ["no", "Інший товар"],
                                  ] as const
                                ).map(([id, label]) => (
                                  <WarehouseFilterOption
                                    key={id}
                                    label={label}
                                    selected={hair === id}
                                    onClick={() => {
                                      setHair(id);
                                      close();
                                    }}
                                  />
                                ))}
                              </div>
                            )}
                          </WarehouseColumnFilter>
                        </div>
                      </th>
                      <th>
                        <div className="flex items-center gap-1">
                          <button type="button" className="font-semibold" onClick={() => handleSort("category")}>
                            Категорія{sortMark("category")}
                          </button>
                          <WarehouseColumnFilter columnLabel="Категорія" active={groupIds.length > 0}>
                            {() => (
                              <div className="space-y-1">
                                <p className="text-[11px] text-gray-500 px-2">Можна обрати кілька</p>
                                <div className="max-h-64 overflow-y-auto space-y-0.5">
                                  <WarehouseFilterOption
                                    label="Усі"
                                    selected={groupIds.length === 0}
                                    onClick={() => setGroupIds([])}
                                  />
                                  {(data?.groups || []).map((g) => (
                                    <WarehouseFilterOption
                                      key={g.id}
                                      label={g.title}
                                      selected={groupIds.includes(g.id)}
                                      onClick={() => {
                                        setGroupIds((prev) =>
                                          prev.includes(g.id) ? prev.filter((id) => id !== g.id) : [...prev, g.id],
                                        );
                                      }}
                                    />
                                  ))}
                                </div>
                                <div className="pt-1 border-t">
                                  <WarehouseCreateButton kind="group" compact onCreated={onCreatedGroup} />
                                </div>
                              </div>
                            )}
                          </WarehouseColumnFilter>
                        </div>
                      </th>
                      <th>
                        <div className="flex items-center gap-1">
                          <button type="button" className="font-semibold" onClick={() => handleSort("storage")}>
                            Склад{sortMark("storage")}
                          </button>
                          <WarehouseColumnFilter columnLabel="Склад" active={Boolean(storageId)}>
                            {(close) => (
                              <div className="space-y-1">
                                <div className="max-h-64 overflow-y-auto space-y-0.5">
                                  <WarehouseFilterOption
                                    label="Усі"
                                    selected={!storageId}
                                    onClick={() => {
                                      setStorageId("");
                                      close();
                                    }}
                                  />
                                  {(data?.storages || []).map((s) => (
                                    <WarehouseFilterOption
                                      key={s.id}
                                      label={s.title}
                                      selected={storageId === s.id}
                                      onClick={() => {
                                        setStorageId(s.id);
                                        close();
                                      }}
                                    />
                                  ))}
                                </div>
                                <div className="pt-1 border-t">
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
                              </div>
                            )}
                          </WarehouseColumnFilter>
                        </div>
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
                    {!loading &&
                      stocks.map((row, index) => (
                      <tr key={row.id}>
                        <td className="tabular-nums text-gray-500">{index + 1}</td>
                        <td className="tabular-nums font-medium">{row.product.title || "—"}</td>
                        <td className="text-gray-700">
                          {[
                            row.product.lengthCm ? `${row.product.lengthCm} см` : "",
                            row.product.weightGrams ? `${row.product.weightGrams} г` : "",
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
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
                {!loading && !stocks.length && !data?.period.snapshotMissing && (
                  <p className="p-4 text-sm text-gray-500">
                    Немає рядків. Натисніть «Оновити з Altegio», щоб залити каталог і залишки.
                  </p>
                )}
              </div>
          </div>
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

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { navTileClass } from "@/app/admin/_components/nav-tile";
import { WarehouseCreateButton } from "./_components/WarehouseCreateButton";
import { WarehouseColumnFilter, WarehouseFilterOption } from "./_components/WarehouseColumnFilter";
import { useWarehouseSearch, WAREHOUSE_HEADER_ACTIONS_ID } from "./_components/WarehouseChrome";
import {
  Banner,
  cardClass,
  fieldClass,
  ghostButtonClass,
  tableClass,
  tdClass,
  theadRowClass,
  thClass,
  tileButtonClass,
  tileFaceClass,
  tileGridClass,
  trClass,
} from "./_components/warehouse-ui";
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
  groups?: Array<{ id: string; title: string; quantity?: number }>;
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
  /** Місце в шапці Складу для «Оновити з Altegio» */
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHeaderSlot(document.getElementById(WAREHOUSE_HEADER_ACTIONS_ID));
  }, []);

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

  const tableHeight = "calc(100vh - 3.25rem - var(--admin-nav-h, 0px))";

  return (
    <main className="flex flex-col overflow-hidden px-2 pb-2" style={{ height: tableHeight }}>
      {headerSlot
        ? createPortal(
            <button
              type="button"
              className={navTileClass(false)}
              onClick={() => void handleSync()}
              disabled={syncing}
              title="Залишки — дзеркало Altegio. Прийомку, списання й інвентаризацію робіть у вкладці Документи — вони одразу йдуть у склад Altegio."
            >
              {syncing ? "Оновлення…" : "Оновити з Altegio"}
            </button>,
            headerSlot,
          )
        : null}

      {/* Плитки підсумків — як плитки рахунків у Касі */}
      <div className={`${tileGridClass} shrink-0 py-2`}>
        <div className={tileFaceClass} style={{ background: "#f3f5f8" }}>
          <span className="text-[10px] font-medium leading-tight text-gray-700">Сума залишків</span>
          <span className="mt-0.5 text-sm font-semibold tabular-nums">{formatMoney(data?.filteredTotals.valueUah || 0)} грн</span>
          {data?.period.isLive ? (
            <span className="text-[10px] text-gray-500">живі · {monthLabel(year, month)}</span>
          ) : data ? (
            <span className="text-[10px] text-gray-500">зріз · {monthLabel(year, month)}</span>
          ) : null}
        </div>
        <button
          type="button"
          className={`${tileButtonClass} ${hair === "yes" ? "ring-2 ring-amber-300" : ""}`}
          style={{ background: "#f6efdf" }}
          aria-pressed={hair === "yes"}
          title={hair === "yes" ? "Показати всі товари" : "Показати лише волосся"}
          onClick={() => setHair((prev) => (prev === "yes" ? "all" : "yes"))}
        >
          <span className="text-[10px] font-medium leading-tight text-gray-700">Волосся</span>
          <span className="mt-0.5 text-sm font-semibold tabular-nums">{formatMoney(data?.filteredTotals.hairUah || 0)} грн</span>
        </button>
        <div className={tileFaceClass} style={{ background: "#f2f6f3" }}>
          <span className="text-[10px] font-medium leading-tight text-gray-700">Рядків</span>
          <span className="mt-0.5 text-sm font-semibold tabular-nums">{data?.filteredTotals.rows || 0}</span>
        </div>
        <div className={tileFaceClass} style={{ background: "#f5f3f7" }}>
          <span className="text-[10px] font-medium leading-tight text-gray-700">Оновлено з Altegio</span>
          <span className="mt-0.5 text-xs font-semibold tabular-nums">{formatDateTime(data?.period.lastSyncedAt || null)}</span>
        </div>
        <Link href="/admin/warehouse/documents" className={tileButtonClass} style={{ background: "#e3edf9" }}>
          <span className="text-sm font-semibold text-gray-800">+ Документ</span>
          <span className="text-[10px] text-gray-600">прийомка · списання · інвентаризація</span>
        </Link>
      </div>

      <div className="shrink-0 space-y-2 empty:hidden">
        {notice && <Banner tone={notice.startsWith("Злиття у") ? "warning" : "success"}>{notice}</Banner>}
        {error && <Banner tone="error">{error}</Banner>}
        {data?.period.snapshotMissing && (
          <Banner tone="warning">
            Немає знімка за {monthLabel(year, month)}. Для минулих місяців знімок з’являється після синхронізації в тому
            місяці. Оберіть поточний місяць або натисніть «Оновити з Altegio».
          </Banner>
        )}
      </div>

      <div className="mt-2 grid min-h-0 flex-1 grid-cols-1 gap-2 md:grid-cols-[260px_minmax(0,1fr)]">
        {/* Рух за місяць — ліворуч від таблиці */}
        <aside className="min-h-0 overflow-y-auto">
          <WarehouseMovementLog rows={data?.movementLog || []} kinds={movementKinds} onKindsChange={setMovementKinds} />
        </aside>
        <div className={`${cardClass} min-h-0 overflow-auto`}>
          <table className={tableClass}>
            <thead className="sticky top-0 z-10">
              <tr className={theadRowClass}>
                <th className={`${thClass} w-14 bg-gray-50`}>
                  <div className="flex items-center gap-1">
                    <span>№</span>
                    <WarehouseColumnFilter columnLabel="Період" active={periodActive}>
                      {(close) => (
                        <div className="space-y-2">
                          <p className="text-[11px] text-gray-500 px-2 normal-case">Кінець місяця</p>
                          <div className="flex gap-1 px-2">
                            <select
                              className={fieldClass}
                              value={month}
                              onChange={(e) => setMonth(Number(e.target.value))}
                            >
                              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                <option key={m} value={m}>
                                  {m.toString().padStart(2, "0")}
                                </option>
                              ))}
                            </select>
                            <select className={fieldClass} value={year} onChange={(e) => setYear(Number(e.target.value))}>
                              {years.map((y) => (
                                <option key={y} value={y}>
                                  {y}
                                </option>
                              ))}
                            </select>
                          </div>
                          <button
                            type="button"
                            className={`${ghostButtonClass} w-full normal-case`}
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
                <th className={`${thClass} bg-gray-50`}>
                  <button type="button" className="uppercase" onClick={() => handleSort("title")}>
                    Код товару{sortMark("title")}
                  </button>
                </th>
                <th className={`${thClass} bg-gray-50`}>
                  <div className="flex items-center gap-1">
                    <span>Назва товару</span>
                    <WarehouseColumnFilter columnLabel="Тип" active={hair !== "all"}>
                      {(close) => (
                        <div className="space-y-0.5 normal-case">
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
                <th className={`${thClass} bg-gray-50`}>
                  <div className="flex items-center gap-1">
                    <button type="button" className="uppercase" onClick={() => handleSort("category")}>
                      Категорія{sortMark("category")}
                    </button>
                    <WarehouseColumnFilter columnLabel="Категорія" active={groupIds.length > 0}>
                      {() => (
                        <div className="space-y-1 normal-case">
                          <p className="text-[11px] text-gray-500 px-2">Можна обрати кілька</p>
                          <div className="max-h-64 overflow-y-auto space-y-0.5">
                            <WarehouseFilterOption label="Усі" selected={groupIds.length === 0} onClick={() => setGroupIds([])} />
                            {(data?.groups || []).map((g) => {
                              const qty = Number(g.quantity) || 0;
                              const qtyLabel = Number.isInteger(qty) ? String(qty) : formatQty(qty);
                              return (
                                <WarehouseFilterOption
                                  key={g.id}
                                  label={`${g.title} (${qtyLabel})`}
                                  selected={groupIds.includes(g.id)}
                                  onClick={() => {
                                    setGroupIds((prev) =>
                                      prev.includes(g.id) ? prev.filter((id) => id !== g.id) : [...prev, g.id],
                                    );
                                  }}
                                />
                              );
                            })}
                          </div>
                          <div className="pt-1 border-t">
                            <WarehouseCreateButton kind="group" compact onCreated={onCreatedGroup} />
                          </div>
                        </div>
                      )}
                    </WarehouseColumnFilter>
                  </div>
                </th>
                <th className={`${thClass} bg-gray-50`}>
                  <div className="flex items-center gap-1">
                    <button type="button" className="uppercase" onClick={() => handleSort("storage")}>
                      Склад{sortMark("storage")}
                    </button>
                    <WarehouseColumnFilter columnLabel="Склад" active={Boolean(storageId)}>
                      {(close) => (
                        <div className="space-y-1 normal-case">
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
                <th className={`${thClass} bg-gray-50 text-right`}>
                  <button type="button" className="uppercase" onClick={() => handleSort("qty")}>
                    К-сть{sortMark("qty")}
                  </button>
                </th>
                <th className={`${thClass} bg-gray-50 text-right`}>
                  <span>Собівартість</span>
                  <div className="text-[10px] font-semibold normal-case text-gray-700 tabular-nums">{formatMoney(costTotal)} грн</div>
                </th>
                <th className={`${thClass} bg-gray-50 text-right`}>
                  <button type="button" className="uppercase" onClick={() => handleSort("value")}>
                    Сума{sortMark("value")}
                  </button>
                  <div className="text-[10px] font-semibold normal-case text-gray-700 tabular-nums">{formatMoney(valueTotal)} грн</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                stocks.map((row, index) => (
                  <tr key={row.id} className={`${trClass} hover:bg-slate-50`}>
                    <td className={`${tdClass} tabular-nums text-gray-500`}>{index + 1}</td>
                    <td className={`${tdClass} tabular-nums font-medium text-gray-900`}>{row.product.title || "—"}</td>
                    <td className={`${tdClass} text-gray-700`}>
                      {[
                        row.product.lengthCm ? `${row.product.lengthCm} см` : "",
                        row.product.weightGrams ? `${row.product.weightGrams} г` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td className={`${tdClass} text-gray-700`}>{row.product.groupTitle || row.product.category || "—"}</td>
                    <td className={`${tdClass} text-gray-700`}>{row.storage.title}</td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums`}>
                      {formatQty(row.quantity)} {displayUnit(row.product.unit)}
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-right tabular-nums text-gray-600`}>
                      {formatMoney(row.costPerUnit)} грн
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-right font-semibold tabular-nums`}>
                      {formatMoney(row.valueUah)} грн
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {loading && <p className="px-3 py-6 text-center text-sm text-gray-500">Завантаження…</p>}
          {!loading && !stocks.length && !data?.period.snapshotMissing && (
            <p className="px-3 py-6 text-center text-sm text-gray-500">
              Немає рядків. Натисніть «Оновити з Altegio», щоб залити каталог і залишки.
            </p>
          )}
        </div>

      </div>
    </main>
  );
}


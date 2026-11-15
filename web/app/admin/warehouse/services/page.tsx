"use client";

import { useCallback, useEffect, useState } from "react";
import { navTileClass } from "@/app/admin/_components/nav-tile";
import {
  Banner,
  PrettySelect,
  StatusPill,
  WarehouseModal,
  cardClass,
  fieldClass,
  formRowClass,
  ghostButtonClass,
  labelClass,
  tableClass,
  tdClass,
  theadRowClass,
  thClass,
  tileButtonClass,
  tileFaceClass,
  tileGridClass,
  tintButtonClass,
  trClass,
} from "../_components/warehouse-ui";

type AltegioLink = {
  id: string;
  altegioServiceId: number;
  altegioTitle: string | null;
  isDefault: boolean;
};

type ServiceRow = {
  id: string;
  title: string;
  kind: string;
  durationSec: number;
  salePrice: number;
  isActive: boolean;
  source: string;
  altegioLinks?: AltegioLink[];
};

type UnmappedRow = { id: number; title: string; durationSec: number };

type CatalogItem = {
  altegioServiceId: number;
  altegioTitle: string;
  action: "create" | "update" | "activate" | "relink";
  title: string;
  kind: string;
  durationSec: number;
  price: number;
  priceRange: { min: number; max: number } | null;
  keepsKrescoPrice: boolean;
};

type CatalogResult = {
  dryRun: boolean;
  altegioTotal: number;
  alreadyLinked: number;
  items: CatalogItem[];
  skippedInactive: Array<{ id: number; title: string }>;
  skippedUnused: Array<{ id: number; title: string }>;
  usedDays: number;
  krescoWithoutAltegio: Array<{ id: string; title: string; kind: string; salePrice: number }>;
};

const CATALOG_ACTION_LABEL: Record<CatalogItem["action"], string> = {
  create: "Нова",
  update: "Оновити й увімкнути",
  activate: "Увімкнути",
  relink: "Зв’язати з Altegio",
};

const KIND_LABEL: Record<string, string> = {
  consultation: "Консультація",
  hair: "Нарощування",
  other: "Інше",
};

/** Відтінки типів послуг — у палітрі плиток Каси. */
const KIND_TINT: Record<string, string> = {
  consultation: "#e6eef8",
  hair: "#f6efdf",
  other: "#f2f6f3",
};

/** Поле в рядку таблиці: нижче й тихіше, ніж поле форми. */
const cellInputClass =
  "h-7 rounded-md border border-transparent bg-transparent px-1.5 text-[11px] text-gray-900 hover:border-slate-200 hover:bg-white focus:border-blue-300 focus:bg-white focus:outline-none";

function formatPrice(n: number) {
  const v = Number(n) || 0;
  return v.toLocaleString("uk-UA", { maximumFractionDigits: 2 });
}

export default function JournalServicesPage() {
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [unmapped, setUnmapped] = useState<UnmappedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  /** Повний імпорт каталогу Altegio: перегляд змін перед записом */
  const [catalog, setCatalog] = useState<CatalogResult | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newKind, setNewKind] = useState("other");
  const [newDurationMin, setNewDurationMin] = useState("60");
  const [newSalePrice, setNewSalePrice] = useState("0");
  /** Локальні чернетки під час редагування (до blur) */
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [titleDrafts, setTitleDrafts] = useState<Record<string, string>>({});
  const [durationDrafts, setDurationDrafts] = useState<Record<string, string>>({});
  /** Фільтр за типом — натискання на плитку типу */
  const [kindFilter, setKindFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/journal/services?all=1", { credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка");
      setServices(json.services || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const importFromAltegio = async () => {
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/journal/services", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка імпорту");
      setServices(json.services || []);
      setUnmapped(json.result?.unmapped || []);
      setNotice(
        `Мапінг: оновлено назв ${json.result?.linksUpdated ?? 0}` +
          (json.result?.unmapped?.length
            ? `, незмаплених у Altegio: ${json.result.unmapped.length}`
            : ""),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setImporting(false);
    }
  };

  // Повний імпорт каталогу: write=false — лише перегляд, write=true — запис у базу.
  const runCatalogImport = async (write: boolean) => {
    setCatalogBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/journal/services", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: write ? "catalogImport" : "catalogPreview" }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка імпорту каталогу");
      setServices(json.services || []);
      const result = json.result as CatalogResult;
      if (write) {
        setCatalog(null);
        setNotice(`Каталог імпортовано: змінено послуг ${result.items.length}.`);
      } else {
        setCatalog(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setCatalogBusy(false);
    }
  };

  const setKind = async (id: string, kind: string) => {
    setError(null);
    try {
      const res = await fetch("/api/admin/journal/services", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kind", id, kind }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка");
      setServices((prev) => prev.map((s) => (s.id === id ? { ...s, kind } : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    }
  };

  const setSalePrice = async (id: string, raw: string) => {
    setError(null);
    const salePrice = Math.max(0, Number(raw) || 0);
    try {
      const res = await fetch("/api/admin/journal/services", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "salePrice", id, salePrice }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка збереження ціни");
      setServices((prev) =>
        prev.map((s) => (s.id === id ? { ...s, salePrice: Number(json.service?.salePrice) || salePrice } : s)),
      );
      setPriceDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    }
  };

  const setTitle = async (id: string, raw: string) => {
    setError(null);
    const title = raw.trim();
    if (!title) {
      setError("Назва не може бути порожньою");
      setTitleDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    try {
      const res = await fetch("/api/admin/journal/services", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id, title }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка збереження назви");
      setServices((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title: String(json.service?.title || title) } : s)),
      );
      setTitleDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    }
  };

  const setDurationMin = async (id: string, raw: string) => {
    setError(null);
    const minutes = Math.max(5, Math.round(Number(raw) || 0));
    const durationSec = minutes * 60;
    try {
      const res = await fetch("/api/admin/journal/services", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id, durationSec }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка збереження тривалості");
      const savedSec = Number(json.service?.durationSec) || durationSec;
      setServices((prev) => prev.map((s) => (s.id === id ? { ...s, durationSec: savedSec } : s)));
      setDurationDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    }
  };

  const setActive = async (id: string, isActive: boolean) => {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/journal/services", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id, isActive }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка зміни статусу");
      setServices((prev) =>
        prev.map((s) => (s.id === id ? { ...s, isActive: Boolean(json.service?.isActive ?? isActive) } : s)),
      );
      setNotice(isActive ? "Послугу активовано" : "Послугу деактивовано");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    }
  };

  const createService = async () => {
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/journal/services", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          title: newTitle,
          kind: newKind,
          durationMin: Number(newDurationMin) || 60,
          salePrice: Math.max(0, Number(newSalePrice) || 0),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка створення");
      setNotice(`Створено послугу «${json.service?.title}» (лише Kresco, без Altegio)`);
      setNewTitle("");
      setNewKind("other");
      setNewDurationMin("60");
      setNewSalePrice("0");
      setShowCreate(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setCreating(false);
    }
  };

  const active = services.filter((s) => s.isActive);
  const inactive = services.filter((s) => !s.isActive);
  const visible = kindFilter ? active.filter((s) => s.kind === kindFilter) : active;

  const clearDraft = (setter: typeof setTitleDrafts, id: string) =>
    setter((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  return (
    <main className="space-y-2 px-2 pb-6">
      {/* Плитки типів — фільтр таблиці; «+ Послуга» — як «+ Рахунок» у Касі */}
      <div className={`${tileGridClass} py-2`}>
        <button
          type="button"
          className={`${tileButtonClass} ${kindFilter === "" ? "ring-2 ring-blue-300" : ""}`}
          style={{ background: "#f3f5f8" }}
          aria-pressed={kindFilter === ""}
          onClick={() => setKindFilter("")}
        >
          <span className="text-[10px] font-medium leading-tight text-gray-700">Усі активні</span>
          <span className="mt-0.5 text-sm font-semibold tabular-nums">{loading ? "…" : active.length}</span>
        </button>
        {Object.entries(KIND_LABEL).map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            className={`${tileButtonClass} ${kindFilter === kind ? "ring-2 ring-blue-300" : ""}`}
            style={{ background: KIND_TINT[kind] || "#f3f5f8" }}
            aria-pressed={kindFilter === kind}
            title={kindFilter === kind ? "Показати всі" : `Лише: ${label}`}
            onClick={() => setKindFilter((prev) => (prev === kind ? "" : kind))}
          >
            <span className="text-[10px] font-medium leading-tight text-gray-700">{label}</span>
            <span className="mt-0.5 text-sm font-semibold tabular-nums">
              {loading ? "…" : active.filter((s) => s.kind === kind).length}
            </span>
          </button>
        ))}
        <button type="button" className={tileButtonClass} style={{ background: "#e3edf9" }} onClick={() => setShowCreate(true)}>
          <span className="text-sm font-semibold text-gray-800">+ Послуга</span>
          <span className="text-[10px] text-gray-600">лише Kresco</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={navTileClass(false)} disabled={importing} onClick={() => void importFromAltegio()}>
          {importing ? "Імпорт…" : "Оновити мапінг з Altegio"}
        </button>
        <button type="button" className={navTileClass(false)} disabled={catalogBusy} onClick={() => void runCatalogImport(false)}>
          {catalogBusy && !catalog ? "Читаю Altegio…" : "Імпортувати послуги з Altegio"}
        </button>
        <p className="min-w-[240px] flex-1 text-[10px] leading-snug text-gray-500">
          Каталог послуг Kresco. Кілька варіантів Altegio («4 руки», «2 майстри») зведено в одну послугу — мапінг потрібен для
          dual-write. Назву, тип, тривалість і ціну міняйте прямо в таблиці. Ціна — повна ціна Kresco.
        </p>
      </div>

      {notice && <Banner tone="success">{notice}</Banner>}
      {error && !showCreate && !catalog && <Banner tone="error">{error}</Banner>}

      <div className={`${cardClass} overflow-x-auto`}>
        <table className={`${tableClass} min-w-[52rem]`}>
          <thead>
            <tr className={theadRowClass}>
              <th className={`${thClass} w-10`}>№</th>
              <th className={`${thClass} min-w-[16rem]`}>Послуга Kresco</th>
              <th className={`${thClass} w-40`}>Тип</th>
              <th className={`${thClass} w-20 text-right`}>Хв</th>
              <th className={`${thClass} w-28 text-right`}>Ціна, ₴</th>
              <th className={`${thClass} w-24`}>Джерело</th>
              <th className={`${thClass} w-44`}>Altegio</th>
              <th className={`${thClass} w-14`} />
            </tr>
          </thead>
          <tbody>
            {visible.map((s, index) => (
              <tr key={s.id} className={`${trClass} hover:bg-slate-50`}>
                <td className={`${tdClass} tabular-nums text-gray-500`}>{index + 1}</td>
                <td className={tdClass}>
                  <input
                    className={`${cellInputClass} w-full font-medium`}
                    type="text"
                    title="Назва послуги Kresco"
                    value={titleDrafts[s.id] ?? s.title}
                    onChange={(e) => setTitleDrafts((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      if (raw === s.title) {
                        clearDraft(setTitleDrafts, s.id);
                        return;
                      }
                      void setTitle(s.id, raw);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                </td>
                <td className={tdClass}>
                  <select className={`${cellInputClass} w-full min-w-[8.5rem]`} value={s.kind} onChange={(e) => void setKind(s.id, e.target.value)}>
                    {Object.entries(KIND_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={`${tdClass} text-right`}>
                  <input
                    className={`${cellInputClass} w-16 text-right tabular-nums`}
                    type="number"
                    min={5}
                    step={5}
                    title="Тривалість, хвилини"
                    value={durationDrafts[s.id] ?? String(Math.round((s.durationSec || 0) / 60))}
                    onChange={(e) => setDurationDrafts((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    onBlur={(e) => {
                      const raw = e.target.value;
                      const next = Math.max(5, Math.round(Number(raw) || 0));
                      const current = Math.round((s.durationSec || 0) / 60);
                      if (next === current) {
                        clearDraft(setDurationDrafts, s.id);
                        return;
                      }
                      void setDurationMin(s.id, raw);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                </td>
                <td className={`${tdClass} text-right`}>
                  <input
                    className={`${cellInputClass} w-24 text-right font-semibold tabular-nums ${Number(s.salePrice) > 0 ? "" : "text-red-600"}`}
                    type="number"
                    min={0}
                    step={1}
                    title="Повна ціна Kresco"
                    value={priceDrafts[s.id] ?? String(Number(s.salePrice) || 0)}
                    onChange={(e) => setPriceDrafts((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    onBlur={(e) => {
                      const raw = e.target.value;
                      const next = Math.max(0, Number(raw) || 0);
                      const current = Number(s.salePrice) || 0;
                      if (next === current) {
                        clearDraft(setPriceDrafts, s.id);
                        return;
                      }
                      void setSalePrice(s.id, raw);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                </td>
                <td className={`${tdClass} text-gray-500`}>
                  {s.source === "kresco" ? <StatusPill tone="muted">лише Kresco</StatusPill> : <StatusPill tone="ok">мапінг</StatusPill>}
                </td>
                <td className={`${tdClass} text-gray-600`}>
                  {(s.altegioLinks || []).length === 0 ? (
                    <span className="text-gray-400">—</span>
                  ) : (
                    <details>
                      <summary className="cursor-pointer tabular-nums">
                        {(s.altegioLinks || []).length} id
                        {(s.altegioLinks || []).some((l) => l.isDefault)
                          ? ` · ★ ${(s.altegioLinks || []).find((l) => l.isDefault)?.altegioServiceId}`
                          : ""}
                      </summary>
                      <ul className="mt-1 space-y-0.5 border-l border-slate-200 pl-2">
                        {(s.altegioLinks || []).map((l) => (
                          <li key={l.id} className="tabular-nums">
                            {l.altegioServiceId}
                            {l.isDefault ? " ★" : ""} — {l.altegioTitle || "—"}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
                <td className={`${tdClass} text-right`}>
                  <button
                    type="button"
                    className="rounded-md px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-red-50 hover:text-red-600"
                    title="Деактивувати"
                    onClick={() => void setActive(s.id, false)}
                  >
                    Вимк.
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <p className="px-3 py-6 text-center text-sm text-gray-500">Завантаження…</p>}
        {!loading && visible.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-gray-500">
            {kindFilter ? "Немає послуг цього типу." : "Порожньо. Натисніть «Оновити мапінг з Altegio» або створіть послугу."}
          </p>
        )}
      </div>

      {unmapped.length > 0 && (
        <div className={`${cardClass} overflow-hidden`}>
          <div className="bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-950">
            Altegio без мапінгу ({unmapped.length}) · не потрапляють у каталог Kresco
          </div>
          <ul className="max-h-48 divide-y divide-gray-100 overflow-y-auto text-[10px]">
            {unmapped.map((u) => (
              <li key={u.id} className="px-2 py-1 tabular-nums text-gray-700">
                {u.id} — {u.title} ({Math.round(u.durationSec / 60)} хв)
              </li>
            ))}
          </ul>
        </div>
      )}

      {inactive.length > 0 && (
        <details className={`${cardClass} overflow-hidden`}>
          <summary className="cursor-pointer bg-slate-300 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-gray-900">
            Неактивні / старі імпорти ({inactive.length})
          </summary>
          <ul className="divide-y divide-gray-100 text-[10px]">
            {inactive.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 px-2 py-1 text-gray-600">
                <span>
                  {s.title} · {KIND_LABEL[s.kind] || s.kind}
                  {Number(s.salePrice) > 0 ? ` · ${formatPrice(s.salePrice)} ₴` : ""}
                </span>
                <button
                  type="button"
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-50"
                  onClick={() => void setActive(s.id, true)}
                >
                  Активувати
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {showCreate && (
        <WarehouseModal
          tint="#e3edf9"
          title="Нова послуга (лише Kresco)"
          onClose={() => setShowCreate(false)}
          footer={
            <>
              <button type="button" className={ghostButtonClass} onClick={() => setShowCreate(false)}>
                Скасувати
              </button>
              <button
                type="button"
                className={tintButtonClass()}
                style={{ background: "#e3edf9" }}
                disabled={creating || !newTitle.trim()}
                onClick={() => void createService()}
              >
                {creating ? "Збереження…" : "Зберегти"}
              </button>
            </>
          }
        >
          {error && <Banner tone="error">{error}</Banner>}
          <div className="space-y-2 rounded-xl border border-slate-200/80 bg-slate-50 p-3">
            <div className={formRowClass}>
              <span className={labelClass}>Назва</span>
              <input
                className={`${fieldClass} max-w-[260px]`}
                value={newTitle}
                autoFocus
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Наприклад: Корекція стрічок"
              />
            </div>
            <div className={formRowClass}>
              <span className={labelClass}>Тип</span>
              <div className="max-w-[260px]">
                <PrettySelect
                  value={newKind}
                  tint="#e3edf9"
                  options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))}
                  onChange={setNewKind}
                />
              </div>
            </div>
            <div className={formRowClass}>
              <span className={labelClass}>Тривалість, хв</span>
              <input
                className={`${fieldClass} max-w-[120px] tabular-nums`}
                type="number"
                min={5}
                step={5}
                value={newDurationMin}
                onChange={(e) => setNewDurationMin(e.target.value)}
              />
            </div>
            <div className={formRowClass}>
              <span className={labelClass}>Ціна, ₴</span>
              <input
                className={`${fieldClass} max-w-[120px] tabular-nums`}
                type="number"
                min={0}
                step={1}
                value={newSalePrice}
                onChange={(e) => setNewSalePrice(e.target.value)}
              />
            </div>
          </div>
          <p className="text-[10px] text-gray-500">Нова послуга живе лише в Kresco і в Altegio не відправляється.</p>
        </WarehouseModal>
      )}

      {catalog && (
        <WarehouseModal
          tint="#e5f2e9"
          title="Імпорт каталогу Altegio — перегляд"
          wide
          onClose={() => setCatalog(null)}
          footer={
            <>
              <button type="button" className={ghostButtonClass} disabled={catalogBusy} onClick={() => setCatalog(null)}>
                Закрити без запису
              </button>
              <button
                type="button"
                className={tintButtonClass()}
                style={{ background: "#e5f2e9" }}
                disabled={catalogBusy || catalog.items.length === 0}
                onClick={() => void runCatalogImport(true)}
              >
                {catalogBusy ? "Записую…" : `Записати в Kresco (${catalog.items.length})`}
              </button>
            </>
          }
        >
          {error && <Banner tone="error">{error}</Banner>}
          <div className={tileGridClass}>
            {[
              ["В Altegio", catalog.altegioTotal, "#f3f5f8"],
              ["Уже в Kresco", catalog.alreadyLinked, "#f2f6f3"],
              ["Буде змінено", catalog.items.length, "#e5f2e9"],
              [`Без записів ${catalog.usedDays} дн.`, catalog.skippedUnused.length, "#f6f3ee"],
              ["Вимкнені в Altegio", catalog.skippedInactive.length, "#f5f3f7"],
            ].map(([label, value, tint]) => (
              <div key={String(label)} className={`${tileFaceClass} min-h-[3.5rem]`} style={{ background: String(tint) }}>
                <span className="text-[10px] font-medium leading-tight text-gray-700">{label}</span>
                <span className="mt-0.5 text-sm font-semibold tabular-nums">{value}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-500">У базу ще нічого не записано.</p>
          {catalog.items.length > 0 ? (
            <div className="max-h-80 overflow-auto rounded-xl border border-gray-200">
              <table className={tableClass}>
                <thead className="sticky top-0">
                  <tr className={theadRowClass}>
                    <th className={`${thClass} bg-gray-50`}>Дія</th>
                    <th className={`${thClass} bg-gray-50`}>Послуга</th>
                    <th className={`${thClass} bg-gray-50`}>Тип</th>
                    <th className={`${thClass} bg-gray-50 text-right`}>Хв</th>
                    <th className={`${thClass} bg-gray-50 text-right`}>Ціна, ₴</th>
                    <th className={`${thClass} bg-gray-50`}>Примітка</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.items.map((item) => (
                    <tr key={item.altegioServiceId} className={trClass}>
                      <td className={`${tdClass} whitespace-nowrap font-semibold text-green-700`}>{CATALOG_ACTION_LABEL[item.action]}</td>
                      <td className={`${tdClass} text-gray-900`}>
                        {item.title}
                        {item.title !== item.altegioTitle && (
                          <span className="block text-gray-400">Altegio: {item.altegioTitle}</span>
                        )}
                      </td>
                      <td className={`${tdClass} whitespace-nowrap`}>{KIND_LABEL[item.kind] || item.kind}</td>
                      <td className={`${tdClass} text-right tabular-nums`}>{Math.round(item.durationSec / 60)}</td>
                      <td className={`${tdClass} text-right font-semibold tabular-nums ${item.price > 0 ? "" : "text-red-600"}`}>
                        {formatPrice(item.price)}
                      </td>
                      <td className={`${tdClass} text-gray-500`}>
                        {[
                          item.priceRange
                            ? `в Altegio ${formatPrice(item.priceRange.min)}–${formatPrice(item.priceRange.max)}, беремо нижню`
                            : "",
                          item.keepsKrescoPrice ? "ціна Kresco лишається" : "",
                          item.price > 0 ? "" : "без ціни — задати вручну",
                        ]
                          .filter(Boolean)
                          .join("; ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-gray-500">
              Змін немає — весь каталог Altegio вже в Kresco.
            </p>
          )}
          {catalog.krescoWithoutAltegio.length > 0 && (
            <Banner tone="warning">
              <p className="font-medium">Послуги Kresco без пари в Altegio ({catalog.krescoWithoutAltegio.length})</p>
              <p className="mb-1 text-[10px]">Записи з ними в Altegio не дублюються. Імпорт їх не змінює.</p>
              <ul className="space-y-0.5 text-[10px]">
                {catalog.krescoWithoutAltegio.map((s) => (
                  <li key={s.id}>
                    {s.title} · {KIND_LABEL[s.kind] || s.kind} · {formatPrice(s.salePrice)} ₴
                  </li>
                ))}
              </ul>
            </Banner>
          )}
          {catalog.skippedUnused.length > 0 && (
            <details className="text-[10px] text-gray-500">
              <summary className="cursor-pointer">
                Не було в записах за {catalog.usedDays} днів — не імпортуємо ({catalog.skippedUnused.length})
              </summary>
              <ul className="mt-1 space-y-0.5 pl-3">
                {catalog.skippedUnused.map((s) => (
                  <li key={s.id} className="tabular-nums">
                    {s.id} — {s.title}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {catalog.skippedInactive.length > 0 && (
            <details className="text-[10px] text-gray-500">
              <summary className="cursor-pointer">Вимкнені в Altegio — не імпортуємо ({catalog.skippedInactive.length})</summary>
              <ul className="mt-1 space-y-0.5 pl-3">
                {catalog.skippedInactive.map((s) => (
                  <li key={s.id} className="tabular-nums">
                    {s.id} — {s.title}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </WarehouseModal>
      )}
    </main>
  );
}

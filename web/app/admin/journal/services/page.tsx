"use client";

import { useCallback, useEffect, useState } from "react";

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

  return (
    <main className="p-3 space-y-3 max-w-6xl">
      <p className="text-xs text-gray-600 bg-white border rounded-xl px-3 py-2">
        Каталог послуг <strong>Kresco</strong>. З Altegio зведено кілька варіантів («4 руки», «2 майстри») в одну канонічну
        послугу — мапінг потрібен для dual-write. Назву, тип, тривалість і ціну можна змінювати прямо в таблиці.
        Ціна — повна ціна Kresco (не півціна варіантів Altegio). Нові послуги через «Створити послугу» живуть лише в
        Kresco і в Altegio не відправляються.
      </p>
      {notice && <div className="alert alert-success text-sm py-2">{notice}</div>}
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-sm btn-primary" disabled={importing} onClick={() => void importFromAltegio()}>
          {importing ? "Імпорт…" : "Оновити мапінг з Altegio"}
        </button>
        <button
          className="btn btn-sm btn-outline"
          type="button"
          disabled={catalogBusy}
          onClick={() => void runCatalogImport(false)}
        >
          {catalogBusy && !catalog ? "Читаю Altegio…" : "Імпортувати послуги з Altegio"}
        </button>
        <button className="btn btn-sm btn-outline" type="button" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Скасувати" : "Створити послугу"}
        </button>
      </div>

      {catalog && (
        <div className="bg-white border border-blue-200 rounded-xl p-3 space-y-2">
          <p className="text-sm font-medium">Перегляд імпорту каталогу — у базу ще нічого не записано</p>
          <p className="text-xs text-gray-600">
            В Altegio послуг: {catalog.altegioTotal}. Уже зв’язані й активні (не чіпаємо): {catalog.alreadyLinked}. Буде
            змінено: {catalog.items.length}. Не було в записах за {catalog.usedDays} днів (пропускаємо):{" "}
            {catalog.skippedUnused.length}. Вимкнені в Altegio (пропускаємо): {catalog.skippedInactive.length}.
          </p>
          {catalog.items.length > 0 ? (
            <div className="max-h-96 overflow-auto border rounded-lg">
              <table className="table table-xs">
                <thead>
                  <tr>
                    <th>Дія</th>
                    <th>Послуга</th>
                    <th>Тип</th>
                    <th className="text-right">Хв</th>
                    <th className="text-right">Ціна, ₴</th>
                    <th>Примітка</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.items.map((item) => (
                    <tr key={item.altegioServiceId}>
                      <td className="whitespace-nowrap">{CATALOG_ACTION_LABEL[item.action]}</td>
                      <td>
                        {item.title}
                        {item.title !== item.altegioTitle && (
                          <span className="block text-gray-400">Altegio: {item.altegioTitle}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">{KIND_LABEL[item.kind] || item.kind}</td>
                      <td className="text-right tabular-nums">{Math.round(item.durationSec / 60)}</td>
                      <td className={`text-right tabular-nums ${item.price > 0 ? "" : "text-red-600 font-medium"}`}>
                        {formatPrice(item.price)}
                      </td>
                      <td className="text-gray-500">
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
            <p className="text-sm text-gray-500">Змін немає — весь каталог Altegio вже в Kresco.</p>
          )}
          {catalog.krescoWithoutAltegio.length > 0 && (
            <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2">
              <p className="font-medium">Послуги Kresco без пари в Altegio ({catalog.krescoWithoutAltegio.length})</p>
              <p className="mb-1">Записи з ними в Altegio не дублюються. Імпорт їх не змінює.</p>
              <ul className="space-y-0.5">
                {catalog.krescoWithoutAltegio.map((s) => (
                  <li key={s.id}>
                    {s.title} · {KIND_LABEL[s.kind] || s.kind} · {formatPrice(s.salePrice)} ₴
                  </li>
                ))}
              </ul>
            </div>
          )}
          {catalog.skippedUnused.length > 0 && (
            <details className="text-xs text-gray-500">
              <summary>
                Не було в записах за {catalog.usedDays} днів — не імпортуємо ({catalog.skippedUnused.length})
              </summary>
              <ul className="mt-1 pl-3 space-y-0.5">
                {catalog.skippedUnused.map((s) => (
                  <li key={s.id} className="tabular-nums">
                    {s.id} — {s.title}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {catalog.skippedInactive.length > 0 && (
            <details className="text-xs text-gray-500">
              <summary>Вимкнені в Altegio — не імпортуємо ({catalog.skippedInactive.length})</summary>
              <ul className="mt-1 pl-3 space-y-0.5">
                {catalog.skippedInactive.map((s) => (
                  <li key={s.id} className="tabular-nums">
                    {s.id} — {s.title}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-sm btn-primary"
              type="button"
              disabled={catalogBusy || catalog.items.length === 0}
              onClick={() => void runCatalogImport(true)}
            >
              {catalogBusy ? "Записую…" : `Записати в Kresco (${catalog.items.length})`}
            </button>
            <button className="btn btn-sm btn-ghost" type="button" disabled={catalogBusy} onClick={() => setCatalog(null)}>
              Закрити без запису
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="bg-white border rounded-xl p-3 space-y-2 max-w-lg">
          <p className="text-sm font-medium">Нова послуга (лише Kresco)</p>
          <label className="form-control">
            <span className="label-text text-xs">Назва</span>
            <input
              className="input input-bordered input-sm"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Наприклад: Корекція стрічок"
            />
          </label>
          <div className="flex gap-2 flex-wrap">
            <label className="form-control flex-1 min-w-[11rem]">
              <span className="label-text text-xs">Тип</span>
              <select
                className="select select-bordered select-sm min-w-[11rem]"
                value={newKind}
                onChange={(e) => setNewKind(e.target.value)}
              >
                {Object.entries(KIND_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-control w-24">
              <span className="label-text text-xs">Хв</span>
              <input
                className="input input-bordered input-sm"
                type="number"
                min={5}
                step={5}
                value={newDurationMin}
                onChange={(e) => setNewDurationMin(e.target.value)}
              />
            </label>
            <label className="form-control w-28">
              <span className="label-text text-xs">Ціна, ₴</span>
              <input
                className="input input-bordered input-sm"
                type="number"
                min={0}
                step={1}
                value={newSalePrice}
                onChange={(e) => setNewSalePrice(e.target.value)}
              />
            </label>
          </div>
          <button
            className="btn btn-sm btn-primary"
            disabled={creating || !newTitle.trim()}
            onClick={() => void createService()}
          >
            {creating ? "Збереження…" : "Зберегти"}
          </button>
        </div>
      )}

      <div className="overflow-x-auto bg-white border rounded-xl">
        <table className="table table-xs w-full min-w-[56rem]">
          <thead>
            <tr>
              <th className="min-w-[18rem]">Послуга Kresco</th>
              <th className="min-w-[11rem]">Тип</th>
              <th>Хв</th>
              <th>Ціна, ₴</th>
              <th>Джерело</th>
              <th>Altegio</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {active.map((s) => (
              <tr key={s.id}>
                <td className="min-w-[18rem]">
                  <input
                    className="input input-bordered input-xs w-full min-w-[16rem] font-medium"
                    type="text"
                    title="Назва послуги Kresco"
                    value={titleDrafts[s.id] ?? s.title}
                    onChange={(e) => setTitleDrafts((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      if (raw === s.title) {
                        setTitleDrafts((prev) => {
                          const n = { ...prev };
                          delete n[s.id];
                          return n;
                        });
                        return;
                      }
                      void setTitle(s.id, raw);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                </td>
                <td className="min-w-[11rem] whitespace-nowrap">
                  <select
                    className="select select-bordered select-xs min-w-[11rem] w-full"
                    value={s.kind}
                    onChange={(e) => void setKind(s.id, e.target.value)}
                  >
                    {Object.entries(KIND_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="input input-bordered input-xs w-16 tabular-nums"
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
                        setDurationDrafts((prev) => {
                          const n = { ...prev };
                          delete n[s.id];
                          return n;
                        });
                        return;
                      }
                      void setDurationMin(s.id, raw);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                </td>
                <td>
                  <input
                    className="input input-bordered input-xs w-24 tabular-nums"
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
                        setPriceDrafts((prev) => {
                          const n = { ...prev };
                          delete n[s.id];
                          return n;
                        });
                        return;
                      }
                      void setSalePrice(s.id, raw);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                </td>
                <td className="text-xs text-gray-500">
                  {s.source === "kresco" ? "лише Kresco" : "мапінг"}
                </td>
                <td className="text-xs text-gray-600 max-w-xs">
                  {(s.altegioLinks || []).length === 0 ? (
                    <span className="text-gray-400">—</span>
                  ) : (
                    <details>
                      <summary className="cursor-pointer">
                        {(s.altegioLinks || []).length} id
                        {(s.altegioLinks || []).some((l) => l.isDefault)
                          ? ` · default ${(s.altegioLinks || []).find((l) => l.isDefault)?.altegioServiceId}`
                          : ""}
                      </summary>
                      <ul className="mt-1 space-y-0.5 pl-2 border-l">
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
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs text-gray-500"
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
        {!loading && active.length === 0 && (
          <p className="p-4 text-sm text-gray-500">Порожньо. Натисніть «Оновити мапінг з Altegio» або створіть послугу.</p>
        )}
      </div>

      {unmapped.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
          <p className="text-sm font-medium text-amber-900">Altegio без мапінгу ({unmapped.length})</p>
          <p className="text-xs text-amber-800 mb-2">Не потрапляють у каталог Kresco. За потреби додамо звʼязок пізніше.</p>
          <ul className="text-xs space-y-0.5 max-h-48 overflow-y-auto">
            {unmapped.map((u) => (
              <li key={u.id} className="tabular-nums">
                {u.id} — {u.title} ({Math.round(u.durationSec / 60)} хв)
              </li>
            ))}
          </ul>
        </div>
      )}

      {inactive.length > 0 && (
        <details className="text-xs text-gray-500">
          <summary>Неактивні / старі імпорти ({inactive.length})</summary>
          <ul className="mt-1 pl-3 space-y-1">
            {inactive.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {s.title} · {KIND_LABEL[s.kind] || s.kind}
                  {Number(s.salePrice) > 0 ? ` · ${formatPrice(s.salePrice)} ₴` : ""}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs text-primary"
                  onClick={() => void setActive(s.id, true)}
                >
                  Активувати
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}

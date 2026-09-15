"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type WarehouseStorage = { id: string; title: string; includeInFinanceReport: boolean };
type WarehouseProduct = {
  id: string;
  title: string;
  category: string | null;
  unit: string;
  isHair: boolean;
  lengthCm: number | null;
  costPerUnit: number;
  salePrice: number;
};
type StockRow = {
  id: string;
  quantity: number;
  costPerUnit: number;
  valueUah: number;
  product: WarehouseProduct;
  storage: { id: string; title: string; includeInFinanceReport: boolean };
};
type DocumentRow = {
  id: string;
  type: string;
  source: string;
  kyivDay: string;
  occurredAt: string;
  comment: string | null;
  createdBy: string | null;
  fromStorageTitle: string | null;
  toStorageTitle: string | null;
  linesCount: number;
  totalQty: number;
  totalUah: number;
};

type Dashboard = {
  ok: boolean;
  error?: string;
  balance: {
    totalUah: number;
    hairUah: number;
    productCount: number;
    stockRowCount: number;
    hairProductCount: number;
  } | null;
  suggestedHairPurchaseUah: number;
  previousMonthBalanceUah: number;
  storages: WarehouseStorage[];
  products: WarehouseProduct[];
  stocks: StockRow[];
  outOfStockHair: Array<{
    id: string;
    title: string;
    category: string | null;
    lengthCm: number | null;
    costPerUnit: number;
  }>;
  documents: DocumentRow[];
};

type Tab = "stocks" | "catalog" | "intake" | "docs";

function formatMoney(value: number): string {
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(Math.round(value || 0));
}

function formatQty(value: number): string {
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(value || 0);
}

function documentTypeLabel(type: string): string {
  switch (type) {
    case "intake":
      return "Прийомка";
    case "write_off":
      return "Списання";
    case "sale":
      return "Продаж";
    case "transfer":
      return "Переміщення";
    case "inventory_count":
      return "Інвентаризація";
    case "altegio_sync":
      return "Знімок Altegio";
    default:
      return type;
  }
}

export default function WarehousePage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("stocks");
  const [hairOnly, setHairOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [savingIntake, setSavingIntake] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [intakeStorageId, setIntakeStorageId] = useState("");
  const [intakeComment, setIntakeComment] = useState("");
  const [intakeProductId, setIntakeProductId] = useState("");
  const [intakeQty, setIntakeQty] = useState("1");
  const [intakeCost, setIntakeCost] = useState("");
  const [intakeLines, setIntakeLines] = useState<
    Array<{ productId: string; title: string; quantity: number; costPerUnit: number }>
  >([]);

  const load = useCallback(async (opts?: { hair?: boolean; q?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (opts?.hair) params.set("hair", "1");
      if (opts?.q) params.set("q", opts.q);
      const res = await fetch(`/api/admin/warehouse?${params.toString()}`, { credentials: "include" });
      const json = (await res.json()) as Dashboard;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
      setIntakeStorageId((current) => current || json.storages[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка завантаження");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load({ hair: hairOnly, q: query });
  }, [hairOnly, load]);

  const handleSearch = () => {
    void load({ hair: hairOnly, q: query });
  };

  const handleImport = async () => {
    if (!confirm("Імпортувати каталог і залишки з Altegio? Прийомки, зроблені в Kresco, будуть додані зверху знімка.")) {
      return;
    }
    setImporting(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/warehouse/import", { method: "POST", credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Помилка імпорту");
      }
      setNotice(
        `Імпорт завершено: складів ${json.result.storages}, товарів ${json.result.products}, волосся ${json.result.hairProducts}, рядків залишків ${json.result.stockRows}.`,
      );
      await load({ hair: hairOnly, q: query });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка імпорту");
    } finally {
      setImporting(false);
    }
  };

  const selectedProduct = useMemo(
    () => data?.products.find((p) => p.id === intakeProductId) || null,
    [data?.products, intakeProductId],
  );

  const addIntakeLine = () => {
    if (!selectedProduct) return;
    const quantity = Number(intakeQty.replace(",", "."));
    if (!(quantity > 0)) return;
    const costPerUnit = Number((intakeCost || String(selectedProduct.costPerUnit || 0)).replace(",", ".")) || 0;
    setIntakeLines((rows) => [
      ...rows,
      { productId: selectedProduct.id, title: selectedProduct.title, quantity, costPerUnit },
    ]);
    setIntakeQty("1");
    setIntakeCost("");
  };

  const submitIntake = async () => {
    if (!intakeStorageId || intakeLines.length === 0) return;
    setSavingIntake(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/warehouse/intakes", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storageId: intakeStorageId,
          comment: intakeComment,
          lines: intakeLines,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Помилка прийомки");
      }
      setIntakeLines([]);
      setIntakeComment("");
      setNotice("Прийомку проведено, залишки оновлено.");
      setTab("stocks");
      await load({ hair: hairOnly, q: query });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка прийомки");
    } finally {
      setSavingIntake(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f6f7fb] text-gray-900">
      <header className="sticky top-0 z-20 bg-white border-b px-3 py-2 flex flex-wrap items-center gap-2">
        <h1 className="text-base font-bold mr-2">Склад</h1>
        <Link href="/admin/direct" className="btn btn-ghost min-h-0 h-8 py-0 text-xs">
          Direct
        </Link>
        <Link href="/admin/finance-report" className="btn btn-ghost min-h-0 h-8 py-0 text-xs">
          Фінансовий звіт
        </Link>
        <div className="flex-1" />
        <button
          type="button"
          className="btn btn-sm btn-primary min-h-0 h-8"
          onClick={() => void handleImport()}
          disabled={importing}
        >
          {importing ? "Імпорт…" : "Імпорт з Altegio"}
        </button>
      </header>

      <section className="max-w-6xl mx-auto p-3 space-y-3">
        <p className="text-xs text-gray-500">
          Прийомки й закупівлі волосся ведемо тут. Продаж/списання на візит поки підтягуються з Altegio, щоб залишки не розʼїхались.
          Не дублюйте прийомку, якщо вона вже є в Altegio.
        </p>

        {notice && <div className="alert alert-success text-sm py-2">{notice}</div>}
        {error && <div className="alert alert-error text-sm py-2">{error}</div>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatCard label="Баланс складу" value={`${formatMoney(data?.balance?.totalUah || 0)} грн`} />
          <StatCard label="Волосся на складі" value={`${formatMoney(data?.balance?.hairUah || 0)} грн`} />
          <StatCard label="Потрібно закупити" value={`${formatMoney(data?.suggestedHairPurchaseUah || 0)} грн`} />
          <StatCard
            label="Каталог"
            value={`${data?.balance?.productCount || 0} тов. / ${data?.balance?.hairProductCount || 0} волосся`}
          />
        </div>

        <div className="flex flex-wrap gap-1">
          {(
            [
              ["stocks", "Залишки"],
              ["catalog", "Каталог"],
              ["intake", "Прийомка"],
              ["docs", "Документи"],
            ] as Array<[Tab, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`btn btn-sm min-h-0 h-8 ${tab === id ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
          <label className="flex items-center gap-1 text-xs ml-2">
            <input type="checkbox" checked={hairOnly} onChange={(e) => setHairOnly(e.target.checked)} />
            лише волосся
          </label>
          <input
            className="input input-bordered input-sm min-h-0 h-8 w-48"
            placeholder="Пошук"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch();
            }}
          />
          <button type="button" className="btn btn-sm btn-ghost min-h-0 h-8" onClick={handleSearch}>
            Знайти
          </button>
        </div>

        {loading && <p className="text-sm text-gray-500">Завантаження…</p>}

        {!loading && tab === "stocks" && (
          <div className="overflow-x-auto bg-white rounded-xl border">
            <table className="table table-xs">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th>Категорія</th>
                  <th>Склад</th>
                  <th className="text-right">К-сть</th>
                  <th className="text-right">Собівартість</th>
                  <th className="text-right">Сума</th>
                </tr>
              </thead>
              <tbody>
                {(data?.stocks || []).map((row) => (
                  <tr key={row.id} className={row.product.isHair ? "bg-rose-50" : ""}>
                    <td>
                      {row.product.title}
                      {row.product.lengthCm ? ` · ${row.product.lengthCm} см` : ""}
                    </td>
                    <td>{row.product.category || "—"}</td>
                    <td>{row.storage.title}</td>
                    <td className="text-right tabular-nums">
                      {formatQty(row.quantity)} {row.product.unit}
                    </td>
                    <td className="text-right tabular-nums">{formatMoney(row.costPerUnit || row.product.costPerUnit)} грн</td>
                    <td className="text-right tabular-nums font-medium">{formatMoney(row.valueUah)} грн</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data?.stocks?.length && <p className="p-4 text-sm text-gray-500">Немає залишків. Зробіть імпорт з Altegio.</p>}
          </div>
        )}

        {!loading && tab === "catalog" && (
          <div className="grid md:grid-cols-2 gap-3">
            <div className="overflow-x-auto bg-white rounded-xl border">
              <table className="table table-xs">
                <thead>
                  <tr>
                    <th>Товар</th>
                    <th>Категорія</th>
                    <th className="text-right">Собівартість</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.products || []).map((p) => (
                    <tr key={p.id} className={p.isHair ? "bg-rose-50" : ""}>
                      <td>
                        {p.title}
                        {p.lengthCm ? ` · ${p.lengthCm} см` : ""}
                      </td>
                      <td>{p.category || "—"}</td>
                      <td className="text-right tabular-nums">{formatMoney(p.costPerUnit)} грн</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bg-white rounded-xl border p-3">
              <h2 className="font-semibold text-sm mb-2">Закінчилось волосся</h2>
              {(data?.outOfStockHair || []).length === 0 ? (
                <p className="text-sm text-gray-500">Немає нульових позицій волосся.</p>
              ) : (
                <ul className="text-sm space-y-1">
                  {(data?.outOfStockHair || []).map((p) => (
                    <li key={p.id}>
                      {p.title}
                      {p.lengthCm ? ` · ${p.lengthCm} см` : ""} — {formatMoney(p.costPerUnit)} грн
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {!loading && tab === "intake" && (
          <div className="bg-white rounded-xl border p-3 space-y-3 max-w-2xl">
            <h2 className="font-semibold">Нова прийомка</h2>
            <label className="form-control">
              <span className="label-text text-xs">Склад</span>
              <select
                className="select select-bordered select-sm"
                value={intakeStorageId}
                onChange={(e) => setIntakeStorageId(e.target.value)}
              >
                {(data?.storages || []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-control">
              <span className="label-text text-xs">Коментар</span>
              <input
                className="input input-bordered input-sm"
                value={intakeComment}
                onChange={(e) => setIntakeComment(e.target.value)}
                placeholder="Постачальник / накладна"
              />
            </label>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
              <label className="form-control md:col-span-2">
                <span className="label-text text-xs">Товар</span>
                <select
                  className="select select-bordered select-sm"
                  value={intakeProductId}
                  onChange={(e) => {
                    setIntakeProductId(e.target.value);
                    const product = data?.products.find((p) => p.id === e.target.value);
                    setIntakeCost(product ? String(product.costPerUnit || "") : "");
                  }}
                >
                  <option value="">Оберіть товар</option>
                  {(data?.products || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.isHair ? "● " : ""}
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-control">
                <span className="label-text text-xs">К-сть</span>
                <input className="input input-bordered input-sm" value={intakeQty} onChange={(e) => setIntakeQty(e.target.value)} />
              </label>
              <label className="form-control">
                <span className="label-text text-xs">Собівартість</span>
                <input className="input input-bordered input-sm" value={intakeCost} onChange={(e) => setIntakeCost(e.target.value)} />
              </label>
            </div>
            <button type="button" className="btn btn-sm" onClick={addIntakeLine} disabled={!intakeProductId}>
              Додати рядок
            </button>
            <ul className="text-sm space-y-1">
              {intakeLines.map((line, idx) => (
                <li key={`${line.productId}-${idx}`} className="flex justify-between gap-2">
                  <span>
                    {line.title} × {formatQty(line.quantity)}
                  </span>
                  <span className="tabular-nums">{formatMoney(line.quantity * line.costPerUnit)} грн</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void submitIntake()}
              disabled={savingIntake || intakeLines.length === 0}
            >
              {savingIntake ? "Збереження…" : "Провести прийомку"}
            </button>
          </div>
        )}

        {!loading && tab === "docs" && (
          <div className="overflow-x-auto bg-white rounded-xl border">
            <table className="table table-xs">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Тип</th>
                  <th>Склад</th>
                  <th>Коментар</th>
                  <th className="text-right">Сума</th>
                </tr>
              </thead>
              <tbody>
                {(data?.documents || []).map((doc) => (
                  <tr key={doc.id}>
                    <td className="whitespace-nowrap">{doc.kyivDay}</td>
                    <td>
                      {documentTypeLabel(doc.type)}
                      {doc.source === "altegio_import" ? " · Altegio" : ""}
                    </td>
                    <td>{doc.toStorageTitle || doc.fromStorageTitle || "—"}</td>
                    <td className="max-w-xs truncate">{doc.comment || "—"}</td>
                    <td className="text-right tabular-nums">{formatMoney(doc.totalUah)} грн</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
      <p className="text-sm font-bold mt-1">{value}</p>
    </div>
  );
}

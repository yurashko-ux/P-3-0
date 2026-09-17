"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { WarehouseCreateButton } from "../_components/WarehouseCreateButton";

type Mode = "list" | "hair" | "goods" | "write_off" | "inventory";
type Storage = { id: string; title: string };
type Group = { id: string; title: string; isHair: boolean };
type DocRow = {
  id: string;
  type: string;
  kind: string | null;
  status: string;
  syncStatus: string;
  syncError: string | null;
  title: string;
  kyivDay: string;
  currencyCode: string | null;
  invoiceAmount: number;
  weightMismatch: boolean;
  storageTitle: string;
};
type ProductHit = {
  id: string;
  sku: number | null;
  title: string;
  costPerUnit: number;
  groupId: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  intake: "Прийомка",
  write_off: "Списання",
  inventory_count: "Інвентаризація",
};

export default function WarehouseDocumentsPage() {
  const [mode, setMode] = useState<Mode>("list");
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [storages, setStorages] = useState<Storage[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [currencies, setCurrencies] = useState<string[]>(["UAH", "USD"]);
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadMeta = useCallback(async () => {
    const [wh, cur, fx, list] = await Promise.all([
      fetch("/api/admin/warehouse", { credentials: "include" }).then((r) => r.json()),
      fetch("/api/admin/warehouse/currencies", { credentials: "include" }).then((r) => r.json()),
      fetch("/api/admin/warehouse/fx", { credentials: "include" }).then((r) => r.json()),
      fetch("/api/admin/warehouse/documents", { credentials: "include" }).then((r) => r.json()),
    ]);
    if (wh.ok) {
      setStorages(wh.storages || []);
      setGroups(wh.groups || []);
    }
    if (cur.ok) {
      setCurrencies((cur.enabled || []).filter((r: { enabled: boolean }) => r.enabled).map((r: { code: string }) => r.code));
    }
    if (fx.ok) setFxRate(fx.rate);
    if (list.ok) setDocs(list.documents || []);
  }, []);

  useEffect(() => {
    void loadMeta().catch((err) => setError(err instanceof Error ? err.message : "Помилка"));
  }, [loadMeta]);

  return (
    <main className="max-w-6xl mx-auto p-3 space-y-3">
      <p className="text-xs text-gray-600 bg-white border rounded-xl px-3 py-2">
        Документ проводиться в Kresco і одразу пишеться в склад Altegio. Каса й журнал запису лишаються там. Без курсу долара (фінзвіт, блок 4) прийомку волосся провести не можна.
      </p>
      {notice && <div className="alert alert-success text-sm py-2">{notice}</div>}
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-sm btn-primary" onClick={() => setMode("hair")}>Прийомка волосся</button>
        <button className="btn btn-sm" onClick={() => setMode("goods")}>Прийомка товару</button>
        <button className="btn btn-sm" onClick={() => setMode("write_off")}>Списання</button>
        <button className="btn btn-sm" onClick={() => setMode("inventory")}>Інвентаризація</button>
        {mode !== "list" && (
          <button className="btn btn-sm btn-ghost" onClick={() => setMode("list")}>До списку</button>
        )}
      </div>

      {mode === "list" && (
        <div className="overflow-x-auto bg-white rounded-xl border">
          <table className="table table-xs">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Тип</th>
                <th>Назва</th>
                <th className="text-right">Сума накладної</th>
                <th>Склад</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((row) => (
                <tr key={row.id} className={row.kind === "hair" && row.weightMismatch ? "bg-red-50" : ""}>
                  <td className="whitespace-nowrap">{row.kyivDay}</td>
                  <td>{TYPE_LABEL[row.type] || row.type}</td>
                  <td>
                    <Link href={`/admin/warehouse/documents/${row.id}`} className="underline">
                      {row.title}
                    </Link>
                  </td>
                  <td className="text-right tabular-nums">
                    {row.invoiceAmount
                      ? `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(row.invoiceAmount)} ${row.currencyCode || ""}`
                      : "—"}
                  </td>
                  <td>{row.storageTitle}</td>
                  <td>
                    {row.syncStatus === "error" || row.status === "sync_error" ? "помилка Altegio" : row.syncStatus === "synced" ? "проведено" : row.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!docs.length && <p className="p-4 text-sm text-gray-500">Поки немає документів Kresco.</p>}
        </div>
      )}

      {mode === "hair" && (
        <HairForm
          storages={storages}
          groups={groups}
          fxRate={fxRate}
          saving={saving}
          onAddStorage={(row) => setStorages((prev) => (prev.some((s) => s.id === row.id) ? prev : [...prev, row]))}
          onAddGroup={(row) => setGroups((prev) => (prev.some((g) => g.id === row.id) ? prev : [...prev, { id: row.id, title: row.title, isHair: Boolean(row.isHair) }]))}
          onCancel={() => setMode("list")}
          onSubmit={async (payload) => {
            setSaving(true);
            setError(null);
            try {
              const res = await fetch("/api/admin/warehouse/documents/hair", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
              const json = await res.json();
              if (!res.ok || !json.ok) throw new Error(json.error || "Помилка");
              setNotice("Прийомку волосся проведено в Kresco і відправлено в Altegio.");
              setMode("list");
              await loadMeta();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Помилка");
            } finally {
              setSaving(false);
            }
          }}
        />
      )}

      {mode === "goods" && (
        <GoodsForm
          storages={storages}
          groups={groups}
          currencies={currencies}
          saving={saving}
          onAddStorage={(row) => setStorages((prev) => (prev.some((s) => s.id === row.id) ? prev : [...prev, row]))}
          onAddGroup={(row) => setGroups((prev) => (prev.some((g) => g.id === row.id) ? prev : [...prev, { id: row.id, title: row.title, isHair: Boolean(row.isHair) }]))}
          onCancel={() => setMode("list")}
          onSubmit={async (payload) => {
            setSaving(true);
            setError(null);
            try {
              const res = await fetch("/api/admin/warehouse/documents/goods", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
              const json = await res.json();
              if (!res.ok || !json.ok) throw new Error(json.error || "Помилка");
              setNotice("Прийомку товару проведено і відправлено в Altegio.");
              setMode("list");
              await loadMeta();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Помилка");
            } finally {
              setSaving(false);
            }
          }}
        />
      )}

      {mode === "write_off" && (
        <WriteOffForm
          storages={storages}
          saving={saving}
          onAddStorage={(row) => setStorages((prev) => (prev.some((s) => s.id === row.id) ? prev : [...prev, row]))}
          onCancel={() => setMode("list")}
          onSubmit={async (payload) => {
            setSaving(true);
            setError(null);
            try {
              const res = await fetch("/api/admin/warehouse/documents/write-off", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
              const json = await res.json();
              if (!res.ok || !json.ok) throw new Error(json.error || "Помилка");
              setNotice("Списання проведено і відправлено в Altegio.");
              setMode("list");
              await loadMeta();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Помилка");
            } finally {
              setSaving(false);
            }
          }}
        />
      )}

      {mode === "inventory" && (
        <InventoryForm
          storages={storages}
          groups={groups}
          saving={saving}
          onAddStorage={(row) => setStorages((prev) => (prev.some((s) => s.id === row.id) ? prev : [...prev, row]))}
          onAddGroup={(row) => setGroups((prev) => (prev.some((g) => g.id === row.id) ? prev : [...prev, { id: row.id, title: row.title, isHair: Boolean(row.isHair) }]))}
          onCancel={() => setMode("list")}
          onSubmit={async (payload) => {
            setSaving(true);
            setError(null);
            try {
              const res = await fetch("/api/admin/warehouse/documents/inventory", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
              const json = await res.json();
              if (!res.ok || !json.ok) throw new Error(json.error || "Помилка");
              setNotice("Інвентаризацію збережено. Автоприйомка/автосписання створені за різницями.");
              setMode("list");
              await loadMeta();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Помилка");
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
    </main>
  );
}

function HairForm({
  storages,
  groups,
  fxRate,
  saving,
  onSubmit,
  onCancel,
  onAddStorage,
  onAddGroup,
}: {
  storages: Storage[];
  groups: Group[];
  fxRate: number | null;
  saving: boolean;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  onAddStorage: (row: { id: string; title: string }) => void;
  onAddGroup: (row: { id: string; title: string; isHair?: boolean }) => void;
}) {
  const hairGroups = groups.filter((g) => g.isHair);
  const [storageId, setStorageId] = useState(storages[0]?.id || "");
  const [groupId, setGroupId] = useState(hairGroups[0]?.id || "");
  const [title, setTitle] = useState("");
  const [kg, setKg] = useState("10");
  const [invoice, setInvoice] = useState("26000");
  const [delivery, setDelivery] = useState("0");
  const [lines, setLines] = useState<Array<{ lengthCm: string; weightGrams: string }>>([{ lengthCm: "60", weightGrams: "" }]);

  useEffect(() => {
    if (!storageId && storages[0]) setStorageId(storages[0].id);
  }, [storages, storageId]);
  useEffect(() => {
    if (!groupId && hairGroups[0]) setGroupId(hairGroups[0].id);
  }, [hairGroups, groupId]);

  const invoiceG = (Number(kg) || 0) * 1000;
  const sumG = lines.reduce((acc, line) => acc + (Number(line.weightGrams) || 0), 0);
  const delta = Math.round((sumG - invoiceG) * 100) / 100;
  const mismatch = Math.abs(delta) > 50;
  const perG = invoiceG > 0 ? (Number(invoice) + Number(delivery || 0)) / invoiceG : 0;

  return (
    <form
      className="bg-white border rounded-xl p-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({
          storageId,
          groupId,
          title,
          weightKg: Number(kg),
          invoiceAmountUsd: Number(invoice),
          deliveryAmountUsd: Number(delivery) || 0,
          lines: lines
            .map((line) => ({ lengthCm: Number(line.lengthCm), weightGrams: Number(line.weightGrams) }))
            .filter((line) => line.weightGrams > 0),
        });
      }}
    >
      <p className="font-semibold">Прийомка волосся</p>
      <p className="text-xs text-gray-500">
        Курс USD/UAH: {fxRate ? fxRate : "відсутній — проведення буде зупинено"}. Собівартість 1 г = (накладна + доставка) / (кг×1000). У списку — сума без доставки.
      </p>
      <div className="grid md:grid-cols-3 gap-2">
        <div className="flex gap-1">
          <select className="select select-bordered select-sm flex-1" value={storageId} onChange={(e) => setStorageId(e.target.value)} required>
            {storages.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
          <WarehouseCreateButton kind="storage" onCreated={(row) => { onAddStorage(row); setStorageId(row.id); }} />
        </div>
        <div className="flex gap-1">
          <select className="select select-bordered select-sm flex-1" value={groupId} onChange={(e) => setGroupId(e.target.value)} required>
            {(hairGroups.length ? hairGroups : groups).map((g) => (
              <option key={g.id} value={g.id}>{g.title}</option>
            ))}
          </select>
          <WarehouseCreateButton kind="group" onCreated={(row) => { onAddGroup(row); setGroupId(row.id); }} />
        </div>
        <input className="input input-bordered input-sm" placeholder="Назва (два слова)" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <input className="input input-bordered input-sm" placeholder="Вага, кг" value={kg} onChange={(e) => setKg(e.target.value)} required />
        <input className="input input-bordered input-sm" placeholder="Сума накладної, $" value={invoice} onChange={(e) => setInvoice(e.target.value)} required />
        <input className="input input-bordered input-sm" placeholder="Доставка, $ (опційно)" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
      </div>
      <p className={`text-sm ${mismatch ? "text-red-600 font-semibold" : "text-gray-600"}`}>
        У накладній {invoiceG} г, по хвостах {sumG} г, дельта {delta} г (допуск ±50). 1 г ≈ {perG ? perG.toFixed(4) : "—"} $
      </p>
      <div className="space-y-2">
        {lines.map((line, idx) => (
          <div key={idx} className="flex gap-2">
            <input className="input input-bordered input-sm w-28" placeholder="см" value={line.lengthCm} onChange={(e) => {
              const next = [...lines];
              next[idx] = { ...next[idx], lengthCm: e.target.value };
              setLines(next);
            }} />
            <input className="input input-bordered input-sm w-28" placeholder="грами" value={line.weightGrams} onChange={(e) => {
              const next = [...lines];
              next[idx] = { ...next[idx], weightGrams: e.target.value };
              setLines(next);
            }} />
            <span className="text-xs text-gray-500 self-center">
              {Number(line.weightGrams) > 0 && perG > 0 ? `${(perG * Number(line.weightGrams)).toFixed(2)} $` : ""}
            </span>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-xs" onClick={() => setLines([...lines, { lengthCm: "60", weightGrams: "" }])}>
        + хвіст
      </button>
      <div className="flex gap-2">
        <button className="btn btn-sm btn-primary" disabled={saving}>{saving ? "Проведення…" : "Провести"}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>Скасувати</button>
      </div>
    </form>
  );
}

function ProductSearch({ onPick }: { onPick: (p: ProductHit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  useEffect(() => {
    if (q.trim().length < 1) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      void fetch(`/api/admin/warehouse/catalog?search=${encodeURIComponent(q)}`, { credentials: "include" })
        .then((r) => r.json())
        .then((json) => setHits(json.products || []));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div>
      <input className="input input-bordered input-sm w-full" placeholder="Код або назва…" value={q} onChange={(e) => setQ(e.target.value)} />
      {hits.length > 0 && (
        <ul className="menu bg-base-100 border rounded-md mt-1 max-h-40 overflow-auto text-xs">
          {hits.slice(0, 12).map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => { onPick(p); setQ(""); setHits([]); }}>
                {p.sku} · {p.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GoodsForm({
  storages,
  groups,
  currencies,
  saving,
  onSubmit,
  onCancel,
  onAddStorage,
  onAddGroup,
}: {
  storages: Storage[];
  groups: Group[];
  currencies: string[];
  saving: boolean;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  onAddStorage: (row: { id: string; title: string }) => void;
  onAddGroup: (row: { id: string; title: string; isHair?: boolean }) => void;
}) {
  const [storageId, setStorageId] = useState(storages[0]?.id || "");
  const [title, setTitle] = useState("");
  const [currencyCode, setCurrencyCode] = useState(currencies.includes("UAH") ? "UAH" : currencies[0] || "UAH");
  const [invoice, setInvoice] = useState("");
  const [delivery, setDelivery] = useState("0");
  const [lines, setLines] = useState<Array<{ productId: string; title: string; groupId: string; quantity: string; price: string }>>([
    { productId: "", title: "", groupId: "", quantity: "1", price: "" },
  ]);

  return (
    <form
      className="bg-white border rounded-xl p-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({
          storageId,
          title,
          currencyCode,
          invoiceAmount: Number(invoice),
          deliveryAmount: Number(delivery) || 0,
          lines: lines.map((line) => ({
            productId: line.productId || undefined,
            title: line.title || undefined,
            groupId: line.groupId || undefined,
            quantity: Number(line.quantity),
            price: Number(line.price),
          })),
        });
      }}
    >
      <p className="font-semibold">Прийомка товару</p>
      <div className="grid md:grid-cols-3 gap-2">
        <div className="flex gap-1">
          <select className="select select-bordered select-sm flex-1" value={storageId} onChange={(e) => setStorageId(e.target.value)}>
            {storages.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
          <WarehouseCreateButton kind="storage" onCreated={(row) => { onAddStorage(row); setStorageId(row.id); }} />
        </div>
        <input className="input input-bordered input-sm" placeholder="Назва (два слова)" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <select className="select select-bordered select-sm" value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)}>
          {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className="input input-bordered input-sm" placeholder="Сума накладної" value={invoice} onChange={(e) => setInvoice(e.target.value)} required />
        <input className="input input-bordered input-sm" placeholder="Доставка (опційно)" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
      </div>
      {lines.map((line, idx) => (
        <div key={idx} className="grid md:grid-cols-5 gap-2 border-t pt-2">
          <ProductSearch onPick={(p) => {
            const next = [...lines];
            next[idx] = { ...next[idx], productId: p.id, title: p.title, price: String(p.costPerUnit || "") };
            setLines(next);
          }} />
          <input className="input input-bordered input-sm" placeholder="Нова назва" value={line.title} onChange={(e) => {
            const next = [...lines];
            next[idx] = { ...next[idx], title: e.target.value, productId: "" };
            setLines(next);
          }} />
          <div className="flex gap-1">
            <select className="select select-bordered select-sm flex-1" value={line.groupId} onChange={(e) => {
              const next = [...lines];
              next[idx] = { ...next[idx], groupId: e.target.value };
              setLines(next);
            }}>
              <option value="">Група (для нової картки)</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
            {idx === 0 && (
              <WarehouseCreateButton
                kind="group"
                onCreated={(row) => {
                  onAddGroup(row);
                  const next = [...lines];
                  next[idx] = { ...next[idx], groupId: row.id };
                  setLines(next);
                }}
              />
            )}
          </div>
          <input className="input input-bordered input-sm" placeholder="К-сть" value={line.quantity} onChange={(e) => {
            const next = [...lines];
            next[idx] = { ...next[idx], quantity: e.target.value };
            setLines(next);
          }} />
          <input className="input input-bordered input-sm" placeholder="Ціна" value={line.price} onChange={(e) => {
            const next = [...lines];
            next[idx] = { ...next[idx], price: e.target.value };
            setLines(next);
          }} />
        </div>
      ))}
      <button type="button" className="btn btn-xs" onClick={() => setLines([...lines, { productId: "", title: "", groupId: "", quantity: "1", price: "" }])}>+ рядок</button>
      <div className="flex gap-2">
        <button className="btn btn-sm btn-primary" disabled={saving}>{saving ? "Проведення…" : "Провести"}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>Скасувати</button>
      </div>
    </form>
  );
}

function WriteOffForm({
  storages,
  saving,
  onSubmit,
  onCancel,
  onAddStorage,
}: {
  storages: Storage[];
  saving: boolean;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  onAddStorage: (row: { id: string; title: string }) => void;
}) {
  const [storageId, setStorageId] = useState(storages[0]?.id || "");
  const [title, setTitle] = useState("Списання товару");
  const [lines, setLines] = useState<Array<{ productId: string; title: string; quantity: string }>>([]);

  return (
    <form
      className="bg-white border rounded-xl p-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({
          storageId,
          title,
          lines: lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity) })),
        });
      }}
    >
      <p className="font-semibold">Списання</p>
      <div className="grid md:grid-cols-2 gap-2">
        <div className="flex gap-1">
          <select className="select select-bordered select-sm flex-1" value={storageId} onChange={(e) => setStorageId(e.target.value)}>
            {storages.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
          <WarehouseCreateButton kind="storage" onCreated={(row) => { onAddStorage(row); setStorageId(row.id); }} />
        </div>
        <input className="input input-bordered input-sm" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <ProductSearch onPick={(p) => setLines([...lines, { productId: p.id, title: `${p.sku} ${p.title}`, quantity: "1" }])} />
      {lines.map((line, idx) => (
        <div key={line.productId + idx} className="flex gap-2 items-center text-sm">
          <span className="flex-1">{line.title}</span>
          <input className="input input-bordered input-sm w-24" value={line.quantity} onChange={(e) => {
            const next = [...lines];
            next[idx] = { ...next[idx], quantity: e.target.value };
            setLines(next);
          }} />
        </div>
      ))}
      <div className="flex gap-2">
        <button className="btn btn-sm btn-primary" disabled={saving}>{saving ? "Проведення…" : "Списати"}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>Скасувати</button>
      </div>
    </form>
  );
}

function InventoryForm({
  storages,
  groups,
  saving,
  onSubmit,
  onCancel,
  onAddStorage,
  onAddGroup,
}: {
  storages: Storage[];
  groups: Group[];
  saving: boolean;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  onAddStorage: (row: { id: string; title: string }) => void;
  onAddGroup: (row: { id: string; title: string; isHair?: boolean }) => void;
}) {
  const [storageId, setStorageId] = useState(storages[0]?.id || "");
  const [title, setTitle] = useState("Повна інвентаризація");
  const [groupId, setGroupId] = useState(groups[0]?.id || "");
  const [lines, setLines] = useState<Array<{ productId: string; title: string; book: number; countedQty: string }>>([]);

  const addGroup = async () => {
    const params = new URLSearchParams({ includeZero: "1", groupId, storageId });
    const res = await fetch(`/api/admin/warehouse?${params}`, { credentials: "include" });
    const json = await res.json();
    const stocks = json.stocks || [];
    const catalog = await fetch(`/api/admin/warehouse/catalog?groupId=${groupId}`, { credentials: "include" }).then((r) => r.json());
    const byId = new Map<string, { title: string; book: number }>();
    for (const p of catalog.products || []) {
      byId.set(p.id, { title: `${p.sku ?? ""} ${p.title}`, book: 0 });
    }
    for (const row of stocks) {
      byId.set(row.product.id, {
        title: `${row.product.sku ?? ""} ${row.product.title}`,
        book: Number(row.quantity) || 0,
      });
    }
    setLines((prev) => {
      const seen = new Set(prev.map((l) => l.productId));
      const extra = [...byId.entries()]
        .filter(([id]) => !seen.has(id))
        .map(([id, row]) => ({ productId: id, title: row.title, book: row.book, countedQty: String(row.book) }));
      return [...prev, ...extra];
    });
  };

  return (
    <form
      className="bg-white border rounded-xl p-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({
          storageId,
          title,
          lines: lines.map((line) => ({ productId: line.productId, countedQty: Number(line.countedQty) })),
        });
      }}
    >
      <p className="font-semibold">Інвентаризація</p>
      <p className="text-xs text-gray-500">Додавайте групи по черзі (фарби, хвости…). По факту vs обліку система створить прийомку і/або списання — і запише їх у Altegio.</p>
      <div className="grid md:grid-cols-3 gap-2">
        <div className="flex gap-1">
          <select className="select select-bordered select-sm flex-1" value={storageId} onChange={(e) => setStorageId(e.target.value)}>
            {storages.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
          <WarehouseCreateButton kind="storage" onCreated={(row) => { onAddStorage(row); setStorageId(row.id); }} />
        </div>
        <input className="input input-bordered input-sm" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="flex gap-1">
          <select className="select select-bordered select-sm flex-1" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
          <WarehouseCreateButton kind="group" onCreated={(row) => { onAddGroup(row); setGroupId(row.id); }} />
          <button type="button" className="btn btn-sm" onClick={() => void addGroup()}>Внести в акт</button>
        </div>
      </div>
      <div className="overflow-x-auto max-h-96">
        <table className="table table-xs">
          <thead>
            <tr>
              <th>Товар</th>
              <th className="text-right">Облік</th>
              <th className="text-right">Факт</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <tr key={line.productId}>
                <td>{line.title}</td>
                <td className="text-right tabular-nums">{line.book}</td>
                <td>
                  <input className="input input-bordered input-xs w-24 text-right" value={line.countedQty} onChange={(e) => {
                    const next = [...lines];
                    next[idx] = { ...next[idx], countedQty: e.target.value };
                    setLines(next);
                  }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <button className="btn btn-sm btn-primary" disabled={saving || lines.length === 0}>{saving ? "Збереження…" : "Зберегти інвентаризацію"}</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>Скасувати</button>
      </div>
    </form>
  );
}

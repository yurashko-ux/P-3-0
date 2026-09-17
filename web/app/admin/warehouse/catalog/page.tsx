"use client";

import { useCallback, useEffect, useState } from "react";
import { WarehouseCreateButton } from "../_components/WarehouseCreateButton";

type Group = { id: string; title: string; isHair: boolean };
type Product = {
  id: string;
  sku: number | null;
  title: string;
  isHair: boolean;
  lengthCm: number | null;
  weightGrams: number | null;
  costUsd: number;
  costPerUnit: number;
  group: { id: string; title: string } | null;
};

export default function WarehouseCatalogPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [groupId, setGroupId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [newTitle, setNewTitle] = useState("");
  const [newGroupId, setNewGroupId] = useState("");
  const [newLength, setNewLength] = useState("");
  const [newWeight, setNewWeight] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (groupId) params.set("groupId", groupId);
      const res = await fetch(`/api/admin/warehouse/catalog?${params}`, { credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка каталогу");
      setGroups(json.groups || []);
      setProducts(json.products || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setLoading(false);
    }
  }, [q, groupId]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const post = async (body: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/warehouse/catalog", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка збереження");
      setNotice("Збережено. Картка створена в Altegio, номер = їхній id.");
      setNewTitle("");
      setNewLength("");
      setNewWeight("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="max-w-7xl mx-auto p-3 space-y-3">
      <p className="text-xs text-gray-600 bg-white border rounded-xl px-3 py-2">
        Номер товару = id картки Altegio. Групу створюйте кнопкою біля фільтра «Група». Нова картка одразу з’являється в Altegio.
      </p>
      {notice && <div className="alert alert-success text-sm py-2">{notice}</div>}
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}

      <form
        className="bg-white border rounded-xl p-3 space-y-2 max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          void post({
            title: newTitle,
            groupId: newGroupId,
            lengthCm: newLength ? Number(newLength) : null,
            weightGrams: newWeight ? Number(newWeight) : null,
            isHair: groups.find((g) => g.id === newGroupId)?.isHair || false,
          });
        }}
      >
        <p className="font-semibold text-sm">Нова картка</p>
        <select className="select select-bordered select-sm w-full" value={newGroupId} onChange={(e) => setNewGroupId(e.target.value)} required>
          <option value="">Група…</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
        <input className="input input-bordered input-sm w-full" placeholder="Назва" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} required />
        <div className="flex gap-2">
          <input className="input input-bordered input-sm w-full" placeholder="Довжина, см" value={newLength} onChange={(e) => setNewLength(e.target.value)} />
          <input className="input input-bordered input-sm w-full" placeholder="Вага, г" value={newWeight} onChange={(e) => setNewWeight(e.target.value)} />
        </div>
        <button className="btn btn-sm btn-primary" disabled={saving}>
          Створити в Altegio
        </button>
      </form>

      <div className="flex flex-wrap gap-2 items-end">
        <input className="input input-bordered input-sm w-56" placeholder="Пошук" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select select-bordered select-sm" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">Усі групи</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
        <WarehouseCreateButton
          kind="group"
          onCreated={(row) => {
            setNotice(`Групу «${row.title}» створено в каталозі і Altegio.`);
            setGroupId(row.id);
            setNewGroupId(row.id);
            void load();
          }}
        />
      </div>

      {loading && <p className="text-sm text-gray-500">Завантаження…</p>}
      <div className="overflow-x-auto bg-white rounded-xl border">
        <table className="table table-xs">
          <thead>
            <tr>
              <th>№</th>
              <th>Назва</th>
              <th>Група</th>
              <th>Довжина</th>
              <th>Вага</th>
              <th className="text-right">USD</th>
              <th className="text-right">грн</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className={p.isHair ? "bg-rose-50" : ""}>
                <td className="tabular-nums">{p.sku ?? "—"}</td>
                <td>{p.title}</td>
                <td>{p.group?.title || "—"}</td>
                <td>{p.lengthCm ? `${p.lengthCm} см` : "—"}</td>
                <td>{p.weightGrams ? `${p.weightGrams} г` : "—"}</td>
                <td className="text-right tabular-nums">{p.costUsd ? p.costUsd.toFixed(2) : "—"}</td>
                <td className="text-right tabular-nums">{Math.round(p.costPerUnit || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

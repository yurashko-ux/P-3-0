"use client";

import { useCallback, useEffect, useState } from "react";

type AppointmentHit = {
  id: string;
  kyivDay: string;
  clientName: string;
  staffName: string | null;
};

type PreviewLine = {
  title: string;
  amount: number;
  staffName: string | null;
  altegioStaffId: number | null;
};

type Preview = {
  appointmentId: string;
  kyivDay: string;
  clientName: string;
  suggestedAmount: number;
  leadAgencyLabel: string;
  consultationAt: string | null;
  consultationMasterName: string | null;
  lines: PreviewLine[];
};

type OperationRow = {
  id: string;
  kyivDay: string;
  amount: number;
  methodLabel: string;
  clientName: string | null;
  leadAgencyLabel: string;
  consultationAt: string | null;
  consultationMasterName: string | null;
  createdByName: string | null;
  lines: PreviewLine[];
};

function formatUah(n: number): string {
  return new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n || 0);
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export default function FinanceOperationsPage() {
  const [operations, setOperations] = useState<OperationRow[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AppointmentHit[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("card");
  const [kyivDay, setKyivDay] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/finance/operations", { credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка списку");
      setOperations(json.operations || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      void fetch(`/api/admin/finance/operations?q=${encodeURIComponent(query)}`, { credentials: "include" })
        .then((res) => res.json())
        .then((json) => {
          if (json?.ok) setHits(json.appointments || []);
        })
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [open, query]);

  async function pickAppointment(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/finance/operations?appointmentId=${encodeURIComponent(id)}`, {
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не вдалося прочитати запис");
      const next = json.preview as Preview;
      setPreview(next);
      setAmount(String(next.suggestedAmount || ""));
      setKyivDay(next.kyivDay);
      setHits([]);
      setQuery("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/finance/operations", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointmentId: preview.appointmentId,
          amount: Number(String(amount).replace(",", ".")),
          method,
          kyivDay,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не збережено");
      setOpen(false);
      setPreview(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка збереження");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="px-3 pb-6 pt-2 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-600 max-w-3xl">
          Один рядок — один вхідний платіж. Запис, майстри послуг, консультація і агенція ліда фіксуються в момент
          збереження і далі не змінюються разом із карткою клієнта.
        </p>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => {
            setOpen(true);
            setPreview(null);
            setQuery("");
          }}
        >
          Новий платіж
        </button>
      </div>
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}

      {open && (
        <div className="bg-white border rounded-xl p-3 space-y-3">
          <div className="font-semibold text-sm">Новий платіж</div>
          <label className="form-control">
            <span className="label-text text-xs text-gray-500">Знайти запис (імʼя, Instagram, дата)</span>
            <input
              className="input input-bordered input-sm"
              value={query}
              placeholder="Мар'яна або 2026-10-05"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {hits.length > 0 && (
            <ul className="border rounded-lg divide-y max-h-48 overflow-y-auto">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    className="w-full text-left px-2 py-1.5 text-xs hover:bg-gray-50"
                    disabled={busy}
                    onClick={() => void pickAppointment(hit.id)}
                  >
                    <span className="tabular-nums">{hit.kyivDay}</span> · {hit.clientName}
                    {hit.staffName ? ` · ${hit.staffName}` : ""}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {preview && (
            <div className="space-y-2 border rounded-lg p-2">
              <div className="text-sm font-medium">
                {preview.clientName} · {preview.kyivDay}
              </div>
              <p className="text-xs text-gray-600">
                Агенція: {preview.leadAgencyLabel}. Консультація: {formatWhen(preview.consultationAt)}, майстер{" "}
                {preview.consultationMasterName || "—"}.
              </p>
              {preview.lines.length === 0 ? (
                <p className="text-xs text-gray-400">На записі немає рядків послуг.</p>
              ) : (
                <ul className="space-y-1">
                  {preview.lines.map((line, index) => (
                    <li key={`${line.title}-${index}`} className="text-xs flex justify-between gap-2">
                      <span>
                        {line.title}
                        {line.staffName ? ` · ${line.staffName}` : ""}
                      </span>
                      <span className="tabular-nums">{formatUah(line.amount)} ₴</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2 items-end">
                <label className="text-xs space-y-0.5">
                  <span className="text-gray-500">Сума платежу</span>
                  <input
                    className="input input-bordered input-sm w-32"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <label className="text-xs space-y-0.5">
                  <span className="text-gray-500">Спосіб</span>
                  <select
                    className="select select-bordered select-sm"
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                  >
                    <option value="cash">Каса</option>
                    <option value="card">Картка</option>
                    <option value="deposit">Завдаток</option>
                  </select>
                </label>
                <label className="text-xs space-y-0.5">
                  <span className="text-gray-500">День</span>
                  <input
                    type="date"
                    className="input input-bordered input-sm"
                    value={kyivDay}
                    onChange={(e) => setKyivDay(e.target.value)}
                  />
                </label>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setOpen(false)}>
              Скасувати
            </button>
            <button className="btn btn-sm btn-primary" disabled={busy || !preview} onClick={() => void save()}>
              {busy ? "…" : "Зберегти"}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto bg-white border rounded-xl">
        <table className="table table-xs w-full">
          <thead>
            <tr>
              <th>День</th>
              <th>Клієнт</th>
              <th>Сума</th>
              <th>Спосіб</th>
              <th>Агенція</th>
              <th>Консультація</th>
              <th>Послуги і майстри</th>
              <th>Хто зберіг</th>
            </tr>
          </thead>
          <tbody>
            {operations.map((row) => (
              <tr key={row.id}>
                <td className="whitespace-nowrap tabular-nums">{row.kyivDay}</td>
                <td>{row.clientName || "—"}</td>
                <td className="tabular-nums whitespace-nowrap">{formatUah(row.amount)} ₴</td>
                <td>{row.methodLabel}</td>
                <td>{row.leadAgencyLabel}</td>
                <td className="text-xs">
                  {formatWhen(row.consultationAt)}
                  <div className="text-gray-500">{row.consultationMasterName || "—"}</div>
                </td>
                <td className="text-xs min-w-[14rem]">
                  {row.lines.length === 0
                    ? "—"
                    : row.lines.map((line, index) => (
                        <div key={`${row.id}-${index}`}>
                          {line.title}
                          {line.staffName ? ` · ${line.staffName}` : ""} · {formatUah(line.amount)} ₴
                        </div>
                      ))}
                </td>
                <td className="text-xs">{row.createdByName || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && operations.length === 0 && (
          <p className="p-4 text-sm text-gray-500">Поки немає операцій. Новий платіж зберігає ланцюжок з запису.</p>
        )}
        {loading && operations.length === 0 && <p className="p-4 text-sm text-gray-400">Завантаження…</p>}
      </div>
    </main>
  );
}

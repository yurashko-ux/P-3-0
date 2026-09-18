"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type AccountOpt = { id: number; title: string; type?: string | null };
type PurposeOpt = { id: string; title: string; externalId: number | null; source?: string | null };

type DocRow = {
  id: string;
  type: string;
  status: string;
  syncStatus: string;
  syncError: string | null;
  title: string | null;
  amountUah: number;
  kyivDay: string;
  occurredAt: string;
  accountId: number;
  accountTitle: string | null;
  counterAccountId: number | null;
  counterAccountTitle: string | null;
  purposeTitle: string | null;
  comment: string | null;
  altegioTransactionId: number | null;
  altegioCounterTransactionId: number | null;
  createdAt: string;
};

const TYPE_LABEL: Record<string, string> = {
  income: "Прихід",
  expense: "Розхід",
  transfer: "Переміщення",
};

const emptyForm = {
  type: "expense" as "income" | "expense" | "transfer",
  amountUah: "",
  accountId: "",
  counterAccountId: "",
  purposeId: "",
  occurredAt: "",
  comment: "",
};

function money(n: number) {
  return n.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function FinanceDocumentsPage() {
  const [documents, setDocuments] = useState<DocRow[]>([]);
  const [accounts, setAccounts] = useState<AccountOpt[]>([]);
  const [purposes, setPurposes] = useState<PurposeOpt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/finance/documents?options=1&limit=80", {
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Помилка завантаження");
      setDocuments(json.documents || []);
      setAccounts(json.accounts || []);
      setPurposes((json.purposes || []).filter((p: PurposeOpt) => p.externalId != null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const purposeOptions = useMemo(() => {
    return [...purposes].sort((a, b) => a.title.localeCompare(b.title, "uk"));
  }, [purposes]);

  function openCreate(type: "income" | "expense" | "transfer" = "expense") {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setForm({ ...emptyForm, type, occurredAt: local });
    setShowForm(true);
  }

  async function saveForm() {
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        type: form.type,
        amountUah: Number(String(form.amountUah).replace(",", ".")),
        accountId: Number(form.accountId),
        comment: form.comment || null,
        occurredAt: form.occurredAt ? new Date(form.occurredAt).toISOString() : null,
      };
      if (form.type === "transfer") {
        payload.counterAccountId = Number(form.counterAccountId);
      } else {
        payload.purposeId = form.purposeId || null;
      }
      const res = await fetch("/api/admin/finance/documents", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не створено");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка збереження");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-3 space-y-3 max-w-6xl">
      <p className="text-xs text-gray-600 bg-white border rounded-xl px-3 py-2">
        Прихід / розхід / переміщення з dual-write в Altegio. Зведення з банком поки на
        AltegioFinanceTransaction — без змін у цьому етапі.
      </p>
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => openCreate("expense")} disabled={busy}>
          + Розхід
        </button>
        <button type="button" className="btn btn-sm btn-success" onClick={() => openCreate("income")} disabled={busy}>
          + Прихід
        </button>
        <button type="button" className="btn btn-sm" onClick={() => openCreate("transfer")} disabled={busy}>
          + Переміщення
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void load()} disabled={loading || busy}>
          Оновити
        </button>
      </div>

      {showForm && (
        <div className="bg-white border rounded-xl p-3 space-y-2 max-w-xl">
          <div className="font-semibold text-sm">
            Новий документ: {TYPE_LABEL[form.type] || form.type}
          </div>
          <label className="form-control">
            <span className="label-text text-xs">Сума, грн</span>
            <input
              className="input input-bordered input-sm"
              value={form.amountUah}
              onChange={(e) => setForm((f) => ({ ...f, amountUah: e.target.value }))}
              inputMode="decimal"
            />
          </label>
          <label className="form-control">
            <span className="label-text text-xs">
              {form.type === "transfer" ? "З рахунку" : "Рахунок"}
            </span>
            <select
              className="select select-bordered select-sm"
              value={form.accountId}
              onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
            >
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </label>
          {form.type === "transfer" ? (
            <label className="form-control">
              <span className="label-text text-xs">На рахунок</span>
              <select
                className="select select-bordered select-sm"
                value={form.counterAccountId}
                onChange={(e) => setForm((f) => ({ ...f, counterAccountId: e.target.value }))}
              >
                <option value="">—</option>
                {accounts
                  .filter((a) => String(a.id) !== form.accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title}
                    </option>
                  ))}
              </select>
            </label>
          ) : (
            <label className="form-control">
              <span className="label-text text-xs">Стаття</span>
              <select
                className="select select-bordered select-sm"
                value={form.purposeId}
                onChange={(e) => setForm((f) => ({ ...f, purposeId: e.target.value }))}
              >
                <option value="">—</option>
                {purposeOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="form-control">
            <span className="label-text text-xs">Дата / час</span>
            <input
              type="datetime-local"
              className="input input-bordered input-sm"
              value={form.occurredAt}
              onChange={(e) => setForm((f) => ({ ...f, occurredAt: e.target.value }))}
            />
          </label>
          <label className="form-control">
            <span className="label-text text-xs">Коментар</span>
            <input
              className="input input-bordered input-sm"
              value={form.comment}
              onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
            />
          </label>
          <div className="flex gap-2 pt-1">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void saveForm()} disabled={busy}>
              {busy ? "Запис…" : "Створити в Kresco + Altegio"}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setShowForm(false)}
              disabled={busy}
            >
              Скасувати
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Завантаження…</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-gray-500">Документів ще немає.</p>
      ) : (
        <div className="overflow-x-auto bg-white border rounded-xl">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>День</th>
                <th>Тип</th>
                <th>Сума</th>
                <th>Рахунок</th>
                <th>Стаття</th>
                <th>Статус</th>
                <th>Altegio</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td className="whitespace-nowrap text-xs">{d.kyivDay}</td>
                  <td className="text-xs">{TYPE_LABEL[d.type] || d.type}</td>
                  <td className="text-xs font-medium whitespace-nowrap">{money(d.amountUah)}</td>
                  <td className="text-xs">
                    {d.accountTitle || d.accountId}
                    {d.type === "transfer" && d.counterAccountTitle
                      ? ` → ${d.counterAccountTitle}`
                      : ""}
                  </td>
                  <td className="text-xs">{d.purposeTitle || d.title || "—"}</td>
                  <td className="text-xs">
                    {d.syncStatus === "synced" ? (
                      <span className="text-success">synced</span>
                    ) : d.syncStatus === "error" ? (
                      <span className="text-error" title={d.syncError || ""}>
                        error
                      </span>
                    ) : (
                      d.syncStatus
                    )}
                  </td>
                  <td className="text-xs whitespace-nowrap">
                    {d.altegioTransactionId ?? "—"}
                    {d.altegioCounterTransactionId ? ` / ${d.altegioCounterTransactionId}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

type ArchiveAccount = { id: number; title: string; hidden: boolean };

/** Рахунки: в архіві рахунок зникає з Каси, з оплати в журналі і з вибору в документах. */
export function CashAccountsModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [accounts, setAccounts] = useState<ArchiveAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/finance/documents?options=1&limit=1", { credentials: "include" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не вдалося завантажити рахунки");
      setAccounts(json.accountArchive || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка завантаження");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setHidden(account: ArchiveAccount, hidden: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/finance/accounts/archive", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: account.id, title: account.title, hidden }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Не вдалося змінити архів");
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка архіву");
    } finally {
      setBusy(false);
    }
  }

  const active = accounts.filter((account) => !account.hidden);
  const archived = accounts.filter((account) => account.hidden);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div className="w-full max-w-sm space-y-2 rounded-xl bg-white p-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">Рахунки</div>
          <button type="button" className="btn btn-ghost btn-xs" onClick={onClose}>
            Закрити
          </button>
        </div>
        <p className="text-xs text-gray-500">
          В архіві рахунок зникає з Каси, з оплати в журналі і з вибору в документах. Уже записані оплати лишаються.
        </p>
        {error && <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">{error}</div>}
        {loading && accounts.length === 0 ? <p className="text-xs text-gray-500">Завантаження…</p> : null}
        {!loading && accounts.length === 0 ? <p className="text-xs text-gray-500">Рахунків немає.</p> : null}
        {active.map((account) => (
          <div key={account.id} className="flex items-center justify-between gap-2 text-sm">
            <span>{account.title}</span>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              disabled={busy}
              onClick={() => void setHidden(account, true)}
            >
              В архів
            </button>
          </div>
        ))}
        {archived.length > 0 && (
          <div className="space-y-1 border-t pt-2">
            <div className="text-xs text-gray-500">Архів</div>
            {archived.map((account) => (
              <div key={account.id} className="flex items-center justify-between gap-2 text-sm text-gray-500">
                <span>{account.title}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  disabled={busy}
                  onClick={() => void setHidden(account, false)}
                >
                  Повернути
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

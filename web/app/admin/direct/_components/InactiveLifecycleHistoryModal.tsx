"use client";

// Історія виходу на неактивність / відновлення.

import { useEffect, useState } from "react";
import { formatDateDDMMYY } from "@/app/admin/direct/_components/direct-client-table-formatters";

type EventRow = {
  id: string;
  type: "entered" | "restored";
  kyivDay: string;
  source: string | null;
  createdAt: string;
};

export function InactiveLifecycleHistoryModal({
  clientId,
  clientName,
  open,
  onClose,
}: {
  clientId: string;
  clientName?: string;
  open: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);

  useEffect(() => {
    if (!open || !clientId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/admin/direct/clients/${encodeURIComponent(clientId)}/inactive-lifecycle`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        if (!cancelled) setEvents(Array.isArray(data.events) ? data.events : []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setEvents([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, clientId]);

  if (!open) return null;

  return (
    <dialog className="modal modal-open">
      <div className="modal-box max-w-md">
        <h3 className="font-bold text-lg">Історія неактивності</h3>
        {clientName ? <p className="text-sm opacity-70 mb-3">{clientName}</p> : null}
        {loading ? <p className="text-sm">Завантаження…</p> : null}
        {error ? <p className="text-sm text-error">{error}</p> : null}
        {!loading && !error && events.length === 0 ? (
          <p className="text-sm opacity-70">Подій поки немає.</p>
        ) : null}
        <ul className="space-y-2 mt-2">
          {events.map((ev) => (
            <li
              key={ev.id}
              className="flex items-start justify-between gap-2 rounded border border-base-300 px-3 py-2 text-sm"
            >
              <div>
                <div className="font-semibold">
                  {ev.type === "entered" ? "Вихід у неактивну" : "Відновлення"}
                </div>
                <div className="text-xs opacity-60">
                  {ev.source ? `джерело: ${ev.source}` : null}
                </div>
              </div>
              <div className="text-right tabular-nums text-xs">
                <div>{formatDateDDMMYY(ev.kyivDay)}</div>
              </div>
            </li>
          ))}
        </ul>
        <div className="modal-action">
          <button type="button" className="btn" onClick={onClose}>
            Закрити
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>
          close
        </button>
      </form>
    </dialog>
  );
}

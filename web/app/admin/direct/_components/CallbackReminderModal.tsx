// web/app/admin/direct/_components/CallbackReminderModal.tsx
// Діалог «Передзвонити»: форма + історія записів.

"use client";

import { useEffect, useState } from "react";
import type { DirectClient } from "@/lib/direct-types";
import { formatDateDDMMYYHHMM } from "./direct-client-table-formatters";

type Props = {
  client: DirectClient | null;
  isOpen: boolean;
  onClose: () => void;
  /** Після успішного збереження — оновити рядок у таблиці */
  onSaved: (client: DirectClient) => void | Promise<void>;
};

function formatScheduledYmd(ymd: string | null | undefined): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "—";
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  if (!y || !m || !d) return "—";
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const yy = String(y % 100).padStart(2, "0");
  return `${dd}.${mm}.${yy}`;
}

export function CallbackReminderModal({ client, isOpen, onClose, onSaved }: Props) {
  const [dateVal, setDateVal] = useState("");
  const [noteVal, setNoteVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Якщо API повернув manualSql (503 без DDL) — показуємо блок для копіювання в Neon */
  const [manualSqlForCopy, setManualSqlForCopy] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !client) return;
    setDateVal(client.callbackReminderKyivDay ?? "");
    // Поле коментаря завжди порожнє: текст лише відправляється в історію при збереженні
    setNoteVal("");
    setError(null);
    setManualSqlForCopy(null);
  }, [isOpen, client?.id, client?.callbackReminderKyivDay]);

  if (!isOpen || !client) return null;

  const history = [...(client.callbackReminderHistory ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setManualSqlForCopy(null);
    try {
      const res = await fetch(
        `/api/admin/direct/clients/${encodeURIComponent(client.id)}/callback-reminder`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scheduledKyivDay: dateVal === "" ? null : dateVal,
            note: noteVal.trim() === "" ? null : noteVal.trim(),
            ...(client.instagramUsername ? { _fallbackInstagram: client.instagramUsername } : {}),
          }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        detail?: string;
        manualSql?: string;
        client?: DirectClient;
      };
      if (!res.ok || !data.ok || !data.client) {
        const lines = [
          data.error || "Не вдалося зберегти",
          data.detail ? `Деталі: ${data.detail}` : null,
          data.manualSql
            ? "Скопіюйте SQL нижче в Neon Console → SQL Editor і виконайте один раз."
            : null,
        ].filter(Boolean);
        setError(lines.join("\n\n"));
        if (data.manualSql) {
          setManualSqlForCopy(data.manualSql);
        }
        return;
      }
      await onSaved(data.client);
      setManualSqlForCopy(null);
      setNoteVal("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const titleName =
    [client.firstName, client.lastName].filter(Boolean).join(" ").trim() || client.instagramUsername;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 flex-shrink-0 border-b border-base-300">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold text-lg">Передзвонити: {titleName}</h3>
            <button type="button" className="btn btn-sm btn-circle btn-ghost" onClick={onClose} aria-label="Закрити">
              ✕
            </button>
          </div>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          <div className="space-y-2">
            <div className="flex flex-row flex-wrap gap-3 items-end">
              <label className="flex flex-col gap-1 w-[50%] max-w-[11rem] shrink-0">
                <span className="text-xs text-base-content/70">Дата передзвону</span>
                <input
                  type="date"
                  className="input input-bordered input-sm w-full"
                  value={dateVal}
                  onChange={(e) => setDateVal(e.target.value)}
                  disabled={saving}
                />
              </label>
              <label className="flex flex-col gap-1 flex-1 min-w-[8rem]">
                <span className="text-xs text-base-content/70">Коментар</span>
                <textarea
                  className="textarea textarea-bordered textarea-sm w-full min-h-[4rem]"
                  placeholder="Текст коментаря…"
                  maxLength={2000}
                  value={noteVal}
                  onChange={(e) => setNoteVal(e.target.value)}
                  disabled={saving}
                />
              </label>
              <button
                type="button"
                className="btn btn-primary btn-sm shrink-0"
                disabled={saving}
                onClick={() => void handleSave()}
              >
                {saving ? <span className="loading loading-spinner loading-xs" /> : null}
                Зберегти
              </button>
            </div>
            {error ? (
              <p className="text-sm text-error whitespace-pre-wrap break-words">{error}</p>
            ) : null}
            {manualSqlForCopy ? (
              <div className="rounded border border-base-300 bg-base-200/50 p-2 text-xs">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-medium text-base-content/80">SQL для Neon (один раз)</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => void navigator.clipboard.writeText(manualSqlForCopy)}
                  >
                    Копіювати SQL
                  </button>
                </div>
                <pre className="overflow-x-auto max-h-32 text-[11px] leading-snug">{manualSqlForCopy}</pre>
              </div>
            ) : null}
          </div>

          <div className="border-t border-base-200 pt-3">
            <h4 className="text-sm font-semibold text-base-content/80 mb-2">Історія</h4>
            {history.length === 0 ? (
              <p className="text-sm text-base-content/50">Поки немає записів</p>
            ) : (
              <ul className="space-y-2 text-xs border border-base-200 rounded-md p-2 max-h-48 overflow-y-auto">
                {history.map((h, idx) => (
                  <li
                    key={`${h.createdAt}-${idx}`}
                    className={`border-b border-base-100 last:border-0 pb-2 last:pb-0 rounded-md px-2 py-1.5 -mx-1 ${
                      idx === 0 ? "bg-amber-50" : ""
                    }`}
                  >
                    <div className="grid grid-cols-1 gap-0.5">
                      <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0">
                        <span>
                          <span className="text-base-content/60">Створено: </span>
                          <span className="font-medium">{formatDateDDMMYYHHMM(h.createdAt)}</span>
                        </span>
                        <span className="text-base-content/40 hidden sm:inline" aria-hidden>
                          ·
                        </span>
                        <span>
                          <span className="text-base-content/60">Заплановано: </span>
                          <span className="font-medium">{formatScheduledYmd(h.scheduledKyivDay)}</span>
                        </span>
                      </div>
                      <div className="break-words">
                        <span className="text-base-content/60">Коментар: </span>
                        <span>{h.note?.trim() ? h.note : "—"}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

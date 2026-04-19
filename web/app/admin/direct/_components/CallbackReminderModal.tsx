// web/app/admin/direct/_components/CallbackReminderModal.tsx
// Діалог «Передзвонити»: форма + історія записів.

"use client";

import { useEffect, useMemo, useState } from "react";
import type { DirectClient } from "@/lib/direct-types";
import { formatDateDDMMYY } from "./direct-client-table-formatters";

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

/** Як у MessagesHistoryModal — ключ дня для групування */
function dayKeyFromIso(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return "";
  }
}

function formatDayHeaderUk(dayKey: string): string {
  try {
    const [y, m, d] = dayKey.split("-").map((x) => Number(x));
    if (!y || !m || !d) return dayKey;
    const dt = new Date(y, m - 1, d);
    const now = new Date();
    const sameYear = dt.getFullYear() === now.getFullYear();
    return new Intl.DateTimeFormat("uk-UA", {
      day: "numeric",
      month: "long",
      ...(sameYear ? {} : { year: "numeric" }),
    }).format(dt);
  } catch {
    return dayKey;
  }
}

function formatTimeHHMM(iso: string): string {
  try {
    const dt = new Date(iso);
    if (isNaN(dt.getTime())) return "";
    return dt.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

const KYIV_TZ = "Europe/Kyiv";

function kyivTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function kyivYmdFromIso(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: KYIV_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return "";
  }
}

/** Яскраво-червоний фон: дедлайн сьогодні (Kyiv) і запис у історії створено сьогодні (Kyiv) */
function isDeadlineAndCreatedTodayKyiv(
  scheduledYmd: string | null | undefined,
  createdAtIso: string
): boolean {
  const d = (scheduledYmd ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d !== kyivTodayYmd()) return false;
  const created = kyivYmdFromIso(createdAtIso);
  return created === kyivTodayYmd();
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

  const historySorted = useMemo(() => {
    if (!client) return [] as NonNullable<DirectClient["callbackReminderHistory"]>;
    return [...(client.callbackReminderHistory ?? [])].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [client?.id, client?.callbackReminderHistory]);

  /** Групи по календарному дню (як Inst), новіші зверху */
  const groupedHistory = useMemo(() => {
    type H = NonNullable<DirectClient["callbackReminderHistory"]>[number];
    if (!historySorted.length) return [] as { dayKey: string; items: H[] }[];
    const out: { dayKey: string; items: H[] }[] = [];
    let lastKey = "";
    for (const h of historySorted) {
      const k = dayKeyFromIso(h.createdAt) || "unknown";
      if (!out.length || k !== lastKey) {
        out.push({ dayKey: k, items: [h] });
        lastKey = k;
      } else {
        out[out.length - 1].items.push(h);
      }
    }
    return out;
  }, [historySorted]);

  if (!isOpen || !client) return null;

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

          <div className="border-t border-base-200 pt-2">
            {historySorted.length === 0 ? (
              <p className="text-xs text-base-content/50">Поки немає записів</p>
            ) : (
              <div className="max-h-52 overflow-y-auto pr-0.5 space-y-2">
                {groupedHistory.map((g, gi) => {
                  const dayLabel = g.dayKey === "unknown" ? "" : formatDayHeaderUk(g.dayKey);
                  return (
                    <div key={`${g.dayKey}-${gi}`} className="space-y-1">
                      {dayLabel ? (
                        <div className="flex justify-center py-0.5">
                          <span className="text-[10px] text-gray-500 bg-base-200 rounded-full px-2 py-0.5">
                            {dayLabel}
                          </span>
                        </div>
                      ) : null}
                      <div className="space-y-1.5">
                        {g.items.map((h, idx) => {
                          const key = `${h.createdAt}-${gi}-${idx}`;
                          const isLatest = gi === 0 && idx === 0;
                          const timeStr = formatTimeHHMM(h.createdAt);
                          const noteText = h.note?.trim() ? h.note : "—";
                          const deadlineLabel = formatScheduledYmd(h.scheduledKyivDay);
                          const createdShort = formatDateDDMMYY(h.createdAt);
                          const redPill = isDeadlineAndCreatedTodayKyiv(h.scheduledKyivDay, h.createdAt);
                          return (
                            <div key={key} className="flex flex-row gap-2 items-start min-w-0">
                              <div className="shrink-0 flex flex-col items-start gap-0.5 pt-0.5">
                                <span
                                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums leading-none ${
                                    redPill
                                      ? "bg-red-600 text-white shadow-sm"
                                      : "bg-gray-200 text-gray-900"
                                  }`}
                                >
                                  {deadlineLabel}
                                </span>
                                <span className="text-[10px] text-gray-500 tabular-nums leading-none text-left">
                                  {createdShort}
                                </span>
                              </div>
                              <div
                                className={`min-w-0 flex-1 rounded-2xl px-2 py-1.5 text-[11px] leading-snug bg-gray-100 text-gray-900 whitespace-pre-wrap break-words ${
                                  isLatest ? "ring-1 ring-amber-300/80" : ""
                                }`}
                              >
                                <div>{noteText}</div>
                                {timeStr ? (
                                  <div className="mt-0.5 flex justify-end">
                                    <span className="text-[9px] text-gray-500">{timeStr}</span>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

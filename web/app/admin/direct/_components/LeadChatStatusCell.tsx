// web/app/admin/direct/_components/LeadChatStatusCell.tsx
// Колонка «Статус ліда» (сторінка Ліди): за замовчуванням «Лід»; клік — список статусів переписки і конструктор.

"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DirectChatStatus, DirectClient } from "@/lib/direct-types";
import { ChatBadgeIcon, CHAT_BADGE_KEYS } from "./ChatBadgeIcon";

const NAME_MAX_LEN = 24;

/** Статуси, після яких пропонуємо одразу поставити нагадування (коли написати знову). */
const REMIND_STATUS_NAMES = new Set(["За коротке", "Подумає", "Інше місто / Закордон", "Не з'явилась", "Скасувала"]);
const REMIND_PRESETS: Array<{ label: string; days?: number; months?: number }> = [
  { label: "2 тижні", days: 14 },
  { label: "1 міс", months: 1 },
  { label: "2 міс", months: 2 },
  { label: "3 міс", months: 3 },
  { label: "6 міс", months: 6 },
];

function kyivTodayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function addToYmd(ymd: string, days = 0, months = 0): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d + days));
  return dt.toISOString().slice(0, 10);
}

// Кольори бейджів (як у ChatBadgeIcon) — для пастельного відтінку таблетки.
const BADGE_HEX: Record<string, string> = {
  badge_1: "#0ea5e9",
  badge_2: "#22c55e",
  badge_3: "#f97316",
  badge_4: "#a855f7",
  badge_5: "#ef4444",
  badge_6: "#14b8a6",
  badge_7: "#64748b",
  badge_8: "#eab308",
  badge_9: "#3b82f6",
  badge_10: "#111827",
};

/** Таблетка в стилі Каси: пастельна заливка, тонка рамка, м'яка тінь. */
const PILL_BASE =
  "inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border px-2 h-5 text-[11px] leading-none text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_3px_8px_-5px_rgba(15,23,42,0.3)] transition-[filter,transform] hover:brightness-[0.96] active:scale-[0.97] disabled:opacity-60";

function pillStyle(badgeKey: string | null): React.CSSProperties {
  if (!badgeKey) return { backgroundColor: "#f1f5f9", borderColor: "#e2e8f0" };
  const hex = BADGE_HEX[badgeKey] || BADGE_HEX.badge_1;
  return { backgroundColor: `${hex}1f`, borderColor: `${hex}55` };
}

const FIELD_CLASS =
  "h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.05)] focus:border-blue-300 focus:outline-none";
const TINT_BUTTON_CLASS =
  "h-7 rounded-lg border border-slate-200/80 bg-[#e3edf9] px-3 text-xs font-medium text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_4px_10px_-6px_rgba(15,23,42,0.28)] transition-[filter] hover:brightness-[0.96] disabled:opacity-60";
const GHOST_BUTTON_CLASS = "h-7 rounded-lg px-3 text-xs text-gray-600 hover:bg-slate-100";

type Props = {
  clientId: string;
  statusId: string | null | undefined;
  statuses: DirectChatStatus[];
  /** Після створення/редагування статусу — перезавантажити довідник на сторінці. */
  onStatusesChanged: () => void | Promise<void>;
  /** Статус клієнта збережено. */
  onChanged: (clientId: string, statusId: string | null) => void;
  /** Нагадування збережено (швидкий вибір після статусу). */
  onReminderSaved?: (client: DirectClient) => void;
  className?: string;
};

function badgeKeyOf(s: DirectChatStatus | null | undefined): string {
  return ((s as { badgeKey?: string } | null | undefined)?.badgeKey || "badge_1").toString();
}

export function LeadChatStatusCell({
  clientId,
  statusId,
  statuses,
  onStatusesChanged,
  onChanged,
  onReminderSaved,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Форма конструктора: id=null — новий статус, інакше редагування.
  // Після вибору статусу з REMIND_STATUS_NAMES — крок «Нагадати через…».
  const [remindFor, setRemindFor] = useState<string | null>(null);
  const [customDay, setCustomDay] = useState("");
  const [form, setForm] = useState<{ id: string | null; name: string; badgeKey: string } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const current = statusId ? statuses.find((s) => s.id === statusId) || null : null;

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const width = 260;
    const left = Math.min(r.left, window.innerWidth - width - 8);
    const spaceBelow = window.innerHeight - r.bottom;
    const top = spaceBelow > 360 ? r.bottom + 2 : Math.max(8, r.top - 362);
    setPos({ top, left: Math.max(8, left) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    // Прокрутка самого списку статусів не закриває попап.
    const onScroll = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setForm(null);
      setRemindFor(null);
      setCustomDay("");
      setError(null);
    }
  }, [open]);

  async function setClientStatus(next: string | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/direct/clients/${encodeURIComponent(clientId)}/chat-status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statusId: next, channel: "instagram" }),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.ok) {
        setError(data?.error || "Не вдалося зберегти статус");
        return;
      }
      onChanged(clientId, next);
      const picked = next ? statuses.find((s) => s.id === next) : null;
      if (picked && REMIND_STATUS_NAMES.has(picked.name.trim()) && onReminderSaved) {
        setRemindFor(picked.name.trim());
      } else {
        setOpen(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveReminder(day: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/direct/clients/${encodeURIComponent(clientId)}/callback-reminder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scheduledKyivDay: day, note: remindFor ? `Статус: ${remindFor}` : null }),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.ok) {
        setError(data?.error || "Не вдалося зберегти нагадування");
        return;
      }
      if (data.client) onReminderSaved?.(data.client as DirectClient);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveForm() {
    if (!form) return;
    const name = form.name.trim();
    if (!name) {
      setError("Вкажіть назву статусу");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const url = form.id
        ? `/api/admin/direct/chat-statuses/${encodeURIComponent(form.id)}`
        : "/api/admin/direct/chat-statuses";
      const res = await fetch(url, {
        method: form.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, badgeKey: form.badgeKey }),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.ok) {
        setError(data?.error || "Не вдалося зберегти статус");
        return;
      }
      setForm(null);
      await onStatusesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`${PILL_BASE} ${className}`}
        style={pillStyle(current ? badgeKeyOf(current) : null)}
        title={current ? `${current.name} — змінити статус` : "Лід — обрати статус"}
        onClick={() => setOpen((v) => !v)}
      >
        {current ? <ChatBadgeIcon badgeKey={badgeKeyOf(current)} size={14} /> : null}
        <span className="truncate">{current ? current.name : "Лід"}</span>
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={popRef}
              className="fixed z-[1000] w-[260px] max-h-[360px] overflow-y-auto rounded-xl border border-slate-200/80 bg-white p-2 text-xs shadow-[0_1px_2px_rgba(15,23,42,0.05),0_14px_28px_-10px_rgba(15,23,42,0.35)]"
              style={{ top: pos.top, left: pos.left }}
            >
              {remindFor ? (
                <div className="mb-2 rounded-xl border border-slate-200 bg-[#e3edf9] p-2">
                  <div className="mb-1 text-[9px] font-medium uppercase text-gray-600">
                    «{remindFor}» — нагадати написати через
                  </div>
                  <div className="mb-1.5 flex flex-wrap gap-1">
                    {REMIND_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        className={PILL_BASE}
                        style={pillStyle(null)}
                        disabled={busy}
                        onClick={() => void saveReminder(addToYmd(kyivTodayYmd(), p.days ?? 0, p.months ?? 0))}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      type="date"
                      className={`${FIELD_CLASS} h-7 flex-1`}
                      value={customDay}
                      min={kyivTodayYmd()}
                      onChange={(e) => setCustomDay(e.target.value)}
                    />
                    <button
                      type="button"
                      className={TINT_BUTTON_CLASS}
                      disabled={busy || !customDay}
                      onClick={() => void saveReminder(customDay)}
                    >
                      OK
                    </button>
                  </div>
                  <button type="button" className={`${GHOST_BUTTON_CLASS} mt-1 w-full`} onClick={() => setOpen(false)}>
                    Без нагадування
                  </button>
                </div>
              ) : null}
              <div className="mb-1 px-1 text-[9px] font-medium uppercase text-gray-500">Статус ліда</div>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className={`${PILL_BASE} ${!current ? "ring-2 ring-slate-400" : ""}`}
                  style={pillStyle(null)}
                  disabled={busy}
                  onClick={() => void setClientStatus(null)}
                >
                  Лід
                </button>
                {statuses.map((s) => (
                  <span key={s.id} className="group inline-flex items-center">
                    <button
                      type="button"
                      className={`${PILL_BASE} ${current?.id === s.id ? "ring-2 ring-slate-400" : ""}`}
                      style={pillStyle(badgeKeyOf(s))}
                      disabled={busy}
                      title={s.name}
                      onClick={() => void setClientStatus(s.id)}
                    >
                      <ChatBadgeIcon badgeKey={badgeKeyOf(s)} size={12} />
                      <span className="truncate max-w-[9rem]">{s.name}</span>
                    </button>
                    <button
                      type="button"
                      className="ml-0.5 rounded-full px-0.5 text-[10px] text-gray-400 hover:text-gray-700"
                      disabled={busy}
                      title="Редагувати статус"
                      onClick={() => setForm({ id: s.id, name: s.name || "", badgeKey: badgeKeyOf(s) })}
                    >
                      ✎
                    </button>
                  </span>
                ))}
              </div>

              {form ? (
                <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
                  <div className="mb-1 text-[9px] font-medium uppercase text-gray-500">
                    {form.id ? "Редагування статусу" : "Новий статус"}
                  </div>
                  <input
                    className={`${FIELD_CLASS} mb-1.5`}
                    value={form.name}
                    maxLength={NAME_MAX_LEN}
                    placeholder="Назва статусу"
                    autoFocus
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                  <div className="mb-1.5 flex flex-wrap gap-1">
                    {CHAT_BADGE_KEYS.map((k) => (
                      <button
                        key={k}
                        type="button"
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white ${form.badgeKey === k ? "ring-2 ring-slate-400" : "hover:bg-slate-100"}`}
                        onClick={() => setForm({ ...form, badgeKey: k })}
                      >
                        <ChatBadgeIcon badgeKey={k} size={14} />
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-end gap-1">
                    <button type="button" className={GHOST_BUTTON_CLASS} disabled={busy} onClick={() => setForm(null)}>
                      Скасувати
                    </button>
                    <button type="button" className={TINT_BUTTON_CLASS} disabled={busy} onClick={() => void saveForm()}>
                      Зберегти
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="mt-2 h-7 w-full rounded-lg border border-dashed border-slate-300 text-xs text-gray-600 hover:bg-slate-50"
                  disabled={busy}
                  onClick={() => setForm({ id: null, name: "", badgeKey: "badge_1" })}
                >
                  + Створити статус
                </button>
              )}

              {error ? <div className="mt-1 text-red-600">{error}</div> : null}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

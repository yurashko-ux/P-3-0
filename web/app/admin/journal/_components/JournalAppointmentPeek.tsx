"use client";

// Швидкий перегляд запису при наведенні / long-press на верхню смугу.

import { useEffect, useRef, useState } from "react";
import {
  JOURNAL_ATTENDANCE_OPTIONS,
  attendanceLabel,
  normalizeAttendance,
  type JournalAttendance,
} from "@/lib/journal/attendance";
import {
  ClientNameWithLoyalty,
  buildClientDisplayName,
} from "@/app/admin/_components/ClientNameWithLoyalty";

export type PeekAppointment = {
  id: string;
  datetime: string;
  seanceLength: number;
  attendance: number | null;
  clientName?: string | null;
  clientPhone?: string | null;
  lines: Array<{ serviceId: string | null; title: string; cost?: number | null }>;
  checkout?: {
    status: string;
    paidAmount: number;
    totalServices?: number;
  } | null;
  directClient: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    instagramUsername: string;
    phone?: string | null;
    spent?: number | null;
    visits?: number | null;
    lastVisitAt?: string | Date | null;
    noShowCount?: number | null;
  } | null;
};

function money(n: number) {
  return n.toLocaleString("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function moneyUaInt(n: number) {
  return n.toLocaleString("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function phoneOf(row: PeekAppointment) {
  return row.clientPhone || row.directClient?.phone || "";
}

function formatDuration(sec: number) {
  const m = Math.max(0, Math.round((sec || 0) / 60));
  if (m < 60) return `${m} хв.`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (rest === 0) return `${h} год.`;
  return `${h} год. ${rest} хв.`;
}

function formatLastVisitUa(iso?: string | Date | null) {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("uk-UA", { day: "numeric", month: "long", year: "numeric" });
}

function kyivRange(iso: string, seanceLength: number) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  const start = `${get("hour")}:${get("minute")}`;
  const [h, m] = start.split(":").map(Number);
  const endMin = (h || 0) * 60 + (m || 0) + Math.max(0, Math.round((seanceLength || 0) / 60));
  const end = `${String(Math.floor(endMin / 60) % 24).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
  return { label: `${start}–${end} · ${formatDuration(seanceLength)}` };
}

function directClientHref(clientId: string, label: string) {
  const params = new URLSearchParams();
  params.set("clientIds", clientId);
  params.set("source", "journalClient");
  if (label.trim()) params.set("label", label.trim());
  return `/admin/direct?${params.toString()}`;
}

export type PeekState = {
  row: PeekAppointment;
  pinned: boolean;
  x: number;
  y: number;
};

export function JournalAppointmentPeek({
  peek,
  onClose,
  onMouseEnterPanel,
  onMouseLeavePanel,
  onAttendanceChange,
}: {
  peek: PeekState;
  onClose: () => void;
  onMouseEnterPanel: () => void;
  onMouseLeavePanel: () => void;
  /** Після успішної зміни статусу — оновити сітку. */
  onAttendanceChange?: (appointmentId: string, attendance: JournalAttendance) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { row, pinned, x, y } = peek;
  const phone = phoneOf(row);
  const [att, setAtt] = useState<JournalAttendance>(() => normalizeAttendance(row.attendance));
  const [savingAtt, setSavingAtt] = useState(false);
  const [attError, setAttError] = useState<string | null>(null);
  const range = kyivRange(row.datetime, row.seanceLength);
  const visits = row.directClient?.visits;
  const spent = row.directClient?.spent;
  const displayName = buildClientDisplayName({
    firstName: row.directClient?.firstName,
    lastName: row.directClient?.lastName,
    clientName: row.clientName,
    fallback: row.directClient?.instagramUsername,
  });
  const servicesTotal =
    row.checkout?.totalServices != null
      ? Number(row.checkout.totalServices)
      : (row.lines || []).reduce((a, l) => a + (Number(l.cost) || 0), 0);
  const paid = Number(row.checkout?.paidAmount) || 0;
  const due = Math.max(0, servicesTotal - paid);

  const [pos, setPos] = useState({ left: x, top: y });
  const [depositBalance, setDepositBalance] = useState<number | null>(null);

  useEffect(() => {
    setAtt(normalizeAttendance(row.attendance));
    setAttError(null);
  }, [row.id, row.attendance]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - rect.width - pad);
    if (top + rect.height > window.innerHeight - pad) top = Math.max(pad, y - rect.height - 8);
    if (top < pad) top = pad;
    setPos({ left, top });
  }, [x, y, row.id, depositBalance, attError]);

  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(t)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [pinned, onClose]);

  useEffect(() => {
    const clientId = row.directClient?.id;
    if (!clientId) {
      setDepositBalance(0);
      return;
    }
    let cancelled = false;
    setDepositBalance(null);
    void fetch(`/api/admin/deposits?directClientId=${encodeURIComponent(clientId)}`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const accounts = json.accounts || json.deposits || [];
        const sum = (accounts as Array<{ balance?: number }>).reduce(
          (a, item) => a + (Number(item.balance) || 0),
          0,
        );
        setDepositBalance(sum);
      })
      .catch(() => {
        if (!cancelled) setDepositBalance(0);
      });
    return () => {
      cancelled = true;
    };
  }, [row.directClient?.id, row.id]);

  const copyPhone = async () => {
    if (!phone) return;
    try {
      await navigator.clipboard.writeText(phone);
    } catch {
      /* ignore */
    }
  };

  const setAttendance = async (next: JournalAttendance) => {
    if (savingAtt || next === att) return;
    const prev = att;
    setAtt(next);
    setSavingAtt(true);
    setAttError(null);
    try {
      const res = await fetch(`/api/admin/journal/appointments/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendance: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setAtt(prev);
        setAttError(json.error || "Не вдалось змінити статус");
        return;
      }
      onAttendanceChange?.(row.id, next);
    } catch (err) {
      setAtt(prev);
      setAttError(err instanceof Error ? err.message : "Помилка мережі");
    } finally {
      setSavingAtt(false);
    }
  };

  const nameBlock = (
    <ClientNameWithLoyalty
      name={displayName}
      spent={spent}
      visits={visits}
      nameClassName="font-semibold text-sm text-gray-900"
    />
  );

  return (
    <div
      ref={panelRef}
      className="fixed z-[80] w-[300px] max-w-[calc(100vw-16px)] bg-white border border-gray-200 rounded-xl shadow-xl text-left"
      style={{ left: pos.left, top: pos.top }}
      onMouseEnter={onMouseEnterPanel}
      onMouseLeave={onMouseLeavePanel}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 pt-3 pb-2 border-b border-gray-100">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-sm text-gray-900 leading-snug">
              {row.directClient?.id ? (
                <a
                  href={directClientHref(row.directClient.id, displayName)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link link-hover"
                  title="Відкрити клієнта в Direct"
                  onClick={(e) => e.stopPropagation()}
                >
                  {nameBlock}
                </a>
              ) : (
                nameBlock
              )}
            </p>
            {phone ? (
              <button
                type="button"
                className="text-xs text-gray-600 hover:text-gray-900 mt-0.5 inline-flex items-center gap-1"
                onClick={() => void copyPhone()}
                title="Копіювати телефон"
              >
                {phone}
                <span className="text-gray-400" aria-hidden>
                  ⎘
                </span>
              </button>
            ) : (
              <p className="text-xs text-gray-400 mt-0.5">Телефон не вказано</p>
            )}
          </div>
          {pinned && (
            <button
              type="button"
              className="text-gray-400 hover:text-gray-700 text-sm px-1"
              onClick={onClose}
              title="Закрити"
            >
              ✕
            </button>
          )}
        </div>

        <div className="mt-2 text-[11px] bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 text-gray-800">
          Завдаток:{" "}
          <span className="font-semibold tabular-nums">
            {depositBalance != null ? `${moneyUaInt(depositBalance)} ₴` : "…"}
          </span>
        </div>
        <div className="mt-1.5 text-[11px] text-gray-600">
          Останній візит:{" "}
          <span className="font-medium text-gray-800">
            {formatLastVisitUa(row.directClient?.lastVisitAt)}
          </span>
        </div>
        <button
          type="button"
          className="mt-1.5 btn btn-xs btn-outline h-6 min-h-0 w-full border-blue-300 text-blue-700 text-[11px] font-normal hover:bg-blue-50"
          disabled
          title="Скоро: історія відвідувань клієнта"
        >
          Історія відвідувань
        </button>
      </div>

      <div className="px-3 py-2 flex flex-wrap gap-1">
        {JOURNAL_ATTENDANCE_OPTIONS.map((opt) => {
          const active = att === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={savingAtt}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-opacity disabled:opacity-60 hover:opacity-90"
              style={{
                background: active ? "#3e444d" : "#ebedf2",
                color: active ? "#fff" : "#1f2937",
              }}
              title={opt.label}
              onClick={() => void setAttendance(opt.value)}
            >
              <span style={{ color: active ? "#fff" : opt.iconColor }}>{opt.icon}</span>
              {opt.short}
            </button>
          );
        })}
      </div>
      {attError && <p className="px-3 pb-1 text-[10px] text-red-600">{attError}</p>}

      <div className="px-3 pb-2">
        <div className="text-[11px] font-semibold text-gray-700 mb-1">Послуги</div>
        <ul className="text-xs text-gray-800 space-y-0.5">
          {(row.lines || []).length === 0 && <li className="text-gray-400">Немає</li>}
          {(row.lines || []).map((l, i) => (
            <li key={`${row.id}-s-${i}`} className="flex justify-between gap-2">
              <span className="truncate">{l.title || "Послуга"}</span>
              {Number(l.cost) > 0 && (
                <span className="tabular-nums shrink-0 text-gray-600">{money(Number(l.cost))} ₴</span>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-0.5 text-xs">
          <div className="flex justify-between font-medium">
            <span>Разом</span>
            <span className="tabular-nums">{money(servicesTotal)} ₴</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>До сплати</span>
            <span className="tabular-nums">{money(due)} ₴</span>
          </div>
        </div>
      </div>

      <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 rounded-b-xl space-y-1">
        <p className="text-[11px] text-gray-700">{range.label}</p>
        <p className="text-[11px] text-gray-500">Статус: {attendanceLabel(att)}</p>
        {row.checkout?.status === "synced" && paid > 0 ? (
          <p className="text-[11px] text-emerald-700 font-medium">Візит оплачено · {money(paid)} ₴</p>
        ) : (
          <p className="text-[11px] text-amber-700">Оплата ще не проведена в касі</p>
        )}
        {pinned && (
          <p className="text-[10px] text-gray-400 pt-0.5">Закріплено · Esc або клік поза вікном — закрити</p>
        )}
      </div>
    </div>
  );
}

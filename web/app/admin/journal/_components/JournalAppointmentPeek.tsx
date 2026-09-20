"use client";

// Швидкий перегляд запису при наведенні / long-press на верхню смугу (лише перегляд).

import { useEffect, useRef, useState } from "react";
import {
  JOURNAL_ATTENDANCE_OPTIONS,
  attendanceLabel,
  normalizeAttendance,
} from "@/lib/journal/attendance";
import {
  SpendCircleBadge,
  SpendMegaBadge,
  SpendStarBadge,
} from "@/app/admin/direct/_components/DirectClientTableRowBadges";

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
  } | null;
};

function money(n: number) {
  return n.toLocaleString("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function clientLabel(row: PeekAppointment) {
  if (row.clientName) return row.clientName;
  const c = row.directClient;
  if (c) return [c.lastName, c.firstName].filter(Boolean).join(" ") || c.instagramUsername;
  return "Клієнт";
}

function phoneOf(row: PeekAppointment) {
  return row.clientPhone || row.directClient?.phone || "";
}

/** Лояльність як у Direct (колонка «Імʼя»): зірка ≥100k, інакше жовтий кружечок. */
function SpendLoyaltyBadge({ spent }: { spent?: number | null }) {
  const spendValue = (() => {
    const num = typeof spent === "number" ? spent : Number(spent);
    return Number.isFinite(num) ? num : 0;
  })();
  const spendShowMega = spendValue > 1_000_000;
  const spendShowStar = spendValue >= 100_000;
  const spendShowCircleTen = spendValue >= 20_000 && spendValue < 100_000;
  const spendShowCircleOne = spendValue >= 10_000 && spendValue < 20_000;
  const spendCircleRaw = Math.floor(spendValue / 10_000);
  const spendCircleNumber = Math.min(9, Math.max(2, spendCircleRaw));
  const spendStarRaw = Math.floor(spendValue / 100_000);
  const spendStarNumber = Math.min(9, Math.max(1, spendStarRaw));
  const spendShowStarNumber = spendValue > 200_000;
  const title = `Витрати: ${money(spendValue)} ₴`;

  if (spendShowMega) {
    return (
      <span title={title} className="inline-flex shrink-0">
        <SpendMegaBadge />
      </span>
    );
  }
  if (spendShowStar) {
    return (
      <span title={title} className="inline-flex shrink-0">
        <SpendStarBadge
          size={spendShowStarNumber ? 20 : 16}
          number={spendShowStarNumber ? spendStarNumber : undefined}
          fontSize={spendShowStarNumber ? 8 : 11}
        />
      </span>
    );
  }
  if (spendShowCircleTen) {
    return (
      <span title={title} className="inline-flex shrink-0">
        <SpendCircleBadge size={16} number={spendCircleNumber} />
      </span>
    );
  }
  if (spendShowCircleOne) {
    return (
      <span title={title} className="inline-flex shrink-0">
        <SpendCircleBadge size={16} number={1} />
      </span>
    );
  }
  return (
    <span title={title} className="inline-flex shrink-0">
      <SpendCircleBadge size={16} />
    </span>
  );
}

function formatDuration(sec: number) {
  const m = Math.max(0, Math.round((sec || 0) / 60));
  if (m < 60) return `${m} хв.`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (rest === 0) return `${h} год.`;
  return `${h} год. ${rest} хв.`;
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
}: {
  peek: PeekState;
  onClose: () => void;
  onMouseEnterPanel: () => void;
  onMouseLeavePanel: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { row, pinned, x, y } = peek;
  const phone = phoneOf(row);
  const att = normalizeAttendance(row.attendance);
  const range = kyivRange(row.datetime, row.seanceLength);
  const visits = row.directClient?.visits;
  const spent = row.directClient?.spent;
  const servicesTotal =
    row.checkout?.totalServices != null
      ? Number(row.checkout.totalServices)
      : (row.lines || []).reduce((a, l) => a + (Number(l.cost) || 0), 0);
  const paid = Number(row.checkout?.paidAmount) || 0;
  const due = Math.max(0, servicesTotal - paid);

  const [pos, setPos] = useState({ left: x, top: y });

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
  }, [x, y, row.id]);

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

  const copyPhone = async () => {
    if (!phone) return;
    try {
      await navigator.clipboard.writeText(phone);
    } catch {
      /* ignore */
    }
  };

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
            <p className="font-semibold text-sm text-gray-900 leading-snug flex items-start gap-1.5">
              <SpendLoyaltyBadge spent={spent} />
              <span className="min-w-0">
                {clientLabel(row)}
                {visits != null ? (
                  <span className="text-gray-500 font-normal"> ({visits})</span>
                ) : null}
              </span>
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
      </div>

      <div className="px-3 py-2 flex flex-wrap gap-1">
        {JOURNAL_ATTENDANCE_OPTIONS.map((opt) => {
          const active = att === opt.value;
          return (
            <span
              key={opt.value}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium"
              style={{
                background: active ? "#3e444d" : "#ebedf2",
                color: active ? "#fff" : "#1f2937",
              }}
              title="Лише перегляд"
            >
              <span style={{ color: active ? "#fff" : opt.iconColor }}>{opt.icon}</span>
              {opt.short}
            </span>
          );
        })}
      </div>

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

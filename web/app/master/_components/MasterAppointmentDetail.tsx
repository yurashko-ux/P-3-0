"use client";

import { attendanceBlockStyle } from "@/lib/journal/attendance";
import { formatDurationShort, formatKyivTimeRange } from "../_lib/kyiv-day";
import type { MasterAppointment } from "./types";

function displayName(row: MasterAppointment): string {
  const fromClient = [row.directClient?.firstName, row.directClient?.lastName].filter(Boolean).join(" ").trim();
  return fromClient || row.clientName || "Без імені";
}

function formatLastVisit(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("uk-UA", { day: "numeric", month: "long", year: "numeric" });
}

export function MasterAppointmentDetail({
  row,
  onClose,
}: {
  row: MasterAppointment;
  onClose: () => void;
}) {
  const name = displayName(row);
  const style = attendanceBlockStyle(row.attendance);
  const range = formatKyivTimeRange(row.datetime, row.seanceLength);
  const duration = formatDurationShort(row.seanceLength);
  const phone = row.clientPhone;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-[0_12px_40px_rgba(15,23,42,0.18)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <span className="text-sm font-semibold text-gray-900">Запис</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xs font-medium text-gray-500 transition hover:bg-gray-100 active:scale-95"
          >
            Закрити
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div>
            <div className="text-lg font-semibold text-gray-900">{name}</div>
            {row.staffName && <div className="text-xs text-slate-500">Майстер: {row.staffName}</div>}
            {phone && (
              <a href={`tel:${phone}`} className="mt-0.5 block text-sm text-slate-600">
                📞 {phone}
              </a>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-slate-50 p-3">
            <div className="text-sm font-medium text-gray-900">
              {range} · {duration}
            </div>
            <div className="mt-1 text-sm text-gray-600">
              {row.lines.length > 0 ? row.lines.map((l) => l.title).join(", ") : "Без послуг"}
            </div>
          </div>

          {row.directClient && (
            <div className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-slate-50 p-3 text-sm">
              <span className="text-gray-500">Візитів: {row.directClient.visits ?? 0}</span>
              <span className="text-gray-500">Востаннє: {formatLastVisit(row.directClient.lastVisitAt)}</span>
            </div>
          )}

          <div
            className="rounded-full px-3 py-1.5 text-center text-sm font-medium"
            style={{ background: style.bg, color: style.text }}
          >
            {attendanceLabelFull(row.attendance)}
          </div>
        </div>
      </div>
    </div>
  );
}

function attendanceLabelFull(attendance: number): string {
  if (attendance === 1) return "Клієнт прийшов";
  if (attendance === -1) return "Не з'явився";
  if (attendance === 2) return "Підтверджено";
  return "Очікування";
}

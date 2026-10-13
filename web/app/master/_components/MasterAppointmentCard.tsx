"use client";

import { attendanceBlockStyle } from "@/lib/journal/attendance";
import { formatDurationShort, formatKyivTimeRange } from "../_lib/kyiv-day";
import type { MasterAppointment } from "./types";

const AVATAR_PALETTE = ["#e7eef6", "#e5f2e9", "#e6eef8", "#f5e9e0", "#efe6f5"];

function displayName(row: MasterAppointment): string {
  const fromClient = [row.directClient?.firstName, row.directClient?.lastName].filter(Boolean).join(" ").trim();
  return fromClient || row.clientName || "Без імені";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || "");
  return letters.join("") || "?";
}

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function serviceTitles(row: MasterAppointment): string {
  const titles = row.lines.map((l) => l.title).filter(Boolean);
  return titles.length > 0 ? titles.join(", ") : "Без послуг";
}

export function MasterAppointmentCard({
  row,
  onClick,
}: {
  row: MasterAppointment;
  onClick: () => void;
}) {
  const name = displayName(row);
  const style = attendanceBlockStyle(row.attendance);
  const range = formatKyivTimeRange(row.datetime, row.seanceLength);
  const duration = formatDurationShort(row.seanceLength);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.05),0_8px_18px_-10px_rgba(15,23,42,0.25)] transition active:scale-[0.99]"
      style={{ borderLeft: `4px solid ${style.strip}` }}
    >
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-gray-700"
        style={{ background: avatarColor(name) }}
      >
        {initials(name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-medium tabular-nums text-gray-500">
          {range} · {duration}
        </span>
        <span className="mt-0.5 block truncate text-sm font-semibold text-gray-900">{name}</span>
        <span className="mt-0.5 block truncate text-xs text-gray-500">{serviceTitles(row)}</span>
      </span>
      <span
        className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
        style={{ background: style.bg, color: style.text }}
      >
        {attendanceShortLabel(row.attendance)}
      </span>
    </button>
  );
}

function attendanceShortLabel(attendance: number): string {
  if (attendance === 1) return "Прийшов";
  if (attendance === -1) return "Не з'явився";
  if (attendance === 2) return "Підтвердив";
  return "Очікування";
}

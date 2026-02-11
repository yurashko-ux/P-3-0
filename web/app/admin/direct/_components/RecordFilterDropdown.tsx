"use client";

import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { DirectClient } from "@/lib/direct-types";
import type { DirectFilters } from "./DirectClientTable";
import { FilterIconButton } from "./FilterIconButton";

const KYIV = "Europe/Kyiv";
function toKyivYearMonth(iso: string): string {
  try {
    const s = new Date(iso).toLocaleString("en-CA", { timeZone: KYIV, year: "numeric", month: "2-digit", day: "2-digit" });
    return s.replace(/\//g, "-").slice(0, 7);
  } catch {
    return "";
  }
}
function toKyivDay(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-CA", { timeZone: KYIV, year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-");
  } catch {
    return "";
  }
}
const curMonth = toKyivYearMonth(new Date().toISOString());
const todayKyiv = toKyivDay(new Date().toISOString());

const YEARS = ["26", "27", "28"];
const MONTHS = [
  { v: "1", l: "Січень" }, { v: "2", l: "Лютий" }, { v: "3", l: "Березень" }, { v: "4", l: "Квітень" },
  { v: "5", l: "Травень" }, { v: "6", l: "Червень" }, { v: "7", l: "Липень" }, { v: "8", l: "Серпень" },
  { v: "9", l: "Вересень" }, { v: "10", l: "Жовтень" }, { v: "11", l: "Листопад" }, { v: "12", l: "Грудень" },
];

type RecordClientOpt = "attended" | "no_show" | "cancelled" | "pending" | "rebook" | "unknown";
type RecordSumOpt = "lt_10k" | "gt_10k";

interface RecordFilterDropdownProps {
  clients: DirectClient[];
  totalClientsCount?: number;
  filters: DirectFilters;
  onFiltersChange: (f: DirectFilters) => void;
  columnLabel: string;
}

export function RecordFilterDropdown({
  clients,
  totalClientsCount,
  filters,
  onFiltersChange,
  columnLabel,
}: RecordFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const r = filters.record;

  const [hasRecord, setHasRecord] = useState<boolean | null>(r.hasRecord ?? null);
  const [newClient, setNewClient] = useState<boolean | null>(r.newClient ?? null);
  const [createdMode, setCreatedMode] = useState<"current_month" | "year_month" | null>(r.created.mode);
  const [createdYear, setCreatedYear] = useState(r.created.year || "");
  const [createdMonth, setCreatedMonth] = useState(r.created.month || "");
  const [createdPreset, setCreatedPreset] = useState<"past" | "today" | "future" | null>(r.createdPreset);
  const [appointedMode, setAppointedMode] = useState<"current_month" | "year_month" | null>(r.appointed.mode);
  const [appointedYear, setAppointedYear] = useState(r.appointed.year || "");
  const [appointedMonth, setAppointedMonth] = useState(r.appointed.month || "");
  const [appointedPreset, setAppointedPreset] = useState<"past" | "today" | "future" | null>(r.appointedPreset);
  const [clientOpt, setClientOpt] = useState<RecordClientOpt | null>(r.client);
  const [sumOpt, setSumOpt] = useState<RecordSumOpt | null>(r.sum);

  useEffect(() => {
    setHasRecord(r.hasRecord ?? null);
    setNewClient(r.newClient ?? null);
    setCreatedMode(r.created.mode);
    setCreatedYear(r.created.year || "");
    setCreatedMonth(r.created.month || "");
    setCreatedPreset(r.createdPreset);
    setAppointedMode(r.appointed.mode);
    setAppointedYear(r.appointed.year || "");
    setAppointedMonth(r.appointed.month || "");
    setAppointedPreset(r.appointedPreset);
    setClientOpt(r.client);
    setSumOpt(r.sum);
  }, [r.hasRecord, r.newClient, r.created.mode, r.created.year, r.created.month, r.createdPreset, r.appointed.mode, r.appointed.year, r.appointed.month, r.appointedPreset, r.client, r.sum]);

  const createdCurCount = useMemo(() => clients.filter((x) => toKyivYearMonth((x as any).paidServiceRecordCreatedAt) === curMonth).length, [clients]);
  const createdTodayCount = useMemo(() => clients.filter((x) => toKyivDay((x as any).paidServiceRecordCreatedAt) === todayKyiv).length, [clients]);
  const appointedCurCount = useMemo(() => clients.filter((x) => toKyivYearMonth(x.paidServiceDate) === curMonth).length, [clients]);
  const appointedPastCount = useMemo(() => clients.filter((x) => { const d = toKyivDay(x.paidServiceDate); return d && d < todayKyiv; }).length, [clients]);
  const appointedTodayCount = useMemo(() => clients.filter((x) => toKyivDay(x.paidServiceDate) === todayKyiv).length, [clients]);
  const appointedFutureCount = useMemo(() => clients.filter((x) => { const d = toKyivDay(x.paidServiceDate); return d && d > todayKyiv; }).length, [clients]);
  const hasRecordCount = useMemo(() => clients.filter((x) => x.paidServiceDate != null && String(x.paidServiceDate).trim() !== "").length, [clients]);
  const newClientCount = useMemo(() => clients.filter((x) => x.consultationAttended === true && x.paidServiceDate != null && String(x.paidServiceDate).trim() !== "").length, [clients]);

  useLayoutEffect(() => {
    if (isOpen && dropdownRef.current && typeof document !== "undefined") {
      const rect = dropdownRef.current.getBoundingClientRect();
      setPanelPosition({ top: rect.bottom + 4, left: rect.left });
    } else {
      setPanelPosition(null);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        dropdownRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) return;
      setIsOpen(false);
    };
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const hasActive =
    r.hasRecord === true || r.newClient === true || r.created.mode !== null || r.createdPreset !== null || r.appointed.mode !== null || r.appointedPreset !== null || r.client !== null || r.sum !== null;

  const handleApply = () => {
    onFiltersChange({
      ...filters,
      record: {
        hasRecord: hasRecord ?? null,
        newClient: newClient ?? null,
        created: createdMode === "current_month" ? { mode: "current_month" } : createdMode === "year_month" && createdYear && createdMonth
          ? { mode: "year_month", year: createdYear, month: createdMonth } : { mode: null },
        createdPreset: createdPreset ?? null,
        appointed: appointedMode === "current_month" ? { mode: "current_month" } : appointedMode === "year_month" && appointedYear && appointedMonth
          ? { mode: "year_month", year: appointedYear, month: appointedMonth } : { mode: null },
        appointedPreset: appointedPreset ?? null,
        client: clientOpt ?? null,
        sum: sumOpt ?? null,
      },
    });
    setIsOpen(false);
  };

  const handleClear = () => {
    setHasRecord(null);
    setNewClient(null);
    setCreatedMode(null);
    setCreatedYear("");
    setCreatedMonth("");
    setCreatedPreset(null);
    setAppointedMode(null);
    setAppointedYear("");
    setAppointedMonth("");
    setAppointedPreset(null);
    setClientOpt(null);
    setSumOpt(null);
    onFiltersChange({
      ...filters,
      record: {
        hasRecord: null,
        newClient: null,
        created: { mode: null },
        createdPreset: null,
        appointed: { mode: null },
        appointedPreset: null,
        client: null,
        sum: null,
      },
    });
    setIsOpen(false);
  };

  const opt = (key: string, label: string, sel: boolean, onClick: () => void, count?: number) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between hover:bg-base-200 transition-colors ${sel ? "bg-blue-50 text-blue-700" : "text-gray-700"}`}
    >
      <span className="flex items-center gap-2">
        <span className={`inline-block w-3 h-3 rounded border ${sel ? "bg-blue-600 border-blue-600" : "border-gray-400 bg-white"}`}>
          {sel && <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 12 12"><path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </span>
        <span>{label}</span>
      </span>
      {count != null && <span className="text-gray-500 font-medium">({count})</span>}
    </button>
  );

  const radio = (key: string, label: string, sel: boolean, onClick: () => void) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-2 hover:bg-base-200 transition-colors ${sel ? "bg-blue-50 text-blue-700" : "text-gray-700"}`}
    >
      <span className={`inline-block w-3 h-3 rounded-full border ${sel ? "bg-blue-600 border-blue-600" : "border-gray-400 bg-white"}`} />
      <span>{label}</span>
    </button>
  );

  const section = (title: string, children: React.ReactNode) => (
    <div className="mt-2 first:mt-0" key={title}>
      <div className="px-2 py-1 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );

  const panelContent = (
    <div className="p-2">
            <div className="flex items-center justify-between text-xs font-semibold text-gray-700 mb-2 px-2">
              <span>Фільтри: {columnLabel}</span>
              {totalClientsCount != null && totalClientsCount > 0 && <span className="text-gray-500 font-normal">({totalClientsCount})</span>}
            </div>
            {section("Запис", (
              <>
                {opt("has-record", "Є запис", hasRecord === true, () => setHasRecord(hasRecord === true ? null : true), hasRecordCount)}
                <button
                  type="button"
                  onClick={() => setNewClient(newClient === true ? null : true)}
                  title="Прийшли на консультацію і мають запис на платну послугу (жовтий фон у колонці Майстер)"
                  className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between hover:bg-base-200 transition-colors ${newClient === true ? "bg-yellow-50 text-yellow-800" : "text-gray-700"}`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`inline-block w-3 h-3 rounded border ${newClient === true ? "bg-[#EAB308] border-[#EAB308]" : "border-gray-400 bg-white"}`}>
                      {newClient === true && <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 12 12"><path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    </span>
                    <span>Новий клієнт</span>
                  </span>
                  {newClientCount != null && <span className="text-gray-500 font-medium">({newClientCount})</span>}
                </button>
              </>
            ))}
            {section("Візити створені", (
              <>
                {opt("rec-created-cur", "Поточний місяць", createdMode === "current_month", () => setCreatedMode(createdMode === "current_month" ? null : "current_month"), createdCurCount)}
                {opt("rec-created-today", "Сьогодні", createdPreset === "today", () => setCreatedPreset(createdPreset === "today" ? null : "today"), createdTodayCount)}
                <div className="flex gap-1 px-2 py-1">
                  <select value={createdYear} onChange={(e) => { setCreatedYear(e.target.value); setCreatedMode("year_month"); }} className="flex-1 px-1.5 py-1 rounded border border-gray-300 text-xs">
                    <option value="">Рік</option>
                    {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <select value={createdMonth} onChange={(e) => { setCreatedMonth(e.target.value); setCreatedMode("year_month"); }} className="flex-1 px-1.5 py-1 rounded border border-gray-300 text-xs">
                    <option value="">Міс.</option>
                    {MONTHS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
                  </select>
                </div>
              </>
            ))}
            {section("Візити призначені", (
              <>
                {opt("rec-appointed-cur", "Поточний місяць", appointedMode === "current_month", () => setAppointedMode(appointedMode === "current_month" ? null : "current_month"), appointedCurCount)}
                {opt("rec-today", "Сьогодні", appointedPreset === "today", () => setAppointedPreset(appointedPreset === "today" ? null : "today"), appointedTodayCount)}
                <div className="flex gap-1 px-2 py-1">
                  <select value={appointedYear} onChange={(e) => { setAppointedYear(e.target.value); setAppointedMode("year_month"); }} className="flex-1 px-1.5 py-1 rounded border border-gray-300 text-xs">
                    <option value="">Рік</option>
                    {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <select value={appointedMonth} onChange={(e) => { setAppointedMonth(e.target.value); setAppointedMode("year_month"); }} className="flex-1 px-1.5 py-1 rounded border border-gray-300 text-xs">
                    <option value="">Міс.</option>
                    {MONTHS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
                  </select>
                </div>
                {opt("rec-past", "Минулі", appointedPreset === "past", () => setAppointedPreset(appointedPreset === "past" ? null : "past"), appointedPastCount)}
                {opt("rec-future", "Майбутні", appointedPreset === "future", () => setAppointedPreset(appointedPreset === "future" ? null : "future"), appointedFutureCount)}
              </>
            ))}
            {section("Клієнт", (
              <>
                {opt("client-attended", "З'явився", clientOpt === "attended", () => setClientOpt(clientOpt === "attended" ? null : "attended"))}
                {opt("client-no_show", "Не з'явився", clientOpt === "no_show", () => setClientOpt(clientOpt === "no_show" ? null : "no_show"))}
                {opt("client-cancelled", "Скасував", clientOpt === "cancelled", () => setClientOpt(clientOpt === "cancelled" ? null : "cancelled"))}
                {opt("client-pending", "Очікуємо", clientOpt === "pending", () => setClientOpt(clientOpt === "pending" ? null : "pending"))}
                {opt("client-rebook", "Перезапис", clientOpt === "rebook", () => setClientOpt(clientOpt === "rebook" ? null : "rebook"))}
                {opt("client-unknown", "Статус не відомий", clientOpt === "unknown", () => setClientOpt(clientOpt === "unknown" ? null : "unknown"))}
              </>
            ))}
            {section("Сума запису", (
              <>
                {radio("sum-lt", "< 10 тис.", sumOpt === "lt_10k", () => setSumOpt(sumOpt === "lt_10k" ? null : "lt_10k"))}
                {radio("sum-gt", "> 10 тис.", sumOpt === "gt_10k", () => setSumOpt(sumOpt === "gt_10k" ? null : "gt_10k"))}
              </>
            ))}
            <div className="flex gap-2 mt-2">
              <button type="button" onClick={handleApply} className="flex-1 px-2 py-1.5 text-xs text-white bg-[#3b82f6] hover:bg-[#2563eb] rounded transition-colors font-medium">Застосувати</button>
              {hasActive && (
                <button type="button" onClick={handleClear} className="flex-1 px-2 py-1.5 text-xs text-white bg-pink-500 hover:bg-pink-600 rounded transition-colors font-medium">Очистити</button>
              )}
            </div>
    </div>
  );

  const portalTarget =
    typeof document !== "undefined" ? document.getElementById("direct-filter-dropdown-root") ?? document.body : null;

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <FilterIconButton active={hasActive} onClick={() => setIsOpen(!isOpen)} title={`Фільтри для ${columnLabel}`} />
      {isOpen &&
        panelPosition &&
        portalTarget &&
        createPortal(
          <div
            ref={panelRef}
            className="bg-white border border-gray-300 rounded-lg shadow-lg min-w-[220px] max-h-[420px] overflow-y-auto pointer-events-auto"
            style={{ position: "fixed", top: panelPosition.top, left: panelPosition.left, zIndex: 999999 }}
          >
            {panelContent}
          </div>,
          portalTarget
        )}
    </div>
  );
}

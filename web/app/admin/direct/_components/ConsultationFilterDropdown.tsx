"use client";

import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { DirectClient } from "@/lib/direct-types";
import type { DirectFilters } from "./DirectClientTable";
import { FilterIconButton } from "./FilterIconButton";
import { getAllowedFirstNames, groupByFirstTokenAndFilter } from "./masterFilterUtils";

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

interface ConsultationFilterDropdownProps {
  clients: DirectClient[];
  masters?: { id: string; name: string }[];
  totalClientsCount?: number;
  filters: DirectFilters;
  onFiltersChange: (f: DirectFilters) => void;
  columnLabel: string;
}

export function ConsultationFilterDropdown({
  clients,
  masters = [],
  totalClientsCount,
  filters,
  onFiltersChange,
  columnLabel,
}: ConsultationFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const c = filters.consultation;

  const [createdMode, setCreatedMode] = useState<"current_month" | "year_month" | null>(c.created.mode);
  const [createdYear, setCreatedYear] = useState(c.created.year || "");
  const [createdMonth, setCreatedMonth] = useState(c.created.month || "");
  const [createdPreset, setCreatedPreset] = useState<"past" | "today" | "future" | null>(c.createdPreset);
  const [appointedMode, setAppointedMode] = useState<"current_month" | "year_month" | null>(c.appointed.mode);
  const [appointedYear, setAppointedYear] = useState(c.appointed.year || "");
  const [appointedMonth, setAppointedMonth] = useState(c.appointed.month || "");
  const [appointedPreset, setAppointedPreset] = useState<"past" | "today" | "future" | null>(c.appointedPreset);
  const [attendance, setAttendance] = useState<"attended" | "no_show" | "cancelled" | null>(c.attendance);
  const [type, setType] = useState<"consultation" | "online" | null>(c.type);
  const [masterIds, setMasterIds] = useState<string[]>(c.masterIds);

  useEffect(() => {
    setCreatedMode(c.created.mode);
    setCreatedYear(c.created.year || "");
    setCreatedMonth(c.created.month || "");
    setCreatedPreset(c.createdPreset);
    setAppointedMode(c.appointed.mode);
    setAppointedYear(c.appointed.year || "");
    setAppointedMonth(c.appointed.month || "");
    setAppointedPreset(c.appointedPreset);
    setAttendance(c.attendance);
    setType(c.type);
    setMasterIds(c.masterIds);
  }, [c.created.mode, c.created.year, c.created.month, c.createdPreset, c.appointed.mode, c.appointed.year, c.appointed.month, c.appointedPreset, c.attendance, c.type, c.masterIds]);

  const allowedFirstNames = useMemo(() => getAllowedFirstNames(masters), [masters]);
  const masterOptions = useMemo(
    () =>
      groupByFirstTokenAndFilter(
        clients.map((x) => (x.consultationMasterName || "").toString().trim()),
        allowedFirstNames
      ),
    [clients, allowedFirstNames]
  );

  const createdCurCount = useMemo(() => clients.filter((x) => toKyivYearMonth((x as any).consultationRecordCreatedAt) === curMonth).length, [clients]);
  const createdTodayCount = useMemo(() => clients.filter((x) => toKyivDay((x as any).consultationRecordCreatedAt) === todayKyiv).length, [clients]);
  const appointedCurCount = useMemo(() => clients.filter((x) => toKyivYearMonth(x.consultationBookingDate) === curMonth).length, [clients]);
  const appointedPastCount = useMemo(() => clients.filter((x) => { const d = toKyivDay(x.consultationBookingDate); return d && d < todayKyiv; }).length, [clients]);
  const appointedTodayCount = useMemo(() => clients.filter((x) => toKyivDay(x.consultationBookingDate) === todayKyiv).length, [clients]);
  const appointedFutureCount = useMemo(() => clients.filter((x) => { const d = toKyivDay(x.consultationBookingDate); return d && d > todayKyiv; }).length, [clients]);

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
    c.created.mode !== null || c.createdPreset !== null || c.appointed.mode !== null || c.appointedPreset !== null || c.attendance !== null || c.type !== null || c.masterIds.length > 0;

  const handleApply = () => {
    onFiltersChange({
      ...filters,
      consultation: {
        created: createdMode === "current_month" ? { mode: "current_month" } : createdMode === "year_month" && createdYear && createdMonth
          ? { mode: "year_month", year: createdYear, month: createdMonth } : { mode: null },
        createdPreset: createdPreset ?? null,
        appointed: appointedMode === "current_month" ? { mode: "current_month" } : appointedMode === "year_month" && appointedYear && appointedMonth
          ? { mode: "year_month", year: appointedYear, month: appointedMonth } : { mode: null },
        appointedPreset: appointedPreset ?? null,
        attendance: attendance ?? null,
        type: type ?? null,
        masterIds: [...masterIds],
      },
    });
    setIsOpen(false);
  };

  const handleClear = () => {
    setCreatedMode(null);
    setCreatedYear("");
    setCreatedMonth("");
    setCreatedPreset(null);
    setAppointedMode(null);
    setAppointedYear("");
    setAppointedMonth("");
    setAppointedPreset(null);
    setAttendance(null);
    setType(null);
    setMasterIds([]);
    onFiltersChange({
      ...filters,
      consultation: {
        created: { mode: null },
        createdPreset: null,
        appointed: { mode: null },
        appointedPreset: null,
        attendance: null,
        type: null,
        masterIds: [],
      },
    });
    setIsOpen(false);
  };

  const toggleMaster = (name: string) => {
    setMasterIds((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
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

  const section = (title: string, children: React.ReactNode) => (
    <div className="mt-2 first:mt-0">
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
            {section("Консультації створені", (
              <>
                {opt("created-cur", "Поточний місяць", createdMode === "current_month", () => setCreatedMode(createdMode === "current_month" ? null : "current_month"), createdCurCount)}
                {opt("created-today", "Сьогодні", createdPreset === "today", () => setCreatedPreset(createdPreset === "today" ? null : "today"), createdTodayCount)}
                <div className="flex gap-1 px-2 py-1" key="created-ym">
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
            {section("Консультації призначені", (
              <>
                {opt("appointed-cur", "Поточний місяць", appointedMode === "current_month", () => setAppointedMode(appointedMode === "current_month" ? null : "current_month"), appointedCurCount)}
                {opt("preset-today", "Сьогодні", appointedPreset === "today", () => setAppointedPreset(appointedPreset === "today" ? null : "today"), appointedTodayCount)}
                <div className="flex gap-1 px-2 py-1" key="appointed-ym">
                  <select value={appointedYear} onChange={(e) => { setAppointedYear(e.target.value); setAppointedMode("year_month"); }} className="flex-1 px-1.5 py-1 rounded border border-gray-300 text-xs">
                    <option value="">Рік</option>
                    {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <select value={appointedMonth} onChange={(e) => { setAppointedMonth(e.target.value); setAppointedMode("year_month"); }} className="flex-1 px-1.5 py-1 rounded border border-gray-300 text-xs">
                    <option value="">Міс.</option>
                    {MONTHS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
                  </select>
                </div>
                {opt("preset-past", "Минулі", appointedPreset === "past", () => setAppointedPreset(appointedPreset === "past" ? null : "past"), appointedPastCount)}
                {opt("preset-future", "Майбутні", appointedPreset === "future", () => setAppointedPreset(appointedPreset === "future" ? null : "future"), appointedFutureCount)}
              </>
            ))}
            {section("Відвідування", (
              <>
                {opt("attended", "Прийшла", attendance === "attended", () => setAttendance(attendance === "attended" ? null : "attended"))}
                {opt("no_show", "Не з'явилась", attendance === "no_show", () => setAttendance(attendance === "no_show" ? null : "no_show"))}
                {opt("cancelled", "Скасувала", attendance === "cancelled", () => setAttendance(attendance === "cancelled" ? null : "cancelled"))}
              </>
            ))}
            {section("Тип", (
              <>
                {opt("type-consult", "Консультація", type === "consultation", () => setType(type === "consultation" ? null : "consultation"))}
                {opt("type-online", "Он-лайн консультація", type === "online", () => setType(type === "online" ? null : "online"))}
              </>
            ))}
            {masterOptions.length > 0 && section("Майстри", masterOptions.map(({ name, count }) => opt(`master-${name}`, name, masterIds.includes(name), () => toggleMaster(name), count)))}
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
            className="bg-white border border-gray-300 rounded-lg shadow-lg min-w-[240px] max-h-[420px] overflow-y-auto pointer-events-auto"
            style={{ position: "fixed", top: panelPosition.top, left: panelPosition.left, zIndex: 999999 }}
          >
            {panelContent}
          </div>,
          portalTarget
        )}
    </div>
  );
}

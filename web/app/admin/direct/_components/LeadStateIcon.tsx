// Іконка стану ліда як у Direct: 28px, знак агенції, клік відкриває вибір джерела.

"use client";

import { useEffect, useRef, useState } from "react";
import { kyivDayFromISO } from "@/lib/altegio/records-grouping";
import { LeadAgencyMark, LeadAgencyPending, StateIcon } from "./StateIcon";
import { useLeadSourcesMap } from "./useLeadSourcesMap";

type LeadSourceOption = { code: string; name: string; mark?: string | null; kind: string; hidden?: boolean };

const ICON_SIZE = 28;

export function LeadStateIcon({
  clientId,
  firstContactDate,
  leadAgency,
  leadAdId,
  sourceMark: sourceMarkProp = null,
  onAgencyChange,
  compact = false,
}: {
  clientId: string;
  firstContactDate?: string | null;
  leadAgency?: string | null;
  leadAdId?: string | null;
  /** Знак з API (Ліди) — щоб мітка була одразу, без очікування кешу джерел. */
  sourceMark?: string | null;
  onAgencyChange?: (leadAgency: string | null) => void;
  /** Не розтягує рядок: хмарка 28px малюється поверх комірки висотою 20px. */
  compact?: boolean;
}) {
  const today = kyivDayFromISO(new Date().toISOString());
  const firstDay = firstContactDate ? kyivDayFromISO(firstContactDate) : "";
  const isNewToday = Boolean(firstDay && firstDay === today);
  const title = isNewToday
    ? "Новий лід (перший контакт сьогодні)"
    : "Повідомлення / Лід (перший контакт раніше)";

  const sourcesMap = useLeadSourcesMap();
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<LeadSourceOption[]>([]);
  const [value, setValue] = useState(leadAgency || "");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setValue(leadAgency || "");
  }, [leadAgency]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function openMenu() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setMenuPos({ top: rect.bottom + 4, left: Math.max(8, rect.left - 40) });
    setOpen(true);
    setError(null);
    if (sources.length > 0 && !leadAdId) return;
    setLoading(true);
    try {
      const requests = [fetch("/api/admin/direct/lead-sources", { cache: "no-store", credentials: "include" })];
      if (leadAdId) {
        requests.push(fetch("/api/admin/direct/lead-sources/ad-ids", { cache: "no-store", credentials: "include" }));
      }
      const [sourcesRes, adIdsRes] = await Promise.all(requests);
      const sourcesData = await sourcesRes.json().catch(() => null);
      if (sourcesData?.ok) {
        setSources((sourcesData.sources || []) as LeadSourceOption[]);
      }
      if (leadAdId && adIdsRes) {
        const adIdsData = await adIdsRes.json().catch(() => null);
        const row = ((adIdsData?.adIds || []) as Array<{ adId: string; sourceCode: string | null }>).find(
          (item) => item.adId === leadAdId
        );
        setValue(row?.sourceCode || "");
      }
    } finally {
      setLoading(false);
    }
  }

  async function assign(code: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        leadAdId ? "/api/admin/direct/lead-sources/ad-ids" : "/api/admin/direct/lead-sources/manual-assign",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(
            leadAdId
              ? { adId: leadAdId, sourceCode: code || null }
              : { clientId, sourceCode: code || null }
          ),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Не вдалося зберегти джерело");
      }
      setValue(code);
      onAgencyChange?.(code || null);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка збереження");
    } finally {
      setSaving(false);
    }
  }

  // Як у Direct: 28px без scale — CSS transform на хмарці створював stacking context
  // і міг накривати знак без z-index (у Direct знаки на тих самих лідах видно).
  const icon = <StateIcon state={isNewToday ? "new-lead" : "message"} size={ICON_SIZE} />;
  const agency = (leadAgency || "").trim();
  const sourceMark =
    (sourceMarkProp || "").trim() ||
    (agency && (sourcesMap[agency]?.mark || sources.find((s) => s.code === agency)?.mark)) ||
    null;
  const marked =
    agency && sourceMark
      ? <LeadAgencyMark mark={sourceMark}>{icon}</LeadAgencyMark>
      : !agency && leadAdId
        ? <LeadAgencyPending>{icon}</LeadAgencyPending>
        : icon;
  const menuSources = sources.length > 0 ? sources : Object.values(sourcesMap);
  const options = (leadAdId ? menuSources.filter((source) => source.kind === "ads") : menuSources.filter((source) => !source.hidden));

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex items-center justify-center hover:opacity-70"
        title={`${title}. Обрати джерело`}
        onClick={() => {
          if (open) setOpen(false);
          else void openMenu();
        }}
      >
        {marked}
      </button>
      {open && menuPos ? (
        <div
          className="fixed z-50 w-44 rounded-md border border-gray-200 bg-white p-1 shadow-lg"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {loading ? (
            <div className="px-2 py-1 text-[11px] text-gray-500">Завантаження…</div>
          ) : (
            <select
              className="h-8 w-full rounded-md border border-gray-300 bg-white px-1 text-[12px] text-gray-900"
              value={value}
              disabled={saving}
              onChange={(event) => void assign(event.target.value)}
            >
              <option value="">{leadAdId ? "— не призначено —" : "— не визначено —"}</option>
              {options.map((source) => (
                <option key={source.code} value={source.code}>
                  {source.name}
                </option>
              ))}
            </select>
          )}
          {error ? <div className="px-1 pt-1 text-[10px] text-red-600">{error}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

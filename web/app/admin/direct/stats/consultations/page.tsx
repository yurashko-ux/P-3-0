// web/app/admin/direct/stats/consultations/page.tsx
// Нові ліди та консультації за місяць — вкладка з блоку «Ліди».

"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { kyivDayFromISO } from "@/lib/altegio/records-grouping";
import {
  buildConsultationTableRows,
  consultationControlBgHex,
  CONSULTATION_CONTROL_BG,
  CONSULTATION_ROW_BG,
  CONSULTATION_RESULT_OPTION_BG,
  CONSULTATION_RESULT_OPTIONS,
  consultationOverrideFromResultSelection,
  getAutoConsultationResultValue,
  getConsultationRowColorKey,
  getEffectiveConsultationResultValue,
  type ConsultationOutcome,
  type ConsultationResultValue,
  type ConsultationRowColorKey,
} from "@/lib/consultation-list-styles";
import { hasNormalInstagramUsername } from "@/lib/altegio/client-utils";
import type { DirectClient } from "@/lib/direct-types";
import { AvatarSlot } from "../../_components/DirectClientTableAvatar";
import { formatDateDDMMYY } from "../../_components/direct-client-table-formatters";
import { LeadStateIcon } from "../../_components/LeadStateIcon";
import { PhoneCopyButton } from "../../_components/PhoneCopyButton";
import { MessagesHistoryModal } from "../../_components/MessagesHistoryModal";
import { CallbackReminderCell } from "../../_components/CallbackReminderCell";
import { CallbackReminderModal } from "../../_components/CallbackReminderModal";
import { LeadChatStatusCell } from "../../_components/LeadChatStatusCell";
import { LeadStatusFilterDropdown, LEAD_STATUS_NONE } from "../../_components/LeadStatusFilterDropdown";
import type { DirectChatStatus } from "@/lib/direct-types";
import { useLeadSourcesMap } from "../../_components/useLeadSourcesMap";

type MasterOption = { id: string; name: string };

type ConsultationClient = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  instagramUsername: string;
  source: string;
  firstContactDate: string;
  callbackReminderKyivDay?: string | null;
  callbackReminderNote?: string | null;
  callbackReminderHistory?: DirectClient["callbackReminderHistory"];
  consultationBookingDate: string | null;
  consultationAttended: boolean | null;
  consultationCancelled: boolean;
  isOnlineConsultation: boolean;
  masterId: string | null;
  consultationMasterId?: string | null;
  consultationMasterName?: string | null;
  masterDisplayName: string | null;
  consultationListComment: string | null;
  consultationListOutcomeOverride: string | null;
  /** Телефон з Direct (форма Meta / Altegio). У таблиці — іконка, не текст. */
  phone?: string | null;
  signedUpForPaidService?: boolean;
  signedUpForPaidServiceAfterConsultation?: boolean;
  rowColorKey: ConsultationRowColorKey;
  outcome: ConsultationOutcome;
  isLeadOnly: boolean;
  /** Новий лід місяця (рахується в «Лід»); без нього — лише консультація в місяці. */
  isNewLead?: boolean;
  /** Унікальний ключ рядка (лід і копія консультації одного клієнта). */
  rowKey: string;
  /** Майбутня копія поза вікном місяця — не в summary/легенді консультацій. */
  countsTowardConsultationSummary?: boolean;
  messagesTotal?: number;
  instagramIncomingCount?: number;
  instagramOutgoingCount?: number;
  /** Останнє повідомлення від клієнтки, ми ще не відповіли — вихідні рожеві, як у Переписках. */
  waitingForReply?: boolean;
  chatNeedsAttention?: boolean;
  chatStatusId?: string | null;
  chatStatusName?: string | null;
  lastMessageAt?: string | null;
  leadAgency?: string | null;
  leadAdId?: string | null;
  /** Знак джерела з API — одразу на хмарці в колонці «Стан». */
  sourceMark?: string | null;
  sourceName?: string | null;
};

const COLOR_LEGEND: Array<{ key: ConsultationRowColorKey; label: string; className: string }> = [
  { key: "lead", label: "Лід", className: "bg-slate-200" },
  { key: "planned", label: "Очікуємо", className: "bg-yellow-200" },
  // Консультація відбулась позитивно = є запис на платну послугу = новий клієнт.
  { key: "positive", label: "Новий клієнт", className: "bg-green-200" },
  { key: "negative", label: "Відбулась (−)", className: "bg-red-200" },
  { key: "thinking", label: "Думає", className: "bg-sky-200" },
  { key: "no_show", label: "Не з'явилась", className: "bg-purple-200" },
];

const COL_COUNT = 13;

/** Ключ групи джерела ліда для лічильника і фільтра в шапці. */
function sourceKeyOf(c: ConsultationClient): string {
  const mark = (c.sourceMark || "").trim();
  return c.leadAgency || mark || "__none__";
}

function headerPillClass(active: boolean, count: number): string {
  const base =
    "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 h-5 leading-none transition-colors";
  if (count === 0) return `${base} border-gray-200 text-gray-400 cursor-not-allowed`;
  return active
    ? `${base} border-blue-500 bg-blue-100 ring-1 ring-blue-500 cursor-pointer`
    : `${base} border-gray-300 bg-white hover:bg-gray-100 cursor-pointer`;
}

/** Нативний select/input — daisyUI select-xs обрізає текст при малій висоті. */
const COMPACT_SELECT_BASE =
  "block w-full min-w-0 h-5 max-h-5 rounded-sm border border-neutral-300/50 px-1 pr-5 text-[11px] leading-5 text-neutral-900 appearance-auto cursor-pointer";
const COMPACT_INPUT_BASE =
  "block w-full min-w-0 h-5 max-h-5 rounded-sm border border-neutral-300/50 px-1 text-[11px] leading-5 text-neutral-900 placeholder:text-neutral-400";

function compactSelectClass(colorKey: ConsultationRowColorKey): string {
  return `${COMPACT_SELECT_BASE} ${CONSULTATION_CONTROL_BG[colorKey]}`;
}

function compactInputClass(colorKey: ConsultationRowColorKey): string {
  return `${COMPACT_INPUT_BASE} ${CONSULTATION_CONTROL_BG[colorKey]}`;
}

const WEEKDAYS_UK = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"];

/** Індекс дня тижня (0 = нд) для YYYY-MM-DD (календарний день, без зсуву часових поясів). */
function weekdayIndex(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function weekdayShortUk(ymd: string): string {
  return WEEKDAYS_UK[weekdayIndex(ymd)] ?? "";
}

/** Порядок у фільтрі: Пн … Нд. */
const WEEKDAY_FILTER_ORDER = [1, 2, 3, 4, 5, 6, 0];

function formatKyivDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const day = kyivDayFromISO(iso);
  if (!day) return "—";
  const [y, m, d] = day.split("-");
  return `${weekdayShortUk(day)} ${d}.${m}.${y}`;
}

function getClientName(c: ConsultationClient): string {
  const parts = [c.firstName, c.lastName].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return hasNormalInstagramUsername(c.instagramUsername) ? c.instagramUsername : "—";
}

function buildDirectClientHref(clientId: string, label?: string): string {
  const params = new URLSearchParams();
  params.set("clientIds", clientId);
  params.set("source", "consultationClient");
  if (label) params.set("label", label);
  return `/admin/direct?${params.toString()}`;
}

function buildMonthOptions(): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  let y = 2026;
  let mo = 1;
  for (let i = 0; i < 24; i++) {
    const value = `${y}-${String(mo).padStart(2, "0")}`;
    const label = new Intl.DateTimeFormat("uk-UA", {
      month: "long",
      year: "numeric",
      timeZone: "Europe/Kyiv",
    }).format(new Date(Date.UTC(y, mo - 1, 15, 12, 0, 0)));
    out.push({ value, label });
    mo += 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
  }
  return out;
}

async function patchConsultationClient(
  clientId: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; client?: Partial<ConsultationClient>; error?: string }> {
  const res = await fetch(`/api/admin/direct/stats/consultations/${encodeURIComponent(clientId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || !data?.ok) {
    return { ok: false, error: typeof data?.error === "string" ? data.error : `HTTP ${res.status}` };
  }
  return { ok: true, client: data.client };
}

function ConsultationsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const monthOptions = useMemo(() => buildMonthOptions(), []);

  const monthFromUrl = searchParams?.get("month") || "";
  const [selectedMonth, setSelectedMonth] = useState(() => {
    if (/^\d{4}-\d{2}$/.test(monthFromUrl)) return monthFromUrl;
    try {
      const m = kyivDayFromISO(new Date().toISOString()).slice(0, 7);
      return m < "2026-01" ? "2026-01" : m;
    } catch {
      return "2026-01";
    }
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<ConsultationClient[]>([]);
  const [masters, setMasters] = useState<MasterOption[]>([]);
  // Нові ліди за місяць (firstContactDate у місяці, Europe/Kyiv) — summary.newLeadsCount з API.
  const [newLeadsCount, setNewLeadsCount] = useState<number | null>(null);
  const [todayKyiv, setTodayKyiv] = useState(() => kyivDayFromISO(new Date().toISOString()));
  const [messagesClient, setMessagesClient] = useState<ConsultationClient | null>(null);
  const [reminderClient, setReminderClient] = useState<DirectClient | null>(null);
  // Довідник статусів переписки для колонки «Статус ліда».
  const [chatStatuses, setChatStatuses] = useState<DirectChatStatus[]>([]);
  const loadChatStatuses = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/direct/chat-statuses?scope=lead", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (data?.ok && Array.isArray(data.statuses)) setChatStatuses(data.statuses);
    } catch (err) {
      console.warn("[leads] Не вдалося завантажити статуси переписки", err);
    }
  }, []);
  useEffect(() => {
    void loadChatStatuses();
  }, [loadChatStatuses]);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [fullscreenAvatar, setFullscreenAvatar] = useState<{ src: string; username: string } | null>(
    null
  );
  // Одна мапа на сторінку (як у Direct), без скидання кешу на кожен load.
  const leadSourcesMap = useLeadSourcesMap();

  const clientsByRowKey = useMemo(() => {
    const map = new Map<string, ConsultationClient>();
    for (const c of clients) map.set(c.rowKey || c.id, c);
    return map;
  }, [clients]);

  const colorCounts = useMemo(() => {
    const counts: Record<ConsultationRowColorKey, number> = {
      lead: 0,
      planned: 0,
      positive: 0,
      negative: 0,
      thinking: 0,
      no_show: 0,
    };
    for (const c of clients) {
      // Рядки лідів рахуємо окремо (newLeadsCount), щоб мітка на рядку ліда не дублювала консультацію.
      if (c.isLeadOnly) continue;
      // Консультація з іншого місяця (напр. 03.11 у жовтневому списку) не входить у легенду.
      if (c.countsTowardConsultationSummary === false) continue;
      counts[c.rowColorKey] += 1;
    }
    // Лід — усі нові ліди місяця (дата першого контакту, Europe/Kyiv), кожен клієнт один раз.
    counts.lead =
      newLeadsCount ?? new Set(clients.filter((c) => c.isLeadOnly).map((c) => c.id)).size;
    return counts;
  }, [clients, newLeadsCount]);

  // Лічильник джерел лідів за обраний місяць: емодзі джерела + кількість (назва — у підказці).
  // Клієнт рахується один раз, навіть якщо в таблиці є і рядок ліда, і копія консультації.
  // Лише нові ліди місяця — сума джерел дорівнює лічильнику «Лід».
  const sourceCounts = useMemo(() => {
    const groups = new Map<string, { mark: string | null; name: string; count: number }>();
    const seen = new Set<string>();
    for (const c of clients) {
      if (!(c.isNewLead ?? c.isLeadOnly)) continue;
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const meta = c.leadAgency ? leadSourcesMap[c.leadAgency] : undefined;
      const mark = (c.sourceMark || "").trim() || meta?.mark || null;
      const name = (c.sourceName || "").trim() || meta?.name || c.leadAgency || "";
      const key = sourceKeyOf(c);
      const group = groups.get(key) || {
        mark: key === "__none__" ? "❔" : mark,
        name: key === "__none__" ? "Без джерела" : name || "Невідоме джерело",
        count: 0,
      };
      group.count += 1;
      groups.set(key, group);
    }
    return Array.from(groups.entries())
      .map(([key, g]) => ({ key, ...g }))
      .sort((a, b) => b.count - a.count);
  }, [clients, leadSourcesMap]);

  // Фільтр за лічильником у шапці: статус або джерело. Повторний клік знімає фільтр.
  const [headerFilter, setHeaderFilter] = useState<
    | { kind: "status"; key: ConsultationRowColorKey }
    | { kind: "consultations"; key: "all" }
    | { kind: "source"; key: string }
    | null
  >(null);
  const toggleHeaderFilter = (next: NonNullable<typeof headerFilter>) =>
    setHeaderFilter((cur) => (cur && cur.kind === next.kind && cur.key === next.key ? null : next));

  // Фільтр колонки «Статус ліда» (як у Direct): обрані статуси, LEAD_STATUS_NONE = «Лід» без статусу.
  const [leadStatusFilter, setLeadStatusFilter] = useState<string[]>([]);
  const leadStatusOptions = useMemo(() => {
    const counts = new Map<string, number>();
    const seen = new Set<string>();
    for (const c of clients) {
      if (!c.isLeadOnly || seen.has(c.id)) continue;
      seen.add(c.id);
      const key = (c.chatStatusId || "").trim() || LEAD_STATUS_NONE;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [
      { id: LEAD_STATUS_NONE, label: "Лід", count: counts.get(LEAD_STATUS_NONE) ?? 0, badgeKey: null },
      ...chatStatuses.map((st) => ({
        id: st.id,
        label: st.name,
        count: counts.get(st.id) ?? 0,
        badgeKey: ((st as { badgeKey?: string }).badgeKey || "badge_1").toString(),
      })),
    ];
  }, [clients, chatStatuses]);

  // Ті самі умови, що й у лічильниках, — щоб кількість рядків відповідала числу в шапці.
  const filteredClients = useMemo(() => {
    const base = leadStatusFilter.length
      ? clients.filter(
          (c) => c.isLeadOnly && leadStatusFilter.includes((c.chatStatusId || "").trim() || LEAD_STATUS_NONE)
        )
      : clients;
    return applyHeaderFilter(base);
  }, [clients, headerFilter, leadStatusFilter]);

  function applyHeaderFilter(clients: ConsultationClient[]): ConsultationClient[] {
    if (!headerFilter) return clients;
    if (headerFilter.kind === "consultations") {
      return clients.filter((c) => !c.isLeadOnly && c.countsTowardConsultationSummary !== false);
    }
    if (headerFilter.kind === "status") {
      if (headerFilter.key === "lead") return clients.filter((c) => c.isLeadOnly);
      return clients.filter(
        (c) =>
          !c.isLeadOnly &&
          c.countsTowardConsultationSummary !== false &&
          c.rowColorKey === headerFilter.key
      );
    }
    return clients.filter(
      (c) => (c.isNewLead ?? c.isLeadOnly) && sourceKeyOf(c) === headerFilter.key
    );
  }

  const allTableRows = useMemo(
    () => buildConsultationTableRows(filteredClients, todayKyiv),
    [filteredClients, todayKyiv]
  );

  // Фільтр за днем тижня (дата групи рядка: контакт для ліда, консультація для копії) — порівняння по днях.
  const [weekdayFilter, setWeekdayFilter] = useState<number | null>(null);
  const weekdayCounts = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const row of allTableRows) {
      if (row.type === "client") counts[weekdayIndex(row.kyivDay)] += 1;
    }
    return counts;
  }, [allTableRows]);
  const tableRows = useMemo(() => {
    if (weekdayFilter == null) return allTableRows;
    const kept = allTableRows.filter((row) => weekdayIndex(row.kyivDay) === weekdayFilter);
    // Роздільник дня лишаємо лише якщо під ним є рядки.
    return kept.filter(
      (row, i) => row.type === "client" || (kept[i + 1] && kept[i + 1].type === "client")
    );
  }, [allTableRows, weekdayFilter]);

  useEffect(() => {
    if (/^\d{4}-\d{2}$/.test(monthFromUrl) && monthFromUrl !== selectedMonth) {
      setSelectedMonth(monthFromUrl);
    }
  }, [monthFromUrl, selectedMonth]);

  const loadClients = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("month", selectedMonth);
      params.set("_t", String(Date.now()));
      const res = await fetch(`/api/admin/direct/stats/consultations?${params.toString()}`, {
        cache: "no-store",
        credentials: "include",
        headers: { "Cache-Control": "no-cache, no-store, must-revalidate", Pragma: "no-cache" },
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setClients([]);
        setMasters([]);
        setNewLeadsCount(null);
        setError(typeof data?.error === "string" ? data.error : `HTTP ${res.status}`);
        return;
      }
      const loaded = Array.isArray(data.clients) ? data.clients : [];
      setClients(
        loaded.map((c: ConsultationClient) => ({
          ...c,
          rowKey: c.rowKey || (c.isLeadOnly ? `${c.id}__lead` : `${c.id}__consultation`),
        }))
      );
      setMasters(Array.isArray(data.masters) ? data.masters : []);
      setNewLeadsCount(
        typeof data.summary?.newLeadsCount === "number" ? data.summary.newLeadsCount : null
      );
      if (typeof data.todayKyiv === "string") setTodayKyiv(data.todayKyiv);
    } catch (e) {
      setClients([]);
      setMasters([]);
      setNewLeadsCount(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  // Після #6 / повернення на вкладку — підтягнути свіжий список без F5.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadClients({ silent: true });
    };
    const onRefresh = () => {
      void loadClients({ silent: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("direct-leads-refresh", onRefresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("direct-leads-refresh", onRefresh);
    };
  }, [loadClients]);

  const updateClientLocal = useCallback((id: string, patch: Partial<ConsultationClient>) => {
    setClients((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const next = { ...c, ...patch };
        // Лід і копія консультації — один clientId; зберігаємо режим кожного рядка.
        next.isLeadOnly = c.isLeadOnly;
        next.rowKey = c.rowKey;
        next.countsTowardConsultationSummary = c.countsTowardConsultationSummary;
        next.rowColorKey = getConsultationRowColorKey({
          consultationBookingDate: c.isLeadOnly ? null : next.consultationBookingDate,
          outcome: next.outcome,
          consultationListOutcomeOverride: next.consultationListOutcomeOverride,
          signedUpForPaidService: next.signedUpForPaidService,
          signedUpForPaidServiceAfterConsultation: next.signedUpForPaidServiceAfterConsultation,
        });
        return next;
      })
    );
  }, []);

  const markSaving = useCallback((id: string, on: boolean) => {
    setSavingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleMasterChange = useCallback(
    async (clientId: string, masterId: string) => {
      markSaving(clientId, true);
      const res = await patchConsultationClient(clientId, {
        masterId: masterId || null,
      });
      markSaving(clientId, false);
      if (!res.ok) {
        setError(res.error || "Не вдалося зберегти майстра");
        return;
      }
      updateClientLocal(clientId, {
        masterId: res.client?.masterId ?? (masterId || null),
        consultationMasterId: res.client?.consultationMasterId ?? (masterId || null),
        consultationMasterName: res.client?.consultationMasterName ?? null,
        masterDisplayName: res.client?.masterDisplayName ?? null,
      });
    },
    [markSaving, updateClientLocal]
  );

  const handleOutcomeOverrideChange = useCallback(
    async (clientId: string, selected: ConsultationResultValue) => {
      const client = clients.find((row) => row.id === clientId);
      if (!client) return;
      const auto = getAutoConsultationResultValue(client);
      const override = consultationOverrideFromResultSelection(selected, auto);
      markSaving(clientId, true);
      const res = await patchConsultationClient(clientId, {
        consultationListOutcomeOverride: override ?? "",
      });
      markSaving(clientId, false);
      if (!res.ok) {
        setError(res.error || "Не вдалося зберегти мітку");
        return;
      }
      const savedOverride = res.client?.consultationListOutcomeOverride ?? null;
      updateClientLocal(clientId, {
        consultationListOutcomeOverride: savedOverride,
      });
    },
    [clients, markSaving, updateClientLocal]
  );

  // Вікно редагування коментаря (без обмежень вузького поля в таблиці).
  const [commentEdit, setCommentEdit] = useState<{ clientId: string; name: string; text: string } | null>(null);
  const [commentSaving, setCommentSaving] = useState(false);
  const saveCommentEdit = useCallback(async () => {
    if (!commentEdit) return;
    const { clientId } = commentEdit;
    const comment = commentEdit.text.trim();
    setCommentSaving(true);
    const res = await patchConsultationClient(clientId, { consultationListComment: comment });
    setCommentSaving(false);
    if (!res.ok) {
      setError(res.error || "Не вдалося зберегти коментар");
      return;
    }
    // Той самий коментар на всіх рядках клієнта (лід + копія консультації).
    setClients((prev) =>
      prev.map((row) => (row.id === clientId ? { ...row, consultationListComment: comment || null } : row))
    );
    setCommentEdit(null);
  }, [commentEdit]);

  function handleMonthChange(next: string) {
    setSelectedMonth(next);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("month", next);
    router.replace(`/admin/direct/stats/consultations?${params.toString()}`);
  }

  return (
    <div className="w-full max-w-full px-2 pt-1 pb-2 min-w-0">
      <div className="flex flex-wrap items-center gap-1 mb-1">
        <h1 className="text-sm font-semibold leading-none px-1">Ліди</h1>
        <select
          className="h-8 w-[12.5rem] shrink-0 rounded-md border border-gray-300 bg-white px-2 text-[13px] leading-8 text-gray-900"
          value={selectedMonth}
          onChange={(e) => handleMonthChange(e.target.value)}
        >
          {monthOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-outline btn-xs min-h-6 h-6 px-1.5 text-[10px]"
          disabled={loading}
          onClick={() => void loadClients()}
          title="Оновити список лідів"
        >
          Оновити
        </button>
        <div className="flex flex-wrap items-center gap-1 text-[11px]">
          {COLOR_LEGEND.flatMap((item) => {
            const count = colorCounts[item.key];
            const active = headerFilter?.kind === "status" && headerFilter.key === item.key;
            const pill = (
              <button
                key={item.key}
                type="button"
                disabled={count === 0}
                className={headerPillClass(active, count)}
                title={active ? "Зняти фільтр" : `Показати лише «${item.label}»`}
                onClick={() => toggleHeaderFilter({ kind: "status", key: item.key })}
              >
                <span className={`w-2.5 h-2.5 rounded-sm ${item.className}`} />
                {item.label}
                <span className="tabular-nums font-semibold">{count}</span>
              </button>
            );
            if (item.key !== "lead") return [pill];
            // Загальна кількість консультацій місяця = сума всіх статусів, крім «Лід».
            const consultTotal = COLOR_LEGEND.reduce(
              (sum, it) => (it.key === "lead" ? sum : sum + colorCounts[it.key]),
              0
            );
            const consultActive = headerFilter?.kind === "consultations";
            return [
              pill,
              <button
                key="consultations"
                type="button"
                disabled={consultTotal === 0}
                className={headerPillClass(consultActive, consultTotal)}
                title={consultActive ? "Зняти фільтр" : "Показати всі консультації місяця"}
                onClick={() => toggleHeaderFilter({ kind: "consultations", key: "all" })}
              >
                <span className="w-2.5 h-2.5 rounded-sm bg-orange-200" />
                Консультації
                <span className="tabular-nums font-semibold">{consultTotal}</span>
              </button>,
            ];
          })}
        </div>
        {sourceCounts.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-[11px] pl-1 border-l border-gray-300">
            {sourceCounts.map((s) => {
              const active = headerFilter?.kind === "source" && headerFilter.key === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  disabled={s.count === 0}
                  className={headerPillClass(active, s.count)}
                  title={active ? "Зняти фільтр" : `${s.name}: ${s.count} — показати лише цих лідів`}
                  onClick={() => toggleHeaderFilter({ kind: "source", key: s.key })}
                >
                  {s.mark ? <span className="text-sm leading-none">{s.mark}</span> : <span>{s.name}</span>}
                  <span className="tabular-nums font-semibold">{s.count}</span>
                </button>
              );
            })}
          </div>
        )}
        {/* Фільтр за днем тижня — порівняння кількості лідів по днях. */}
        <select
          className={`h-5 rounded-full border border-gray-300 px-1.5 text-[11px] font-normal leading-none outline-none focus:outline-none focus:ring-0 ${
            weekdayFilter != null ? "bg-blue-100 text-blue-900" : "bg-white text-gray-700"
          }`}
          value={weekdayFilter ?? ""}
          title="Показати лише один день тижня"
          onChange={(e) => setWeekdayFilter(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">Усі дні</option>
          {WEEKDAY_FILTER_ORDER.map((d) => (
            <option key={d} value={d}>
              {`${WEEKDAYS_UK[d][0].toUpperCase()}${WEEKDAYS_UK[d].slice(1)} (${weekdayCounts[d]})`}
            </option>
          ))}
        </select>
        {headerFilter && (
          <button
            type="button"
            className="btn btn-ghost btn-xs min-h-5 h-5 px-1 text-[10px]"
            onClick={() => setHeaderFilter(null)}
          >
            ✕ Скинути фільтр
          </button>
        )}
        {/* Статистика / Переписки / Журнал — у спільній панелі розділів (AdminTopNav) */}
        <Link
          href="/admin/direct/stats/leads"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-outline btn-xs min-h-6 h-6 px-1.5 text-[10px] ml-auto"
        >
          Джерела
        </Link>
      </div>

      {error && (
        <div className="alert alert-error mb-1 py-1 text-sm">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-1 overflow-x-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <span className="loading loading-spinner loading-md" />
            </div>
          ) : filteredClients.length === 0 ? (
            <p className="text-center text-gray-500 py-6">
              {headerFilter ? "За цим фільтром лідів немає." : "Записів за цей період немає."}
            </p>
          ) : (
            <table className="table table-xs table-fixed min-w-[1000px] [&_th]:!py-0.5 [&_th]:!px-1 [&_th]:text-[11px] [&_.consultation-data-row]:h-5 [&_.consultation-data-row_td]:!h-5 [&_.consultation-data-row_td]:!max-h-5 [&_.consultation-data-row_td]:!py-0 [&_.consultation-data-row_td]:!px-1 [&_.consultation-data-row_td]:text-[11px] [&_.consultation-data-row_td]:leading-5 [&_.consultation-data-row_td]:overflow-hidden [&_.lead-state-cell]:!overflow-visible">
              <colgroup>
                <col className="w-8" />
                <col className="w-[5.5rem]" />
                <col className="w-[7rem]" />
                <col className="w-[8rem]" />
                <col className="w-[3.2rem]" />
                <col className="w-[2.75rem]" />
                <col className="w-6" />
                <col className="w-[5.5rem]" />
                <col className="w-[7.25rem]" />
                <col className="w-[24rem]" />
                <col className="w-[6rem]" />
                <col className="w-[4.5rem]" />
                <col className="w-5" />
              </colgroup>
              <thead>
                <tr>
                  <th className="text-center">№</th>
                  <th>Дата контакту</th>
                  <th>Instagram</th>
                  <th>Ім&apos;я</th>
                  <th>Inst</th>
                  <th className="text-center">Стан</th>
                  <th className="text-center" title="Телефон">
                    Тел.
                  </th>
                  <th>Дата консультації</th>
                  <th>
                    <span className="inline-flex items-center gap-1">
                      Статус ліда
                      <LeadStatusFilterDropdown
                        // Статуси з 0 за період не показуємо (крім уже обраних — щоб можна було зняти).
                        options={leadStatusOptions.filter((o) => o.count > 0 || leadStatusFilter.includes(o.id))}
                        selected={leadStatusFilter}
                        onChange={setLeadStatusFilter}
                        total={leadStatusOptions.reduce((s, o) => s + o.count, 0)}
                      />
                    </span>
                  </th>
                  <th>Коментар</th>
                  <th>Нагадати</th>
                  <th>Майстер</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let rowNumber = 0;
                  return tableRows.map((row) => {
                  if (row.type === "day-separator") {
                    return (
                      <tr
                        key={`day-${row.kyivDay}`}
                        className={row.isToday ? "bg-base-300" : "bg-base-200"}
                      >
                        <td colSpan={COL_COUNT} className="py-0 text-center leading-none">
                          <span className="font-bold text-[10px] leading-none">
                            {/* День тижня перед датою: «нд 15.11.26 …», «Сьогодні пн 16.11.26 …» */}
                            {row.label.startsWith("Сьогодні ")
                              ? `Сьогодні ${weekdayShortUk(row.kyivDay)} ${row.label.slice("Сьогодні ".length)}`
                              : `${weekdayShortUk(row.kyivDay)} ${row.label}`}
                          </span>
                        </td>
                      </tr>
                    );
                  }

                  const c = clientsByRowKey.get(row.rowKey);
                  if (!c) return null;

                  rowNumber += 1;
                  // Технічні заглушки (missing_instagram_…, binotel_…) не показуємо — лише «—».
                  const hasInstagram = hasNormalInstagramUsername(c.instagramUsername);
                  const username = hasInstagram ? (c.instagramUsername || "").replace(/^@/, "") : "";
                  const instagramUrl = username ? `https://instagram.com/${username}` : null;
                  const avatarSrc = hasInstagram
                    ? `/api/admin/direct/instagram-avatar?clientId=${encodeURIComponent(c.id)}&username=${encodeURIComponent(username)}`
                    : null;
                  const rowBg = CONSULTATION_ROW_BG[c.rowColorKey];
                  const isSaving = savingIds.has(c.id);

                  return (
                    <tr key={row.rowKey} className={`consultation-data-row ${rowBg}`}>
                      <td className="tabular-nums text-center text-gray-600">{rowNumber}</td>
                      <td className="whitespace-nowrap tabular-nums">{formatKyivDate(c.firstContactDate)}</td>
                      <td>
                        <div className="flex items-center gap-1 min-w-0 h-5 max-h-5">
                          {avatarSrc ? (
                            <AvatarSlot
                              size="xs"
                              avatarSrc={avatarSrc}
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                              }}
                              onClick={() =>
                                setFullscreenAvatar({
                                  src: avatarSrc,
                                  username,
                                })
                              }
                            />
                          ) : null}
                          {instagramUrl ? (
                            <a
                              href={instagramUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="link link-primary text-[11px] break-all leading-tight min-w-0"
                              title={instagramUrl}
                            >
                              @{username}
                            </a>
                          ) : (
                            <span>—</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <Link
                          href={buildDirectClientHref(c.id, getClientName(c))}
                          className="link link-hover"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {getClientName(c)}
                        </Link>
                      </td>
                      <td className="text-center">
                        {(() => {
                          const total = typeof c.messagesTotal === "number" ? c.messagesTotal : 0;
                          const countClass =
                            total === 0
                              ? "bg-gray-200 text-gray-900"
                              : "bg-[#2AABEE] text-white";
                          const lastAt = formatDateDDMMYY(c.lastMessageAt);
                          const incoming = c.instagramIncomingCount ?? 0;
                          const outgoing = c.instagramOutgoingCount ?? 0;
                          // Розмова не закрита (останнє — від клієнтки) — рожевий, як у Переписках.
                          const pillColor = total > 0 && c.waitingForReply ? "bg-pink-500 text-white" : countClass;
                          return (
                            <button
                              type="button"
                              className={`inline-flex items-center justify-center rounded-full px-1.5 min-w-[1.25rem] h-4 text-[11px] tabular-nums leading-none ${pillColor}`}
                              title={`${c.waitingForReply ? "Клієнтка чекає відповіді. " : ""}Вхідні: ${incoming}, вихідні: ${outgoing}${
                                lastAt !== "-" ? `. Останнє повідомлення: ${lastAt}` : ""
                              }. Відкрити переписку`}
                              onClick={() => setMessagesClient(c)}
                            >
                              {total}
                            </button>
                          );
                        })()}
                      </td>
                      <td className="lead-state-cell text-center align-middle">
                        <LeadStateIcon
                          compact
                          clientId={c.id}
                          firstContactDate={c.firstContactDate}
                          leadAgency={c.leadAgency}
                          leadAdId={c.leadAdId}
                          sourceMark={
                            (c.sourceMark || "").trim() ||
                            (c.leadAgency ? leadSourcesMap[c.leadAgency]?.mark : null) ||
                            null
                          }
                          onAgencyChange={(leadAgency) => {
                            const patch = {
                              leadAgency,
                              sourceMark: leadAgency ? leadSourcesMap[leadAgency]?.mark || null : null,
                              sourceName: leadAgency ? leadSourcesMap[leadAgency]?.name || null : null,
                            };
                            setClients((prev) =>
                              prev.map((row) => {
                                const sameLead =
                                  row.id === c.id || Boolean(c.leadAdId && row.leadAdId === c.leadAdId);
                                return sameLead ? { ...row, ...patch } : row;
                              })
                            );
                          }}
                        />
                      </td>
                      <td className="text-center align-middle">
                        {(c.phone || "").trim() ? <PhoneCopyButton phone={c.phone!.trim()} /> : null}
                      </td>
                      <td className="whitespace-nowrap tabular-nums">
                        {formatKyivDate(c.consultationBookingDate)}
                      </td>
                      <td className="p-0.5 align-middle">
                        {c.isLeadOnly ? (
                          <LeadChatStatusCell
                            clientId={c.id}
                            statusId={c.chatStatusId}
                            statuses={chatStatuses}
                            onStatusesChanged={loadChatStatuses}
                            onChanged={(id, statusId) =>
                              setClients((prev) =>
                                prev.map((row) => (row.id === id ? { ...row, chatStatusId: statusId } : row))
                              )
                            }
                            onReminderSaved={(fresh) =>
                              setClients((prev) =>
                                prev.map((row) =>
                                  row.id === fresh.id
                                    ? {
                                        ...row,
                                        callbackReminderKyivDay: fresh.callbackReminderKyivDay ?? null,
                                        callbackReminderNote: fresh.callbackReminderNote ?? null,
                                        callbackReminderHistory: fresh.callbackReminderHistory ?? [],
                                      }
                                    : row
                                )
                              )
                            }
                          />
                        ) : (
                          <select
                            className={compactSelectClass(c.rowColorKey)}
                            value={getEffectiveConsultationResultValue(c)}
                            disabled={isSaving}
                            title={
                              CONSULTATION_RESULT_OPTIONS.find(
                                (o) => o.value === getEffectiveConsultationResultValue(c)
                              )?.label
                            }
                            onChange={(e) =>
                              void handleOutcomeOverrideChange(c.id, e.target.value as ConsultationResultValue)
                            }
                          >
                            {CONSULTATION_RESULT_OPTIONS.map((o) => (
                              <option
                                key={o.value}
                                value={o.value}
                                style={{ backgroundColor: CONSULTATION_RESULT_OPTION_BG[o.value] }}
                              >
                                {o.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="!px-0.5 align-middle">
                        {/* Коментар до статусу: коротко суть розмови і результат. */}
                        {/* Текст на всю колонку (до 2 рядків), редагування — у вікні по ✎. */}
                        <div className="flex h-5 items-center gap-1 overflow-hidden" title={c.consultationListComment || undefined}>
                          <button
                            type="button"
                            className="shrink-0 rounded px-0.5 text-[12px] leading-none text-gray-400 hover:bg-slate-100 hover:text-gray-700"
                            title="Редагувати коментар"
                            disabled={isSaving}
                            onClick={() => setCommentEdit({ clientId: c.id, name: getClientName(c), text: c.consultationListComment || "" })}
                          >
                            ✎
                          </button>
                          <span className="line-clamp-2 min-w-0 flex-1 whitespace-normal break-words text-[10px] leading-[10px] text-gray-800">
                            {c.consultationListComment || <span className="text-gray-400">—</span>}
                          </span>
                        </div>
                      </td>
                      <td className="p-0.5 align-middle">
                        <CallbackReminderCell
                          client={c as unknown as DirectClient}
                          leadsMode
                          onOpen={(dc) => setReminderClient(dc)}
                        />
                      </td>
                      <td className="p-0.5 align-middle">
                        <select
                          className={compactSelectClass(c.rowColorKey)}
                          value={c.masterId || ""}
                          disabled={isSaving}
                          title={
                            masters.find((m) => m.id === c.masterId)?.name ||
                            c.masterDisplayName ||
                            undefined
                          }
                          onChange={(e) => void handleMasterChange(c.id, e.target.value)}
                        >
                          <option value="" style={{ backgroundColor: consultationControlBgHex(c.rowColorKey) }}>
                            —
                          </option>
                          {c.masterId && !masters.some((m) => m.id === c.masterId) && (
                            <option value={c.masterId} style={{ backgroundColor: consultationControlBgHex(c.rowColorKey) }}>
                              {c.masterDisplayName || "поточний майстер"}
                            </option>
                          )}
                          {masters.map((m) => (
                            <option
                              key={m.id}
                              value={m.id}
                              style={{ backgroundColor: consultationControlBgHex(c.rowColorKey) }}
                            >
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="text-center">
                        {isSaving ? <span className="loading loading-spinner loading-xs" /> : null}
                      </td>
                    </tr>
                  );
                });
                })()}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {fullscreenAvatar ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75"
          onClick={() => setFullscreenAvatar(null)}
        >
          <img
            src={fullscreenAvatar.src}
            alt={fullscreenAvatar.username}
            className="max-w-[90vw] max-h-[90vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
      {commentEdit ? (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/30 p-4"
          onMouseDown={(e) => e.target === e.currentTarget && !commentSaving && setCommentEdit(null)}
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_14px_28px_-10px_rgba(15,23,42,0.35)]">
            <div className="mb-2 text-sm font-semibold text-gray-900">Коментар — {commentEdit.name}</div>
            <textarea
              autoFocus
              rows={6}
              className="w-full resize-y rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.05)] focus:border-blue-300 focus:outline-none"
              placeholder="Суть розмови, результат…"
              value={commentEdit.text}
              onChange={(e) => setCommentEdit({ ...commentEdit, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void saveCommentEdit();
                if (e.key === "Escape") setCommentEdit(null);
              }}
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="h-8 rounded-lg px-3 text-xs text-gray-600 hover:bg-slate-100"
                disabled={commentSaving}
                onClick={() => setCommentEdit(null)}
              >
                Скасувати
              </button>
              <button
                type="button"
                className="h-8 rounded-lg border border-slate-200/80 bg-[#e3edf9] px-4 text-xs font-medium text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_4px_10px_-6px_rgba(15,23,42,0.28)] hover:brightness-[0.96] disabled:opacity-60"
                disabled={commentSaving}
                onClick={() => void saveCommentEdit()}
              >
                {commentSaving ? "Зберігаю…" : "Зберегти"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <CallbackReminderModal
        client={reminderClient}
        isOpen={reminderClient != null}
        onClose={() => setReminderClient(null)}
        onSaved={(fresh) => {
          // Оновлюємо всі рядки клієнта (лід і копія консультації) без перезавантаження списку.
          setClients((prev) =>
            prev.map((row) =>
              row.id === fresh.id
                ? {
                    ...row,
                    callbackReminderKyivDay: fresh.callbackReminderKyivDay ?? null,
                    callbackReminderNote: fresh.callbackReminderNote ?? null,
                    callbackReminderHistory: fresh.callbackReminderHistory ?? [],
                  }
                : row
            )
          );
        }}
      />
      <MessagesHistoryModal
        client={(messagesClient as unknown as DirectClient | null)}
        isOpen={messagesClient != null}
        channel="instagram"
        // Розділ Ліди: синя крапка + кнопка «Консультація», не клієнтський «Запис»
        contactKind="lead"
        hideStatusPanel
        onClose={() => setMessagesClient(null)}
      />
    </div>
  );
}

export default function ConsultationsPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full px-2 py-6 flex items-center justify-center min-h-[200px]">
          <span className="loading loading-spinner loading-lg" />
        </div>
      }
    >
      <ConsultationsPageContent />
    </Suspense>
  );
}

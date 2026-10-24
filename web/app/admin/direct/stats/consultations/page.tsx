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
import { invalidateLeadSourcesMapCache } from "../../_components/useLeadSourcesMap";
import { MessagesHistoryModal } from "../../_components/MessagesHistoryModal";

type MasterOption = { id: string; name: string };

type ConsultationClient = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  instagramUsername: string;
  source: string;
  firstContactDate: string;
  consultationBookingDate: string | null;
  consultationAttended: boolean | null;
  consultationCancelled: boolean;
  isOnlineConsultation: boolean;
  masterId: string | null;
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
  messagesTotal?: number;
  chatNeedsAttention?: boolean;
  chatStatusId?: string | null;
  chatStatusName?: string | null;
  lastMessageAt?: string | null;
  leadAgency?: string | null;
  leadAdId?: string | null;
};

const COLOR_LEGEND: Array<{ key: ConsultationRowColorKey; label: string; className: string }> = [
  { key: "lead", label: "Лід (без запису)", className: "bg-slate-200" },
  { key: "planned", label: "Очікуємо", className: "bg-yellow-200" },
  { key: "positive", label: "Відбулась (+)", className: "bg-green-200" },
  { key: "negative", label: "Відбулась (−)", className: "bg-red-200" },
  { key: "thinking", label: "Думає", className: "bg-sky-200" },
  { key: "no_show", label: "Не з'явилась", className: "bg-purple-200" },
];

const COL_COUNT = 13;

function formatPhoneTooltip(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("0")) {
    return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8)}`;
  }
  if (d.length === 12 && d.startsWith("380")) {
    return `+380 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`;
  }
  return phone.trim();
}

function showCopiedToast(): void {
  if (typeof document === "undefined") return;
  const toast = document.createElement("div");
  toast.textContent = "скопійовано";
  toast.style.cssText = [
    "position: fixed",
    "top: 16px",
    "right: 16px",
    "z-index: 10050",
    "padding: 10px 14px",
    "border-radius: 10px",
    "color: #fff",
    "background: #16a34a",
    "font-size: 13px",
    "font-weight: 600",
    "box-shadow: 0 8px 24px rgba(0,0,0,0.16)",
  ].join(";");
  document.body.appendChild(toast);
  window.setTimeout(() => {
    toast.remove();
  }, 1500);
}

function LeadPhoneCopyButton({ phone }: { phone: string }) {
  const [copied, setCopied] = useState(false);
  const display = formatPhoneTooltip(phone);
  return (
    <button
      type="button"
      className="inline-flex h-5 w-5 items-center justify-center rounded text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
      title={copied ? "скопійовано" : display}
      aria-label={`Скопіювати телефон ${display}`}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(display);
          setCopied(true);
          showCopiedToast();
          window.setTimeout(() => setCopied(false), 1200);
        } catch {
          /* ignore */
        }
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-3.5 w-3.5"
        aria-hidden
      >
        <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1C10.4 21 3 13.6 3 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.46.57 3.58a1 1 0 01-.25 1.02l-2.2 2.19z" />
      </svg>
    </button>
  );
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

function formatKyivDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const day = kyivDayFromISO(iso);
  if (!day) return "—";
  const [y, m, d] = day.split("-");
  return `${d}.${m}.${y}`;
}

function getClientName(c: ConsultationClient): string {
  const parts = [c.firstName, c.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : c.instagramUsername;
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
  const [todayKyiv, setTodayKyiv] = useState(() => kyivDayFromISO(new Date().toISOString()));
  const [messagesClient, setMessagesClient] = useState<ConsultationClient | null>(null);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [fullscreenAvatar, setFullscreenAvatar] = useState<{ src: string; username: string } | null>(
    null
  );
  const commentTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clientsById = useMemo(() => {
    const map = new Map<string, ConsultationClient>();
    for (const c of clients) map.set(c.id, c);
    return map;
  }, [clients]);

  const tableRows = useMemo(
    () => buildConsultationTableRows(clients, todayKyiv),
    [clients, todayKyiv]
  );

  const colorCounts = useMemo(() => {
    const counts: Record<ConsultationRowColorKey, number> = {
      lead: 0,
      planned: 0,
      positive: 0,
      negative: 0,
      thinking: 0,
      no_show: 0,
    };
    for (const c of clients) counts[c.rowColorKey] += 1;
    return counts;
  }, [clients]);

  useEffect(() => {
    if (/^\d{4}-\d{2}$/.test(monthFromUrl) && monthFromUrl !== selectedMonth) {
      setSelectedMonth(monthFromUrl);
    }
  }, [monthFromUrl, selectedMonth]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      // Свіжа мапа джерел (знаки біля хмарки) — без застарілого кешу після змін у «Джерела».
      invalidateLeadSourcesMapCache();
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
        if (cancelled) return;
        if (!res.ok || !data?.ok) {
          setClients([]);
          setMasters([]);
          setError(typeof data?.error === "string" ? data.error : `HTTP ${res.status}`);
          return;
        }
        setClients(Array.isArray(data.clients) ? data.clients : []);
        setMasters(Array.isArray(data.masters) ? data.masters : []);
        if (typeof data.todayKyiv === "string") setTodayKyiv(data.todayKyiv);
      } catch (e) {
        if (!cancelled) {
          setClients([]);
          setMasters([]);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedMonth]);

  const updateClientLocal = useCallback((id: string, patch: Partial<ConsultationClient>) => {
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
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
        masterDisplayName: res.client?.masterDisplayName ?? null,
      });
    },
    [markSaving, updateClientLocal]
  );

  const handleOutcomeOverrideChange = useCallback(
    async (clientId: string, selected: ConsultationResultValue) => {
      const client = clientsById.get(clientId);
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
        rowColorKey: getConsultationRowColorKey({
          consultationBookingDate: client.isLeadOnly ? null : client.consultationBookingDate,
          outcome: client.outcome,
          consultationListOutcomeOverride: savedOverride,
          signedUpForPaidService: client.signedUpForPaidService,
          signedUpForPaidServiceAfterConsultation: client.signedUpForPaidServiceAfterConsultation,
        }),
      });
    },
    [clientsById, markSaving, updateClientLocal]
  );

  const scheduleCommentSave = useCallback(
    (clientId: string, comment: string) => {
      const existing = commentTimers.current.get(clientId);
      if (existing) clearTimeout(existing);
      commentTimers.current.set(
        clientId,
        setTimeout(async () => {
          commentTimers.current.delete(clientId);
          markSaving(clientId, true);
          const res = await patchConsultationClient(clientId, { consultationListComment: comment });
          markSaving(clientId, false);
          if (!res.ok) {
            setError(res.error || "Не вдалося зберегти коментар");
          }
        }, 600)
      );
    },
    [markSaving]
  );

  function handleMonthChange(next: string) {
    setSelectedMonth(next);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("month", next);
    router.replace(`/admin/direct/stats/consultations?${params.toString()}`);
  }

  return (
    <div className="w-full max-w-full px-2 pt-1 pb-2 min-w-0">
      <div className="flex flex-wrap items-center gap-1 mb-1">
        <Link href="/admin/direct/stats" className="btn btn-ghost btn-xs min-h-6 h-6 px-1.5 text-[10px]">
          ← Статистика
        </Link>
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
        <div className="flex flex-wrap items-center gap-1 text-[11px]">
          {COLOR_LEGEND.map((item) => (
            <span key={item.key} className="inline-flex items-center gap-1 whitespace-nowrap">
              <span className={`w-2.5 h-2.5 rounded-sm ${item.className}`} />
              {item.label}
              <span className="tabular-nums font-semibold">{colorCounts[item.key]}</span>
            </span>
          ))}
        </div>
        <Link
          href="/admin/direct/messages"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-outline btn-xs min-h-6 h-6 px-1.5 text-[10px] ml-auto"
        >
          Переписки
        </Link>
        <Link
          href="/admin/direct/stats/leads"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-outline btn-xs min-h-6 h-6 px-1.5 text-[10px]"
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
          ) : clients.length === 0 ? (
            <p className="text-center text-gray-500 py-6">Записів за цей період немає.</p>
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
                <col className="w-[7.5rem]" />
                <col className="w-[8rem]" />
                <col className="w-[8rem]" />
                <col className="w-[3rem]" />
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
                  <th>Результат</th>
                  <th>Коментар</th>
                  <th>Майстер</th>
                  <th>Онлайн</th>
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
                          <span className="font-bold text-[10px] leading-none">{row.label}</span>
                        </td>
                      </tr>
                    );
                  }

                  const c = clientsById.get(row.clientId);
                  if (!c) return null;

                  rowNumber += 1;
                  const username = (c.instagramUsername || "").replace(/^@/, "");
                  const instagramUrl = username ? `https://instagram.com/${username}` : null;
                  const rowBg = CONSULTATION_ROW_BG[c.rowColorKey];
                  const isSaving = savingIds.has(c.id);

                  return (
                    <tr key={c.id} className={`consultation-data-row ${rowBg}`}>
                      <td className="tabular-nums text-center text-gray-600">{rowNumber}</td>
                      <td className="whitespace-nowrap tabular-nums">{formatKyivDate(c.firstContactDate)}</td>
                      <td>
                        <div className="flex items-center gap-1 min-w-0 h-5 max-h-5">
                          {hasNormalInstagramUsername(c.instagramUsername) ? (
                            <AvatarSlot
                              size="xs"
                              avatarSrc={`/api/admin/direct/instagram-avatar?username=${encodeURIComponent(username)}`}
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                              }}
                              onClick={() =>
                                setFullscreenAvatar({
                                  src: `/api/admin/direct/instagram-avatar?username=${encodeURIComponent(username)}`,
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
                          const needs = Boolean(c.chatNeedsAttention);
                          const hasStatus = Boolean((c.chatStatusId || "").trim());
                          const countClass =
                            total === 0
                              ? "bg-gray-200 text-gray-900"
                              : needs || !hasStatus
                                ? "bg-[#2AABEE] text-white"
                                : "bg-gray-200 text-gray-900";
                          const lastAt = formatDateDDMMYY(c.lastMessageAt);
                          return (
                            <button
                              type="button"
                              className={`inline-flex items-center justify-center rounded-full px-1.5 min-w-[1.25rem] h-4 text-[11px] tabular-nums leading-none ${countClass}`}
                              title={
                                lastAt !== "-"
                                  ? `Останнє повідомлення: ${lastAt}. Відкрити переписку`
                                  : "Відкрити переписку"
                              }
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
                          onAgencyChange={(leadAgency) => updateClientLocal(c.id, { leadAgency })}
                        />
                      </td>
                      <td className="text-center align-middle">
                        {(c.phone || "").trim() ? <LeadPhoneCopyButton phone={c.phone!.trim()} /> : null}
                      </td>
                      <td className="whitespace-nowrap tabular-nums">
                        {formatKyivDate(c.consultationBookingDate)}
                      </td>
                      <td className="p-0.5 align-middle">
                        {c.isLeadOnly ? (
                          <span className="text-[11px] text-neutral-600 px-0.5">Лід</span>
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
                      <td className="p-0.5 align-middle">
                        <input
                          key={`${c.id}-${c.consultationListComment ?? ""}`}
                          type="text"
                          className={compactInputClass(c.rowColorKey)}
                          defaultValue={c.consultationListComment || ""}
                          placeholder="Коментар…"
                          disabled={isSaving}
                          onChange={(e) => scheduleCommentSave(c.id, e.target.value)}
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
                      <td>{c.isOnlineConsultation ? "так" : "—"}</td>
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
      <MessagesHistoryModal
        client={(messagesClient as unknown as DirectClient | null)}
        isOpen={messagesClient != null}
        channel="instagram"
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

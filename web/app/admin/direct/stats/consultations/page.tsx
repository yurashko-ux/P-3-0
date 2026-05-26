// web/app/admin/direct/stats/consultations/page.tsx
// Список лідів і консультацій за місяць — вкладка з блоку «Ліди».

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
  signedUpForPaidService?: boolean;
  signedUpForPaidServiceAfterConsultation?: boolean;
  rowColorKey: ConsultationRowColorKey;
  outcome: ConsultationOutcome;
  isLeadOnly: boolean;
};

type ConsultationsSummary = {
  newLeadsCount: number;
  leadOnlyCount: number;
  total: number;
  realized: number;
  planned: number;
  cancelled: number;
  noShow: number;
};

const COLOR_LEGEND: Array<{ key: ConsultationRowColorKey; label: string; className: string }> = [
  { key: "lead", label: "Лід (без запису)", className: "bg-slate-200" },
  { key: "planned", label: "Очікуємо", className: "bg-yellow-200" },
  { key: "positive", label: "Відбулась (+)", className: "bg-green-200" },
  { key: "negative", label: "Відбулась (−)", className: "bg-red-200" },
  { key: "thinking", label: "Думає", className: "bg-sky-200" },
  { key: "no_show", label: "Не з'явилась", className: "bg-purple-200" },
];

const COL_COUNT = 10;

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
  const [summary, setSummary] = useState<ConsultationsSummary | null>(null);
  const [anchorDay, setAnchorDay] = useState<string | null>(null);
  const [todayKyiv, setTodayKyiv] = useState(() => kyivDayFromISO(new Date().toISOString()));
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const commentTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const selectedMonthLabel = useMemo(
    () => monthOptions.find((o) => o.value === selectedMonth)?.label ?? selectedMonth,
    [monthOptions, selectedMonth]
  );

  const clientsById = useMemo(() => {
    const map = new Map<string, ConsultationClient>();
    for (const c of clients) map.set(c.id, c);
    return map;
  }, [clients]);

  const tableRows = useMemo(
    () => buildConsultationTableRows(clients, todayKyiv),
    [clients, todayKyiv]
  );

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
          setSummary(null);
          setError(typeof data?.error === "string" ? data.error : `HTTP ${res.status}`);
          return;
        }
        setClients(Array.isArray(data.clients) ? data.clients : []);
        setMasters(Array.isArray(data.masters) ? data.masters : []);
        setSummary(data.summary ?? null);
        setAnchorDay(typeof data.anchorDay === "string" ? data.anchorDay : null);
        if (typeof data.todayKyiv === "string") setTodayKyiv(data.todayKyiv);
      } catch (e) {
        if (!cancelled) {
          setClients([]);
          setMasters([]);
          setSummary(null);
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
    <div className="w-full max-w-full px-2 py-4 min-w-0">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Link href="/admin/direct/stats" className="btn btn-ghost btn-sm">
          ← Статистика
        </Link>
        <h1 className="text-xl font-semibold">Ліди та консультації</h1>
        <select
          className="select select-bordered select-sm"
          value={selectedMonth}
          onChange={(e) => handleMonthChange(e.target.value)}
        >
          {monthOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <p className="text-sm text-gray-500 mb-2">
        Усі ліди, які написали в Direct, і записи на консультацію за {selectedMonthLabel}
        {anchorDay ? ` (до ${formatKyivDate(anchorDay)} включно)` : ""}.
      </p>

      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        {COLOR_LEGEND.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-1">
            <span className={`w-3 h-3 rounded ${item.className}`} />
            {item.label}
          </span>
        ))}
      </div>

      {summary && (
        <div className="flex flex-wrap gap-2 mb-4 text-sm">
          <span className="badge badge-outline">Ліди: {summary.newLeadsCount}</span>
          {summary.leadOnlyCount > 0 ? (
            <span className="badge badge-ghost badge-outline">Без запису: {summary.leadOnlyCount}</span>
          ) : null}
          <span className="badge badge-outline">Консультації (План): {summary.total}</span>
          <span className="badge badge-success badge-outline">Відбулось (Факт): {summary.realized}</span>
          <span className="badge badge-warning badge-outline">Заплановано: {summary.planned}</span>
          <span className="badge badge-error badge-outline">Скасовано: {summary.cancelled}</span>
          <span className="badge badge-ghost badge-outline">Не прийшов: {summary.noShow}</span>
        </div>
      )}

      {error && (
        <div className="alert alert-error mb-4 text-sm">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-3 overflow-x-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <span className="loading loading-spinner loading-md" />
            </div>
          ) : clients.length === 0 ? (
            <p className="text-center text-gray-500 py-6">Лідів і консультацій за цей період немає.</p>
          ) : (
            <table className="table table-xs table-fixed min-w-[880px] [&_th]:py-0.5 [&_th]:text-[11px] [&_.consultation-data-row_td]:py-0 [&_.consultation-data-row_td]:text-[11px] [&_.consultation-data-row_td]:leading-5">
              <colgroup>
                <col className="w-8" />
                <col className="w-[5.5rem]" />
                <col className="w-[7rem]" />
                <col className="w-[8rem]" />
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
                        {instagramUrl ? (
                          <a
                            href={instagramUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="link link-primary text-[11px] break-all leading-tight"
                            title={instagramUrl}
                          >
                            @{username}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <Link
                          href={`/admin/direct?search=${encodeURIComponent(username || c.id)}`}
                          className="link link-hover"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {getClientName(c)}
                        </Link>
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

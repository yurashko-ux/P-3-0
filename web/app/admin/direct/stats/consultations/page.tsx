// web/app/admin/direct/stats/consultations/page.tsx
// Список консультацій за місяць (Altegio consultationBookingDate) — вкладка з блоку «Ліди».

"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { kyivDayFromISO } from "@/lib/altegio/records-grouping";

type ConsultationOutcome = "realized" | "cancelled" | "no_show" | "planned";

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
  consultationMasterName: string | null;
  masterDisplayName: string | null;
  outcome: ConsultationOutcome;
};

type ConsultationsSummary = {
  total: number;
  realized: number;
  planned: number;
  cancelled: number;
  noShow: number;
};

const OUTCOME_LABELS: Record<ConsultationOutcome, string> = {
  realized: "Відбулась",
  planned: "Заплановано",
  cancelled: "Скасовано",
  no_show: "Не прийшов",
};

const OUTCOME_BADGE_CLASS: Record<ConsultationOutcome, string> = {
  realized: "badge badge-success badge-sm",
  planned: "badge badge-warning badge-sm",
  cancelled: "badge badge-error badge-sm",
  no_show: "badge badge-ghost badge-sm",
};

function formatKyivDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const day = kyivDayFromISO(iso);
  if (!day) return "—";
  const [y, m, d] = day.split("-");
  return `${d}.${m}.${y}`;
}

function formatSource(source: string): string {
  if (source === "instagram") return "Інстаграм";
  if (source === "tiktok") return "TikTok";
  return source || "—";
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
  const [summary, setSummary] = useState<ConsultationsSummary | null>(null);
  const [anchorDay, setAnchorDay] = useState<string | null>(null);

  const selectedMonthLabel = useMemo(
    () => monthOptions.find((o) => o.value === selectedMonth)?.label ?? selectedMonth,
    [monthOptions, selectedMonth]
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
          setSummary(null);
          setError(typeof data?.error === "string" ? data.error : `HTTP ${res.status}`);
          return;
        }
        setClients(Array.isArray(data.clients) ? data.clients : []);
        setSummary(data.summary ?? null);
        setAnchorDay(typeof data.anchorDay === "string" ? data.anchorDay : null);
      } catch (e) {
        if (!cancelled) {
          setClients([]);
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
        <h1 className="text-xl font-semibold">Консультації</h1>
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

      <p className="text-sm text-gray-500 mb-3">
        Записи на консультацію в Altegio за {selectedMonthLabel}
        {anchorDay ? ` (до ${formatKyivDate(anchorDay)} включно)` : ""}.
      </p>

      {summary && (
        <div className="flex flex-wrap gap-2 mb-4 text-sm">
          <span className="badge badge-outline">Усього (План): {summary.total}</span>
          <span className="badge badge-success badge-outline">Відбулось (Факт): {summary.realized}</span>
          <span className="badge badge-warning badge-outline">Заплановано: {summary.planned}</span>
          <span className="badge badge-error badge-outline">Скасовано: {summary.cancelled}</span>
          <span className="badge badge-ghost badge-outline">Не прийшов: {summary.noShow}</span>
        </div>
      )}

      {error && (
        <div className="alert alert-error mb-4 text-sm">
          <span>{error}</span>
        </div>
      )}

      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-3 overflow-x-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <span className="loading loading-spinner loading-md" />
            </div>
          ) : clients.length === 0 ? (
            <p className="text-center text-gray-500 py-6">Консультацій за цей період немає.</p>
          ) : (
            <table className="table table-xs table-zebra">
              <thead>
                <tr>
                  <th>Дата контакту</th>
                  <th>Джерело</th>
                  <th>Instagram</th>
                  <th>Ім&apos;я</th>
                  <th>Дата консультації</th>
                  <th>Результат</th>
                  <th>Майстер</th>
                  <th>Онлайн</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => {
                  const username = (c.instagramUsername || "").replace(/^@/, "");
                  const instagramUrl = username ? `https://instagram.com/${username}` : null;
                  return (
                    <tr key={c.id}>
                      <td className="whitespace-nowrap tabular-nums">{formatKyivDate(c.firstContactDate)}</td>
                      <td>{formatSource(c.source)}</td>
                      <td>
                        {instagramUrl ? (
                          <a
                            href={instagramUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="link link-primary text-xs break-all"
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
                      <td>
                        <span className={OUTCOME_BADGE_CLASS[c.outcome]}>{OUTCOME_LABELS[c.outcome]}</span>
                      </td>
                      <td className="text-xs">{c.masterDisplayName || "—"}</td>
                      <td>{c.isOnlineConsultation ? "так" : "—"}</td>
                    </tr>
                  );
                })}
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

// Розділ «Переписки»: зліва клієнти, справа ліди. Джерело лише показується.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { kyivDayFromISO } from "@/lib/altegio/records-grouping";
import { hasNormalInstagramUsername } from "@/lib/altegio/client-utils";
import type { DirectClient } from "@/lib/direct-types";
import { AvatarSlot, WithCornerRedDot } from "../_components/DirectClientTableAvatar";
import {
  LeadBadgeIcon,
  SpendCircleBadge,
  SpendMegaBadge,
  SpendStarBadge,
} from "../_components/DirectClientTableRowBadges";
import { formatDateDDMMYY } from "../_components/direct-client-table-formatters";
import { LeadAgencyMark, LeadAgencyPending, StateIcon } from "../_components/StateIcon";
import { formatWaitingClock, waitingElapsedMs } from "@/lib/direct-reply-time";
import { MessagesHistoryModal } from "../_components/MessagesHistoryModal";

type MessageRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  instagramUsername: string;
  firstContactDate: string;
  lastMessageAt?: string | null;
  messagesTotal?: number;
  chatNeedsAttention?: boolean;
  chatStatusId?: string | null;
  leadAgency?: string | null;
  leadAdId?: string | null;
  sourceName?: string | null;
  sourceMark?: string | null;
  spent?: number | null;
  visits?: number | null;
  altegioClientId?: number | null;
  replyAvgMinutes?: number | null;
  waitingSince?: string | null;
};

type Audience = "clients" | "leads";

const PAGE_SIZE = 40;
const TODAY_ROW_SEPARATOR = "inset 0 -3px 0 #111111";

function getClientName(c: MessageRow): string {
  const parts = [c.firstName, c.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : c.instagramUsername;
}

function buildDirectClientHref(clientId: string, label?: string): string {
  const params = new URLSearchParams();
  params.set("clientIds", clientId);
  params.set("source", "messagesLead");
  if (label) params.set("label", label);
  return `/admin/direct?${params.toString()}`;
}

function isMessageToday(iso: string | null | undefined, todayKyiv: string): boolean {
  if (!iso) return false;
  return kyivDayFromISO(iso) === todayKyiv;
}

function sourceLabel(leadAgency?: string | null, leadAdId?: string | null, sourceName?: string | null): string {
  if (sourceName) return sourceName;
  if (!leadAgency && leadAdId) return "Оголошення без призначеного джерела";
  return leadAgency || "";
}

/** Хмарка як у Direct, знак джерела зверху. Без вибору. */
function LeadSourceCloud({
  firstContactDate,
  leadAgency,
  leadAdId,
  sourceName,
  sourceMark,
}: {
  firstContactDate?: string | null;
  leadAgency?: string | null;
  leadAdId?: string | null;
  sourceName?: string | null;
  sourceMark?: string | null;
}) {
  const today = kyivDayFromISO(new Date().toISOString());
  const firstDay = firstContactDate ? kyivDayFromISO(firstContactDate) : "";
  const isNewToday = Boolean(firstDay && firstDay === today);
  const titleBase = isNewToday ? "Новий лід (перший контакт сьогодні)" : "Повідомлення";
  const label = sourceLabel(leadAgency, leadAdId, sourceName);
  const title = label ? `${titleBase} · ${label}` : titleBase;
  const icon = (
    <span className="inline-flex origin-center scale-[1.4]">
      <StateIcon state={isNewToday ? "new-lead" : "message"} size={20} />
    </span>
  );
  const marked =
    leadAgency && sourceMark ? (
      <LeadAgencyMark mark={sourceMark}>{icon}</LeadAgencyMark>
    ) : !leadAgency && leadAdId ? (
      <LeadAgencyPending>{icon}</LeadAgencyPending>
    ) : (
      icon
    );
  return (
    <span className="inline-flex items-center justify-center" title={title}>
      {marked}
    </span>
  );
}

/** Зірка і кружечок витрат — ті самі пороги, що в колонці імені Direct. */
function ClientSpendBadge({ spent, altegioClientId }: { spent?: number | null; altegioClientId?: number | null }) {
  if (!altegioClientId) return <LeadBadgeIcon />;
  const spendValue = Number(spent) || 0;
  if (spendValue > 1000000) return <SpendMegaBadge />;
  if (spendValue >= 100000) {
    const showNumber = spendValue > 200000;
    const number = Math.min(9, Math.max(1, Math.floor(spendValue / 100000)));
    return <SpendStarBadge size={showNumber ? 22 : 18} number={showNumber ? number : undefined} fontSize={showNumber ? 8 : 12} />;
  }
  if (spendValue >= 20000) {
    const number = Math.min(9, Math.max(2, Math.floor(spendValue / 10000)));
    return <SpendCircleBadge number={number} />;
  }
  if (spendValue >= 10000) return <SpendCircleBadge number={1} />;
  return <SpendCircleBadge />;
}

/** Колір кнопки «Очистити» у фільтрах Direct (Tailwind pink-500 / #EC4899). */
const WAITING_INST_PILL_CLASS = "bg-pink-500 text-white";

function ReplyTimeCell({ row, now }: { row: MessageRow; now: number }) {
  if (row.waitingSince) {
    const since = new Date(row.waitingSince).getTime();
    const clock = formatWaitingClock(waitingElapsedMs(since, now));
    return (
      <span className="whitespace-nowrap font-medium tabular-nums" title="Клієнт чекає відповіді">
        {clock}
      </span>
    );
  }
  if (typeof row.replyAvgMinutes === "number") {
    // Середній час відповіді теж у гг:хх:сс.
    const clock = formatWaitingClock(Math.max(0, row.replyAvgMinutes) * 60_000);
    return <span className="tabular-nums">{clock}</span>;
  }
  return null;
}

function useConversationList(audience: Audience) {
  const [rows, setRows] = useState<MessageRow[]>([]);
  const [total, setTotal] = useState(0);
  const [waitingCount, setWaitingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (offset: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("audience", audience);
        params.set("offset", String(offset));
        params.set("limit", String(PAGE_SIZE));
        params.set("_t", String(Date.now()));
        const res = await fetch(`/api/admin/direct/messages?${params.toString()}`, {
          cache: "no-store",
          credentials: "include",
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Не вдалося завантажити переписки");
        }
        const next = (data.clients || []) as MessageRow[];
        setTotal(typeof data.total === "number" ? data.total : next.length);
        if (typeof data.waitingCount === "number") setWaitingCount(data.waitingCount);
        setRows((prev) => (append ? [...prev, ...next] : next));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Помилка завантаження");
        if (!append) {
          setRows([]);
          setWaitingCount(0);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [audience]
  );

  useEffect(() => {
    void load(0, false);
  }, [load]);

  // Поки сторінка відкрита — підтягуємо нові повідомлення, щоб картка піднімалась без F5.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void load(0, false);
    };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  return { rows, total, waitingCount, loading, loadingMore, error, load };
}

function ConversationTable({
  title,
  emptyText,
  rows,
  total,
  waitingCount,
  loading,
  loadingMore,
  error,
  onLoadMore,
  todayKyiv,
  onOpenMessages,
  onOpenAvatar,
  showClientMarks,
  showLeadBadge,
  now,
}: {
  title: string;
  emptyText: string;
  waitingCount: number;
  rows: MessageRow[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  onLoadMore: () => void;
  todayKyiv: string;
  onOpenMessages: (row: MessageRow) => void;
  onOpenAvatar: (avatar: { src: string; username: string }) => void;
  showClientMarks?: boolean;
  /** Синя крапка ліда, або зірка витрат якщо є сума в Altegio. */
  showLeadBadge?: boolean;
  now: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (el.scrollHeight <= el.clientHeight + 1) return;
      event.preventDefault();
      el.scrollTop += event.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  let todayBorderIndex = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (!isMessageToday(rows[i].lastMessageAt, todayKyiv)) break;
    todayBorderIndex = i;
  }
  const todayBlockContinues = todayBorderIndex === rows.length - 1 && rows.length < total;
  const borderIndex = todayBlockContinues ? -1 : todayBorderIndex;

  return (
    <section className="min-w-0">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1">
        <div className="inline-flex items-baseline gap-1">
          <h2 className="text-xs font-semibold leading-none">{title}</h2>
          <span className="text-[11px] tabular-nums text-gray-500">{total}</span>
        </div>
        <span className="text-[11px] leading-none text-gray-600" title="Розмови, де клієнт чекає відповіді">
          Очікують: <span className="tabular-nums font-semibold text-pink-600">{waitingCount}</span>
        </span>
      </div>
      {error ? (
        <div className="alert alert-error mb-1 py-1 text-sm">
          <span>{error}</span>
        </div>
      ) : null}
      <div className="card bg-base-100 shadow-sm">
        <div ref={scrollRef} className="card-body max-h-[calc(100vh-4.25rem)] overflow-y-auto overscroll-contain p-1">
          {loading ? (
            <div className="flex justify-center py-8">
              <span className="loading loading-spinner loading-md" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-gray-500">{emptyText}</p>
          ) : (
            <table className="table table-xs !w-max [&_th]:whitespace-nowrap [&_th]:py-0.5 [&_th]:text-[11px] [&_td]:whitespace-nowrap [&_td]:py-0.5 [&_td]:text-[11px] [&_td]:!overflow-visible">
              <thead className="sticky top-0 z-10 bg-base-100">
                <tr>
                  <th className="w-8 text-right">№</th>
                  <th className="w-8" />
                  <th>Ім&apos;я</th>
                  <th>Instagram</th>
                  <th className="text-center">Inst</th>
                  <th>Відповідь</th>
                  <th className="text-center">Стан</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c, index) => {
                  const username = (c.instagramUsername || "").replace(/^@/, "");
                  const avatarSrc = hasNormalInstagramUsername(c.instagramUsername)
                    ? `/api/admin/direct/instagram-avatar?username=${encodeURIComponent(username)}`
                    : null;
                  const totalMessages = typeof c.messagesTotal === "number" ? c.messagesTotal : 0;
                  const needs = Boolean(c.chatNeedsAttention);
                  const hasStatus = Boolean((c.chatStatusId || "").trim());
                  const waiting = Boolean(c.waitingSince);
                  // Очікує відповіді — пігулка Inst як кнопка «Очистити» у фільтрах Direct (pink-500).
                  const countClass = waiting
                    ? WAITING_INST_PILL_CLASS
                    : totalMessages === 0
                      ? "bg-gray-200 text-gray-900"
                      : needs || !hasStatus
                        ? "bg-[#2AABEE] text-white"
                        : "bg-gray-200 text-gray-900";
                  const showDot = isMessageToday(c.lastMessageAt, todayKyiv);
                  const cellStyle = index === borderIndex ? { boxShadow: TODAY_ROW_SEPARATOR } : undefined;
                  const lastAt = formatDateDDMMYY(c.lastMessageAt);
                  const usernameRaw = c.instagramUsername || "";
                  const invalidIg = usernameRaw.startsWith("missing_instagram_")
                    ? "missing"
                    : usernameRaw === "NO INSTAGRAM" || usernameRaw.startsWith("no_instagram_")
                      ? "NO"
                      : null;
                  return (
                    <tr key={c.id} title={waiting ? "Клієнт чекає відповіді" : undefined}>
                      <td className="w-8 text-right tabular-nums text-gray-400" style={cellStyle}>
                        {index + 1}
                      </td>
                      <td className="w-8" style={cellStyle}>
                        {avatarSrc ? (
                          <AvatarSlot
                            size="xs"
                            avatarSrc={avatarSrc}
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                            onClick={() => onOpenAvatar({ src: avatarSrc, username })}
                          />
                        ) : null}
                      </td>
                      <td style={cellStyle}>
                        <span className="inline-flex items-center gap-1">
                          {showClientMarks || showLeadBadge ? (
                            <ClientSpendBadge spent={c.spent} altegioClientId={c.altegioClientId} />
                          ) : null}
                          <span className="inline-flex flex-col items-start leading-none">
                            <Link
                              href={buildDirectClientHref(c.id, getClientName(c))}
                              className="link link-hover"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {getClientName(c)}
                              {showClientMarks && c.visits != null ? (
                                <span className="opacity-80">{` (${c.visits})`}</span>
                              ) : null}
                            </Link>
                            {showClientMarks && invalidIg ? (
                              <span className="text-[10px] font-semibold leading-none text-red-600">{invalidIg}</span>
                            ) : null}
                          </span>
                        </span>
                      </td>
                      <td style={cellStyle}>
                        {username ? (
                          <a
                            href={`https://instagram.com/${username}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="link link-primary"
                          >
                            @{username}
                          </a>
                        ) : (
                          <span>—</span>
                        )}
                      </td>
                      <td className="text-center" style={cellStyle}>
                        <span className="inline-flex flex-col items-center gap-0.5">
                          <WithCornerRedDot show={showDot} title="Тригер: нове повідомлення">
                            <button
                              type="button"
                              className={`inline-flex h-4 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[11px] tabular-nums leading-none ${countClass}`}
                              title={
                                lastAt !== "-"
                                  ? `Останнє повідомлення: ${lastAt}. Відкрити переписку`
                                  : "Відкрити переписку"
                              }
                              onClick={() => onOpenMessages(c)}
                            >
                              {totalMessages}
                            </button>
                          </WithCornerRedDot>
                          {lastAt !== "-" ? (
                            <span className="text-[10px] leading-none opacity-60" title={`Останнє повідомлення: ${lastAt}`}>
                              {lastAt}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td style={cellStyle}>
                        <ReplyTimeCell row={c} now={now} />
                      </td>
                      <td className="text-center !overflow-visible" style={cellStyle}>
                        <LeadSourceCloud
                          firstContactDate={c.firstContactDate}
                          leadAgency={c.leadAgency}
                          leadAdId={c.leadAdId}
                          sourceName={c.sourceName}
                          sourceMark={c.sourceMark}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!loading && rows.length < total ? (
            <div className="flex justify-center py-2">
              <button type="button" className="btn btn-ghost btn-xs" disabled={loadingMore} onClick={onLoadMore}>
                {loadingMore ? "Завантаження…" : "Завантажити ще"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default function DirectMessagesPage() {
  const clients = useConversationList("clients");
  const leads = useConversationList("leads");
  const [messagesClient, setMessagesClient] = useState<MessageRow | null>(null);
  const [fullscreenAvatar, setFullscreenAvatar] = useState<{ src: string; username: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const todayKyiv = kyivDayFromISO(new Date().toISOString());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="w-full max-w-full min-w-0 px-2 pb-2 pt-1">
      <div className="mb-1 flex flex-wrap items-center gap-1">
        <Link href="/admin/direct" className="btn btn-ghost btn-xs h-6 min-h-6 px-1.5 text-[10px]">
          ← Direct
        </Link>
        <h1 className="px-1 text-sm font-semibold leading-none">Переписки</h1>
        <Link
          href="/admin/direct/stats/consultations"
          className="btn btn-outline btn-xs ml-auto h-6 min-h-6 px-1.5 text-[10px]"
        >
          Ліди
        </Link>
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <ConversationTable
          title="Клієнти"
          showClientMarks
          emptyText="Клієнтів із перепискою немає."
          rows={clients.rows}
          total={clients.total}
          waitingCount={clients.waitingCount}
          loading={clients.loading}
          loadingMore={clients.loadingMore}
          error={clients.error}
          onLoadMore={() => void clients.load(clients.rows.length, true)}
          todayKyiv={todayKyiv}
          now={now}
          onOpenMessages={setMessagesClient}
          onOpenAvatar={setFullscreenAvatar}
        />
        <ConversationTable
          title="Ліди"
          showLeadBadge
          emptyText="Лідів без консультації немає."
          rows={leads.rows}
          total={leads.total}
          waitingCount={leads.waitingCount}
          loading={leads.loading}
          loadingMore={leads.loadingMore}
          error={leads.error}
          onLoadMore={() => void leads.load(leads.rows.length, true)}
          todayKyiv={todayKyiv}
          now={now}
          onOpenMessages={setMessagesClient}
          onOpenAvatar={setFullscreenAvatar}
        />
      </div>

      {fullscreenAvatar ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75"
          onClick={() => setFullscreenAvatar(null)}
        >
          <img
            src={fullscreenAvatar.src}
            alt={fullscreenAvatar.username}
            className="max-h-[90vh] max-w-[90vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
      <MessagesHistoryModal
        client={messagesClient as unknown as DirectClient | null}
        isOpen={messagesClient != null}
        channel="instagram"
        onClose={() => {
          setMessagesClient(null);
          // Після відповіді салону в історії — одразу оновити «Очікують» і пігулки.
          void clients.load(0, false);
          void leads.load(0, false);
        }}
      />
    </div>
  );
}

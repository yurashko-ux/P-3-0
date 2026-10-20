// Розділ «Переписки»: зліва клієнти, справа ліди. Джерело лише показується.

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { kyivDayFromISO } from "@/lib/altegio/records-grouping";
import { hasNormalInstagramUsername } from "@/lib/altegio/client-utils";
import type { DirectClient } from "@/lib/direct-types";
import { AvatarSlot, WithCornerRedDot } from "../_components/DirectClientTableAvatar";
import { formatDateDDMMYY } from "../_components/direct-client-table-formatters";
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
};

type Audience = "clients" | "leads";

const PAGE_SIZE = 40;
const TODAY_ROW_SEPARATOR = "inset 0 -3px 0 #d1d5db";

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

function LeadSourceMark({
  leadAgency,
  leadAdId,
  sourceName,
}: {
  leadAgency?: string | null;
  leadAdId?: string | null;
  sourceName?: string | null;
}) {
  if (leadAgency === "agency_1") {
    return (
      <span className="text-[13px] font-bold leading-none text-amber-600" title={sourceName || "Агенція 2"}>
        *
      </span>
    );
  }
  if (leadAgency === "agency_2") {
    return (
      <span className="text-[13px] leading-none text-rose-500" title={sourceName || "Агенція 1"}>
        ♥
      </span>
    );
  }
  if (!leadAgency && leadAdId) {
    return (
      <span
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-400 text-[8px] font-bold leading-none text-white"
        title="Оголошення без призначеного джерела"
      >
        ?
      </span>
    );
  }
  if (sourceName) {
    return (
      <span className="text-[10px] leading-none text-gray-600" title={sourceName}>
        {sourceName}
      </span>
    );
  }
  return null;
}

function useConversationList(audience: Audience) {
  const [rows, setRows] = useState<MessageRow[]>([]);
  const [total, setTotal] = useState(0);
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
        const res = await fetch(`/api/admin/direct/messages?${params.toString()}`, {
          cache: "no-store",
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Не вдалося завантажити переписки");
        }
        const next = (data.clients || []) as MessageRow[];
        setTotal(typeof data.total === "number" ? data.total : next.length);
        setRows((prev) => (append ? [...prev, ...next] : next));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Помилка завантаження");
        if (!append) setRows([]);
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

  return { rows, total, loading, loadingMore, error, load };
}

function ConversationTable({
  title,
  emptyText,
  rows,
  total,
  loading,
  loadingMore,
  error,
  onLoadMore,
  todayKyiv,
  onOpenMessages,
  onOpenAvatar,
}: {
  title: string;
  emptyText: string;
  rows: MessageRow[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  onLoadMore: () => void;
  todayKyiv: string;
  onOpenMessages: (row: MessageRow) => void;
  onOpenAvatar: (avatar: { src: string; username: string }) => void;
}) {
  let todayBorderIndex = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (!isMessageToday(rows[i].lastMessageAt, todayKyiv)) break;
    todayBorderIndex = i;
  }
  const todayBlockContinues = todayBorderIndex === rows.length - 1 && rows.length < total;
  const borderIndex = todayBlockContinues ? -1 : todayBorderIndex;

  return (
    <section className="min-w-0">
      <div className="mb-1 flex items-baseline gap-1 px-1">
        <h2 className="text-xs font-semibold leading-none">{title}</h2>
        <span className="text-[11px] tabular-nums text-gray-500">{total}</span>
      </div>
      {error ? (
        <div className="alert alert-error mb-1 py-1 text-sm">
          <span>{error}</span>
        </div>
      ) : null}
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-1">
          {loading ? (
            <div className="flex justify-center py-8">
              <span className="loading loading-spinner loading-md" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-gray-500">{emptyText}</p>
          ) : (
            <table className="table table-xs !w-max [&_th]:whitespace-nowrap [&_th]:py-0.5 [&_th]:text-[11px] [&_td]:whitespace-nowrap [&_td]:py-0.5 [&_td]:text-[11px]">
              <thead>
                <tr>
                  <th className="w-8" />
                  <th>Ім&apos;я</th>
                  <th>Instagram</th>
                  <th className="text-center">Inst</th>
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
                  const countClass =
                    totalMessages === 0
                      ? "bg-gray-200 text-gray-900"
                      : needs || !hasStatus
                        ? "bg-[#2AABEE] text-white"
                        : "bg-gray-200 text-gray-900";
                  const showDot = isMessageToday(c.lastMessageAt, todayKyiv);
                  const cellStyle = index === borderIndex ? { boxShadow: TODAY_ROW_SEPARATOR } : undefined;
                  const lastAt = formatDateDDMMYY(c.lastMessageAt);
                  return (
                    <tr key={c.id}>
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
                        <Link
                          href={buildDirectClientHref(c.id, getClientName(c))}
                          className="link link-hover"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {getClientName(c)}
                        </Link>
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
                      <td className="text-center" style={cellStyle}>
                        <LeadSourceMark leadAgency={c.leadAgency} leadAdId={c.leadAdId} sourceName={c.sourceName} />
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
  const todayKyiv = kyivDayFromISO(new Date().toISOString());

  return (
    <div className="w-full max-w-full min-w-0 px-2 pb-2 pt-1">
      <div className="mb-1 flex flex-wrap items-center gap-1">
        <Link href="/admin/direct" className="btn btn-ghost btn-xs h-6 min-h-6 px-1.5 text-[10px]">
          ← Direct
        </Link>
        <h1 className="px-1 text-sm font-semibold leading-none">Переписки</h1>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <ConversationTable
          title="Клієнти"
          emptyText="Клієнтів із перепискою немає."
          rows={clients.rows}
          total={clients.total}
          loading={clients.loading}
          loadingMore={clients.loadingMore}
          error={clients.error}
          onLoadMore={() => void clients.load(clients.rows.length, true)}
          todayKyiv={todayKyiv}
          onOpenMessages={setMessagesClient}
          onOpenAvatar={setFullscreenAvatar}
        />
        <ConversationTable
          title="Ліди"
          emptyText="Лідів без консультації немає."
          rows={leads.rows}
          total={leads.total}
          loading={leads.loading}
          loadingMore={leads.loadingMore}
          error={leads.error}
          onLoadMore={() => void leads.load(leads.rows.length, true)}
          todayKyiv={todayKyiv}
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
        onClose={() => setMessagesClient(null)}
      />
    </div>
  );
}

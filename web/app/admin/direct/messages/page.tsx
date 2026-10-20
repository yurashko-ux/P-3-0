// Розділ «Переписки»: ліди без консультації, нові повідомлення зверху.

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { kyivDayFromISO } from "@/lib/altegio/records-grouping";
import { hasNormalInstagramUsername } from "@/lib/altegio/client-utils";
import type { DirectClient } from "@/lib/direct-types";
import { AvatarSlot, WithCornerRedDot } from "../_components/DirectClientTableAvatar";
import { formatDateDDMMYY } from "../_components/direct-client-table-formatters";
import { LeadStateIcon } from "../_components/LeadStateIcon";
import { MessagesHistoryModal } from "../_components/MessagesHistoryModal";

type MessageLead = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  instagramUsername: string;
  firstContactDate: string;
  lastMessageAt?: string | null;
  messagesTotal?: number;
  chatNeedsAttention?: boolean;
  chatStatusId?: string | null;
};

const PAGE_SIZE = 40;
const TODAY_ROW_SEPARATOR = "inset 0 -3px 0 #d1d5db";

function getClientName(c: MessageLead): string {
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

export default function DirectMessagesPage() {
  const [clients, setClients] = useState<MessageLead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messagesClient, setMessagesClient] = useState<MessageLead | null>(null);
  const [fullscreenAvatar, setFullscreenAvatar] = useState<{ src: string; username: string } | null>(null);
  const todayKyiv = kyivDayFromISO(new Date().toISOString());

  const load = useCallback(async (offset: number, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
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
      const next = (data.clients || []) as MessageLead[];
      setTotal(typeof data.total === "number" ? data.total : next.length);
      setClients((prev) => (append ? [...prev, ...next] : next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка завантаження");
      if (!append) setClients([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load(0, false);
  }, [load]);

  let todayBorderIndex = -1;
  for (let i = 0; i < clients.length; i += 1) {
    if (!isMessageToday(clients[i].lastMessageAt, todayKyiv)) break;
    todayBorderIndex = i;
  }
  const todayBlockContinues = todayBorderIndex === clients.length - 1 && clients.length < total;
  const borderIndex = todayBlockContinues ? -1 : todayBorderIndex;

  return (
    <div className="w-full max-w-full px-2 pt-1 pb-2 min-w-0">
      <div className="flex flex-wrap items-center gap-1 mb-1">
        <Link href="/admin/direct" className="btn btn-ghost btn-xs min-h-6 h-6 px-1.5 text-[10px]">
          ← Direct
        </Link>
        <h1 className="text-sm font-semibold leading-none px-1">Переписки</h1>
        <span className="text-[11px] text-gray-500 tabular-nums">{total}</span>
      </div>

      {error && (
        <div className="alert alert-error mb-1 py-1 text-sm">
          <span>{error}</span>
        </div>
      )}

      <div className="card bg-base-100 shadow-sm">
        <div className="card-body p-1 overflow-x-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <span className="loading loading-spinner loading-md" />
            </div>
          ) : clients.length === 0 ? (
            <p className="text-center text-gray-500 py-6">Лідів без консультації немає.</p>
          ) : (
            <table className="table table-xs w-max [&_th]:py-0.5 [&_th]:text-[11px] [&_td]:py-0.5 [&_td]:text-[11px]">
              <thead>
                <tr>
                  <th className="w-8" />
                  <th>Ім&apos;я</th>
                  <th className="w-12 text-center">Inst</th>
                  <th className="w-10 text-center">Стан</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c, index) => {
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
                            onClick={() => setFullscreenAvatar({ src: avatarSrc, username })}
                          />
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap" style={cellStyle}>
                        <Link
                          href={buildDirectClientHref(c.id, getClientName(c))}
                          className="link link-hover"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {getClientName(c)}
                        </Link>
                      </td>
                      <td className="text-center" style={cellStyle}>
                        <WithCornerRedDot show={showDot} title="Тригер: нове повідомлення">
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
                            {totalMessages}
                          </button>
                        </WithCornerRedDot>
                      </td>
                      <td className="text-center" style={cellStyle}>
                        <LeadStateIcon
                          clientId={c.id}
                          firstContactDate={c.firstContactDate}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!loading && clients.length < total && (
            <div className="flex justify-center py-2">
              <button
                type="button"
                className="btn btn-xs btn-ghost"
                disabled={loadingMore}
                onClick={() => void load(clients.length, true)}
              >
                {loadingMore ? "Завантаження…" : "Завантажити ще"}
              </button>
            </div>
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
        client={messagesClient as unknown as DirectClient | null}
        isOpen={messagesClient != null}
        channel="instagram"
        onClose={() => setMessagesClient(null)}
      />
    </div>
  );
}

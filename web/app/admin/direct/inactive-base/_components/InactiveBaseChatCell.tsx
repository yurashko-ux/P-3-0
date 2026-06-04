"use client";

import { useState } from "react";
import type { DirectChatChannel } from "@/lib/direct-channel-chat";
import type { DirectClient } from "@/lib/direct-types";
import { isTechnicalDirectInstagramUsername } from "@/lib/altegio/client-utils";
import { getChatBadgeStyle } from "../../_components/ChatBadgeIcon";
import { formatDateDDMMYY } from "../../_components/direct-client-table-formatters";
import { MessagesHistoryModal } from "../../_components/MessagesHistoryModal";

export type InactiveBaseClientRow = {
  id: string;
  instagramUsername: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  daysSinceLastVisit?: number;
  chatStatusId?: string | null;
  messagesTotal?: number;
  chatNeedsAttention?: boolean;
  chatStatusName?: string | null;
  chatStatusBadgeKey?: string | null;
  lastMessageAt?: string | Date | null;
  telegramChatStatusId?: string | null;
  telegramMessagesTotal?: number;
  telegramChatNeedsAttention?: boolean;
  telegramChatStatusName?: string | null;
  telegramChatStatusBadgeKey?: string | null;
  telegramLastMessageAt?: string | Date | null;
  telegramChatId?: number | null;
  lastCampaign?: { name: string; at: string; campaignId?: string } | null;
};

type Props = {
  client: InactiveBaseClientRow;
  channel: DirectChatChannel;
};

function metaForChannel(client: InactiveBaseClientRow, channel: DirectChatChannel) {
  if (channel === "telegram") {
    return {
      total: client.telegramMessagesTotal ?? 0,
      needs: Boolean(client.telegramChatNeedsAttention),
      statusId: client.telegramChatStatusId,
      statusName: client.telegramChatStatusName,
      badgeKey: client.telegramChatStatusBadgeKey,
      lastAt: client.telegramLastMessageAt,
      statusIdField: "telegramChatStatusId" as const,
    };
  }
  return {
    total: client.messagesTotal ?? 0,
    needs: Boolean(client.chatNeedsAttention),
    statusId: client.chatStatusId,
    statusName: client.chatStatusName,
    badgeKey: client.chatStatusBadgeKey,
    lastAt: client.lastMessageAt,
    statusIdField: "chatStatusId" as const,
  };
}

export function InactiveBaseChatCell({ client, channel }: Props) {
  const [open, setOpen] = useState(false);
  const meta = metaForChannel(client, channel);
  const hideInstMessageCount =
    channel === "instagram" &&
    isTechnicalDirectInstagramUsername(client.instagramUsername.replace(/^@/, ""));
  const hasStatus = Boolean((meta.statusId || "").toString().trim());
  const statusNameRaw = (meta.statusName || "").toString().trim();
  const showStatus = Boolean(statusNameRaw) && hasStatus;
  const badgeCfg = getChatBadgeStyle((meta.badgeKey || "").toString().trim());

  const countClass =
    meta.total === 0
      ? "bg-gray-200 text-gray-900"
      : meta.needs || !hasStatus
        ? "bg-[#2AABEE] text-white"
        : "bg-gray-200 text-gray-900";

  const lastMessageDateStr = formatDateDDMMYY(
    meta.lastAt != null
      ? typeof meta.lastAt === "string"
        ? meta.lastAt
        : meta.lastAt.toISOString()
      : null
  );

  const directClient = {
    id: client.id,
    instagramUsername: client.instagramUsername,
    firstName: client.firstName,
    lastName: client.lastName,
    chatStatusId: meta.statusId,
    messagesTotal: meta.total,
    chatNeedsAttention: meta.needs,
    chatStatusName: meta.statusName,
    chatStatusBadgeKey: meta.badgeKey,
    lastMessageAt: meta.lastAt,
  } as DirectClient;

  return (
    <>
      <span className="flex flex-col items-start gap-0.5">
        <div className="flex items-center justify-start gap-2 min-w-0">
          {hideInstMessageCount ? (
            <span className="text-base-content/40 text-[12px]" title="Немає реального Instagram — лічильник не показуємо">
              —
            </span>
          ) : (
            <button
              type="button"
              className={`relative inline-flex items-center justify-center rounded-full px-2 py-0.5 tabular-nums hover:opacity-80 transition-opacity ${countClass} text-[12px] font-normal leading-none`}
              onClick={() => setOpen(true)}
              title={
                meta.needs
                  ? `Є нові повідомлення (${channel}) — відкрити історію`
                  : `Відкрити історію (${channel})`
              }
            >
              {meta.total}
            </button>
          )}
          {showStatus ? (
            <span
              className="inline-flex min-w-0 max-w-[80px] items-start rounded-full px-2 py-0.5 text-[11px] font-normal leading-[1.05]"
              title={statusNameRaw}
              style={{ backgroundColor: badgeCfg.bg, color: badgeCfg.fg }}
            >
              <span
                className="min-w-0 break-words overflow-hidden"
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {statusNameRaw}
              </span>
            </span>
          ) : null}
        </div>
        {lastMessageDateStr !== "-" ? (
          <span className="text-[10px] leading-none opacity-60" title={`Останнє: ${lastMessageDateStr}`}>
            {lastMessageDateStr}
          </span>
        ) : null}
      </span>
      <MessagesHistoryModal
        client={directClient}
        isOpen={open}
        onClose={() => setOpen(false)}
        channel={channel}
        onChatStatusUpdated={() => {
          window.dispatchEvent(new CustomEvent("inactive-base:reload-clients"));
        }}
      />
    </>
  );
}

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
  lastCampaign?: {
    name: string;
    at: string;
    campaignId?: string;
    channels?: string[];
    joinedAt?: string;
  } | null;
  campaignIncomingInstagram?: number;
  campaignIncomingTelegram?: number;
  campaignNeedsAttentionInstagram?: boolean;
  campaignNeedsAttentionTelegram?: boolean;
  campaignLastIncomingInstagram?: string | null;
  campaignLastIncomingTelegram?: string | null;
  telegramIncomingCount?: number;
  telegramOutgoingSystemCount?: number;
  telegramOutgoingManualCount?: number;
};

type Props = {
  client: InactiveBaseClientRow;
  channel: DirectChatChannel;
};

const PILL_BASE =
  "relative inline-flex items-center justify-center rounded-full px-1.5 py-0.5 tabular-nums hover:opacity-80 transition-opacity text-[11px] font-normal leading-none min-w-[1.25rem]";

function pillClass(count: number, activeClass: string): string {
  return count === 0 ? `${PILL_BASE} bg-gray-200 text-gray-900` : `${PILL_BASE} ${activeClass}`;
}

function campaignUsesChannel(client: InactiveBaseClientRow, channel: DirectChatChannel): boolean {
  const ch = client.lastCampaign?.channels;
  if (!ch?.length) return true;
  return ch.includes(channel);
}

function metaForChannel(client: InactiveBaseClientRow, channel: DirectChatChannel) {
  const inCampaign = Boolean(client.lastCampaign?.joinedAt);
  const useCampaignStats = inCampaign && campaignUsesChannel(client, channel);

  if (channel === "telegram") {
    return {
      useCampaignStats,
      total: useCampaignStats
        ? (client.campaignIncomingTelegram ?? 0)
        : (client.telegramMessagesTotal ?? 0),
      needs: useCampaignStats
        ? Boolean(client.campaignNeedsAttentionTelegram)
        : Boolean(client.telegramChatNeedsAttention),
      statusId: client.telegramChatStatusId,
      statusName: client.telegramChatStatusName,
      badgeKey: client.telegramChatStatusBadgeKey,
      lastAt: useCampaignStats
        ? client.campaignLastIncomingTelegram
        : client.telegramLastMessageAt,
      statusIdField: "telegramChatStatusId" as const,
      hidden: inCampaign && !campaignUsesChannel(client, channel),
      incomingCount: client.telegramIncomingCount ?? 0,
      outgoingSystemCount: client.telegramOutgoingSystemCount ?? 0,
      outgoingManualCount: client.telegramOutgoingManualCount ?? 0,
    };
  }
  return {
    useCampaignStats,
    total: useCampaignStats ? (client.campaignIncomingInstagram ?? 0) : (client.messagesTotal ?? 0),
    needs: useCampaignStats
      ? Boolean(client.campaignNeedsAttentionInstagram)
      : Boolean(client.chatNeedsAttention),
    statusId: client.chatStatusId,
    statusName: client.chatStatusName,
    badgeKey: client.chatStatusBadgeKey,
    lastAt: useCampaignStats ? client.campaignLastIncomingInstagram : client.lastMessageAt,
    statusIdField: "chatStatusId" as const,
    hidden: inCampaign && !campaignUsesChannel(client, channel),
    incomingCount: 0,
    outgoingSystemCount: 0,
    outgoingManualCount: 0,
  };
}

export function InactiveBaseChatCell({ client, channel }: Props) {
  const [open, setOpen] = useState(false);
  const meta = metaForChannel(client, channel);
  const hideInstMessageCount =
    meta.hidden ||
    (channel === "instagram" &&
      isTechnicalDirectInstagramUsername(client.instagramUsername.replace(/^@/, "")));
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

  const scopeHint = meta.useCampaignStats ? "після join кампанії" : "за весь час";

  const directClient = {
    id: client.id,
    instagramUsername: client.instagramUsername,
    firstName: client.firstName,
    lastName: client.lastName,
    chatStatusId: meta.statusId,
    messagesTotal:
      channel === "telegram"
        ? meta.incomingCount + meta.outgoingSystemCount + meta.outgoingManualCount
        : meta.total,
    chatNeedsAttention: meta.needs,
    chatStatusName: meta.statusName,
    chatStatusBadgeKey: meta.badgeKey,
    lastMessageAt: meta.lastAt,
  } as DirectClient;

  const openHistory = () => setOpen(true);

  return (
    <>
      <span className="flex flex-col items-start gap-0.5">
        <div className="flex items-center justify-start gap-1.5 min-w-0">
          {hideInstMessageCount ? (
            <span
              className="text-base-content/40 text-[12px]"
              title={
                meta.hidden
                  ? "Канал не використовується в кампанії клієнта"
                  : "Немає реального Instagram — лічильник не показуємо"
              }
            >
              —
            </span>
          ) : channel === "telegram" ? (
            <span className="flex items-center gap-0.5">
              <button
                type="button"
                className={pillClass(meta.incomingCount, "bg-orange-500 text-white")}
                onClick={openHistory}
                title={`Вхідні (${scopeHint}): ${meta.incomingCount}`}
              >
                {meta.incomingCount}
              </button>
              <button
                type="button"
                className={pillClass(meta.outgoingSystemCount, "bg-[#2AABEE] text-white")}
                onClick={openHistory}
                title={`Системні вихідні (${scopeHint}): ${meta.outgoingSystemCount}`}
              >
                {meta.outgoingSystemCount}
              </button>
              <button
                type="button"
                className={pillClass(meta.outgoingManualCount, "bg-lime-500 text-white")}
                onClick={openHistory}
                title={`Ручні вихідні (${scopeHint}): ${meta.outgoingManualCount}`}
              >
                {meta.outgoingManualCount}
              </button>
            </span>
          ) : (
            <button
              type="button"
              className={`relative inline-flex items-center justify-center rounded-full px-2 py-0.5 tabular-nums hover:opacity-80 transition-opacity ${countClass} text-[12px] font-normal leading-none`}
              onClick={openHistory}
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
        key={`${client.id}-${channel}-history`}
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

"use client";

import { useState } from "react";
import type { DirectChatChannel } from "@/lib/direct-channel-chat";
import type { DirectClient } from "@/lib/direct-types";
import { isTechnicalDirectInstagramUsername } from "@/lib/altegio/client-utils";
import { formatDateDDMMYY } from "../../_components/direct-client-table-formatters";
import { MessagesHistoryModal } from "../../_components/MessagesHistoryModal";
import {
  InactiveBaseInstagramCounterPills,
  type InstagramMessageCounts,
} from "./InactiveBaseInstagramCounterPills";
import {
  InactiveBaseTelegramCounterPills,
  type TelegramActiveClientCounts,
} from "./InactiveBaseTelegramCounterPills";

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
    createdAt?: string;
    joinedAt?: string;
  } | null;
  campaignIncomingInstagram?: number;
  campaignIncomingTelegram?: number;
  campaignNeedsAttentionInstagram?: boolean;
  campaignNeedsAttentionTelegram?: boolean;
  campaignLastIncomingInstagram?: string | null;
  campaignLastIncomingTelegram?: string | null;
  campaignLastTelegramAt?: string | null;
  telegramIncomingCount?: number;
  telegramOutgoingSystemCount?: number;
  telegramOutgoingManualCount?: number;
  instagramIncomingCount?: number;
  instagramOutgoingCount?: number;
  campaignOutgoingInstagram?: number;
  callStatusId?: string | null;
  callStatusName?: string | null;
  callStatusBadgeKey?: string | null;
  binotelCallsCount?: number;
  binotelLatestCallRecordingUrl?: string | null;
  binotelLatestCallGeneralID?: string | null;
  binotelLatestCallType?: string | null;
  binotelLatestCallDisposition?: string | null;
  binotelLatestCallStartTime?: string | null;
  campaignHasTrackableLink?: boolean;
  campaignLinkClicked?: boolean;
  campaignLinkClickedInCurrentCampaign?: boolean;
  campaignLinkClickedAt?: string | null;
  campaignLinkClickCount?: number;
};

/** Агрегат для згорнутої групи кампанії: кількість клієнтів з активністю, не повідомлень. */
export type GroupTelegramActiveClientCounts = TelegramActiveClientCounts;
export type GroupInstagramActiveClientCounts = InstagramMessageCounts;

type Props = {
  client: InactiveBaseClientRow;
  channel: DirectChatChannel;
  /** Згорнута група кампанії — показати кількість активних клієнтів у групі. */
  groupTelegramStats?: GroupTelegramActiveClientCounts | null;
  groupInstagramStats?: GroupInstagramActiveClientCounts | null;
};

function campaignUsesChannel(client: InactiveBaseClientRow, channel: DirectChatChannel): boolean {
  const ch = client.lastCampaign?.channels;
  if (!ch?.length) return true;
  return ch.includes(channel);
}

function getInstagramCounts(client: InactiveBaseClientRow): InstagramMessageCounts {
  const inCampaign = Boolean(client.lastCampaign?.joinedAt);
  const useCampaignStats = inCampaign && campaignUsesChannel(client, "instagram");
  if (useCampaignStats) {
    return {
      incomingCount: client.campaignIncomingInstagram ?? 0,
      outgoingCount: client.campaignOutgoingInstagram ?? 0,
    };
  }
  return {
    incomingCount: client.instagramIncomingCount ?? 0,
    outgoingCount: client.instagramOutgoingCount ?? 0,
  };
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
        ? client.campaignLastTelegramAt ?? client.campaignLastIncomingTelegram
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

export function InactiveBaseChatCell({
  client,
  channel,
  groupTelegramStats,
  groupInstagramStats,
}: Props) {
  const [open, setOpen] = useState(false);
  const meta = metaForChannel(client, channel);
  const isGroupTelegramSummary = channel === "telegram" && groupTelegramStats != null;
  const isGroupInstagramSummary = channel === "instagram" && groupInstagramStats != null;
  const telegramCounts = isGroupTelegramSummary
    ? groupTelegramStats
    : {
        outgoingManualCount: meta.outgoingManualCount,
        outgoingSystemCount: meta.outgoingSystemCount,
        incomingCount: meta.incomingCount,
      };
  const hideInstMessageCount =
    !isGroupInstagramSummary &&
    (meta.hidden ||
      (channel === "instagram" &&
        isTechnicalDirectInstagramUsername(client.instagramUsername.replace(/^@/, ""))));
  const instagramCounts = isGroupInstagramSummary
    ? groupInstagramStats
    : channel === "instagram"
      ? getInstagramCounts(client)
      : { incomingCount: 0, outgoingCount: 0 };

  const lastMessageDateStr = formatDateDDMMYY(
    meta.lastAt != null
      ? typeof meta.lastAt === "string"
        ? meta.lastAt
        : meta.lastAt.toISOString()
      : null
  );

  const scopeHint = isGroupTelegramSummary
    ? "клієнтів у групі"
    : meta.useCampaignStats
      ? "після join кампанії"
      : "за весь час";

  const instagramScopeHint = isGroupInstagramSummary
    ? "клієнтів у групі"
    : Boolean(client.lastCampaign?.joinedAt) && campaignUsesChannel(client, "instagram")
      ? "після join кампанії"
      : "за весь час";

  const directClient = {
    id: client.id,
    instagramUsername: client.instagramUsername,
    firstName: client.firstName,
    lastName: client.lastName,
    chatStatusId: client.chatStatusId ?? null,
    chatStatusName: client.chatStatusName ?? null,
    chatStatusBadgeKey: client.chatStatusBadgeKey ?? null,
    chatNeedsAttention: client.chatNeedsAttention ?? false,
    telegramChatStatusId: client.telegramChatStatusId ?? null,
    telegramChatStatusName: client.telegramChatStatusName ?? null,
    telegramChatStatusBadgeKey: client.telegramChatStatusBadgeKey ?? null,
    telegramChatNeedsAttention: client.telegramChatNeedsAttention ?? false,
    messagesTotal:
      channel === "telegram"
        ? meta.incomingCount + meta.outgoingSystemCount + meta.outgoingManualCount
        : instagramCounts.incomingCount + instagramCounts.outgoingCount,
    lastMessageAt: meta.lastAt,
  } as unknown as DirectClient;

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
            <InactiveBaseTelegramCounterPills
              counts={telegramCounts}
              scopeHint={scopeHint}
              interactive={!isGroupTelegramSummary}
              onPillClick={openHistory}
            />
          ) : (
            <InactiveBaseInstagramCounterPills
              counts={instagramCounts}
              scopeHint={instagramScopeHint}
              interactive={!isGroupInstagramSummary}
              onPillClick={openHistory}
            />
          )}
        </div>
        {!isGroupTelegramSummary && !isGroupInstagramSummary && lastMessageDateStr !== "-" ? (
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

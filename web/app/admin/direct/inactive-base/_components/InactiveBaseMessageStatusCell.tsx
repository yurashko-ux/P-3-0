"use client";

import type { DirectChatChannel } from "@/lib/direct-channel-chat";
import { ChatBadgeIcon } from "../../_components/ChatBadgeIcon";
import type { InactiveBaseClientRow } from "./InactiveBaseChatCell";

type Props = {
  client: InactiveBaseClientRow;
  channel: DirectChatChannel;
  /** Згорнута група кампанії — статус не показуємо. */
  hidden?: boolean;
};

function campaignUsesChannel(client: InactiveBaseClientRow, channel: DirectChatChannel): boolean {
  const ch = client.lastCampaign?.channels;
  if (!ch?.length) return true;
  return ch.includes(channel);
}

function statusForChannel(
  client: InactiveBaseClientRow,
  channel: DirectChatChannel
): { statusId: string; statusName: string; badgeKey: string } | null {
  if (!campaignUsesChannel(client, channel)) return null;

  if (channel === "telegram") {
    const statusId = (client.telegramChatStatusId || "").toString().trim();
    const statusName = (client.telegramChatStatusName || "").toString().trim();
    const badgeKey = (client.telegramChatStatusBadgeKey || "").toString().trim();
    if (statusId && statusName) return { statusId, statusName, badgeKey };
    return null;
  }

  const statusId = (client.chatStatusId || "").toString().trim();
  const statusName = (client.chatStatusName || "").toString().trim();
  const badgeKey = (client.chatStatusBadgeKey || "").toString().trim();
  if (statusId && statusName) return { statusId, statusName, badgeKey };
  return null;
}

/** Статус переписки одного каналу, обраний в історії повідомлень. */
export function InactiveBaseMessageStatusCell({ client, channel, hidden }: Props) {
  if (hidden) return null;

  const item = statusForChannel(client, channel);
  if (!item) return null;

  const channelLabel = channel === "telegram" ? "Telegram" : "Instagram";

  return (
    <div
      className="inline-flex items-center gap-1 min-w-0 max-w-[140px]"
      title={`${channelLabel}: ${item.statusName}`}
    >
      <ChatBadgeIcon badgeKey={item.badgeKey} size={14} title={item.statusName} />
      <span className="text-[11px] leading-tight min-w-0 truncate" style={{ maxWidth: "8.5rem" }}>
        {item.statusName}
      </span>
    </div>
  );
}

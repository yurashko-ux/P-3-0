"use client";

import type { DirectChatChannel } from "@/lib/direct-channel-chat";
import { ChatBadgeIcon } from "../../_components/ChatBadgeIcon";
import type { InactiveBaseClientRow } from "./InactiveBaseChatCell";

type Props = {
  client: InactiveBaseClientRow;
  /** Згорнута група кампанії — статус не показуємо. */
  hidden?: boolean;
};

function campaignUsesChannel(client: InactiveBaseClientRow, channel: DirectChatChannel): boolean {
  const ch = client.lastCampaign?.channels;
  if (!ch?.length) return true;
  return ch.includes(channel);
}

type StatusItem = {
  channel: DirectChatChannel;
  label: string;
  statusId: string;
  statusName: string;
  badgeKey: string;
};

function statusItemsForClient(client: InactiveBaseClientRow): StatusItem[] {
  const items: StatusItem[] = [];

  if (campaignUsesChannel(client, "telegram")) {
    const statusId = (client.telegramChatStatusId || "").toString().trim();
    const statusName = (client.telegramChatStatusName || "").toString().trim();
    const badgeKey = (client.telegramChatStatusBadgeKey || "").toString().trim();
    if (statusId && statusName) {
      items.push({ channel: "telegram", label: "TG", statusId, statusName, badgeKey });
    }
  }

  if (campaignUsesChannel(client, "instagram")) {
    const statusId = (client.chatStatusId || "").toString().trim();
    const statusName = (client.chatStatusName || "").toString().trim();
    const badgeKey = (client.chatStatusBadgeKey || "").toString().trim();
    if (statusId && statusName) {
      items.push({ channel: "instagram", label: "Inst", statusId, statusName, badgeKey });
    }
  }

  return items;
}

/** Статуси переписки, обрані в історії повідомлень (Inst / Telegram). */
export function InactiveBaseMessageStatusCell({ client, hidden }: Props) {
  if (hidden) return null;

  const items = statusItemsForClient(client);
  if (items.length === 0) return null;

  const showChannelLabel = items.length > 1;

  return (
    <div className="flex flex-col items-start gap-1 min-w-0 max-w-[140px]">
      {items.map((item) => (
        <div
          key={item.channel}
          className="inline-flex items-center gap-1 min-w-0 max-w-full"
          title={`${item.channel === "telegram" ? "Telegram" : "Instagram"}: ${item.statusName}`}
        >
          {showChannelLabel ? (
            <span className="text-[9px] text-base-content/50 shrink-0 w-6">{item.label}</span>
          ) : null}
          <ChatBadgeIcon badgeKey={item.badgeKey} size={14} title={item.statusName} />
          <span
            className="text-[11px] leading-tight min-w-0 truncate"
            style={{ maxWidth: showChannelLabel ? "7rem" : "8.5rem" }}
          >
            {item.statusName}
          </span>
        </div>
      ))}
    </div>
  );
}

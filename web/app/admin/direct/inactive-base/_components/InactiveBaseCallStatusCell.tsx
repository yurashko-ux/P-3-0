"use client";

import { ChatBadgeIcon } from "../../_components/ChatBadgeIcon";
import type { InactiveBaseClientRow } from "./InactiveBaseChatCell";

type Props = {
  client: InactiveBaseClientRow;
  /** Згорнута група кампанії — статус не показуємо. */
  hidden?: boolean;
};

/** Статус дзвінків, обраний у вікні історії дзвінків. */
export function InactiveBaseCallStatusCell({ client, hidden }: Props) {
  if (hidden) return null;

  const statusName = (client.callStatusName || "").toString().trim();
  const badgeKey = (client.callStatusBadgeKey || "").toString().trim();
  if (!statusName) return null;

  return (
    <div className="inline-flex items-center gap-1 min-w-0 max-w-[140px]" title={`Статус дзвінків: ${statusName}`}>
      <ChatBadgeIcon badgeKey={badgeKey || "badge_1"} size={14} title={statusName} />
      <span className="text-[11px] leading-tight min-w-0 truncate" style={{ maxWidth: "8.5rem" }}>
        {statusName}
      </span>
    </div>
  );
}

// web/lib/direct-channel-chat.ts
// Канали переписки Direct: Instagram (ManyChat) та Telegram (business).

export type DirectChatChannel = 'instagram' | 'telegram';

/** Системні вихідні з розсилки кампанії неактивної бази. */
export const TELEGRAM_CAMPAIGN_SOURCE = 'telegram_campaign';

export const DIRECT_MESSAGE_SOURCES_BY_CHANNEL: Record<DirectChatChannel, readonly string[]> = {
  instagram: ['manychat', 'instagram_graph', 'manual'],
  telegram: ['telegram', TELEGRAM_CAMPAIGN_SOURCE],
};

export function isSourceForChannel(source: string | null | undefined, channel: DirectChatChannel): boolean {
  const s = (source || 'manychat').trim().toLowerCase();
  if (channel === 'telegram') {
    return s === 'telegram' || s === TELEGRAM_CAMPAIGN_SOURCE;
  }
  return DIRECT_MESSAGE_SOURCES_BY_CHANNEL.instagram.includes(s);
}

export function isTelegramCampaignSource(source: string | null | undefined): boolean {
  return (source || '').trim().toLowerCase() === TELEGRAM_CAMPAIGN_SOURCE;
}

/** Поля статусу переписки на DirectClient за каналом. */
export type ChannelChatStatusFieldMap = {
  statusId: 'chatStatusId' | 'telegramChatStatusId';
  setAt: 'chatStatusSetAt' | 'telegramChatStatusSetAt';
  checkedAt: 'chatStatusCheckedAt' | 'telegramChatStatusCheckedAt';
  anchorMessageId: 'chatStatusAnchorMessageId' | 'telegramChatStatusAnchorMessageId';
  anchorMessageReceivedAt: 'chatStatusAnchorMessageReceivedAt' | 'telegramChatStatusAnchorMessageReceivedAt';
  anchorSetAt: 'chatStatusAnchorSetAt' | 'telegramChatStatusAnchorSetAt';
};

export const CHANNEL_CHAT_STATUS_FIELDS: Record<DirectChatChannel, ChannelChatStatusFieldMap> = {
  instagram: {
    statusId: 'chatStatusId',
    setAt: 'chatStatusSetAt',
    checkedAt: 'chatStatusCheckedAt',
    anchorMessageId: 'chatStatusAnchorMessageId',
    anchorMessageReceivedAt: 'chatStatusAnchorMessageReceivedAt',
    anchorSetAt: 'chatStatusAnchorSetAt',
  },
  telegram: {
    statusId: 'telegramChatStatusId',
    setAt: 'telegramChatStatusSetAt',
    checkedAt: 'telegramChatStatusCheckedAt',
    anchorMessageId: 'telegramChatStatusAnchorMessageId',
    anchorMessageReceivedAt: 'telegramChatStatusAnchorMessageReceivedAt',
    anchorSetAt: 'telegramChatStatusAnchorSetAt',
  },
};

export function sourcesWhereClause(channel: DirectChatChannel) {
  return { source: { in: [...DIRECT_MESSAGE_SOURCES_BY_CHANNEL[channel]] } };
}

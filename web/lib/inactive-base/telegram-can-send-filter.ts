// Фільтр «можна слати в Telegram» для неактивної бази (за telegramChatId).

export type TelegramCanSendFilterValue = 'can' | 'cannot';

export type TelegramCanSendCounts = { can: number; cannot: number };

export function parseTelegramCanSendFilter(raw: string | null): TelegramCanSendFilterValue[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((x) => x.trim())
    .filter((x): x is TelegramCanSendFilterValue => x === 'can' || x === 'cannot');
}

export function clientCanReceiveTelegramSystemMessage(client: {
  telegramChatId?: bigint | number | null;
}): boolean {
  return client.telegramChatId != null;
}

export function computeTelegramCanSendCounts<T extends { telegramChatId?: bigint | number | null }>(
  clients: T[]
): TelegramCanSendCounts {
  let can = 0;
  for (const c of clients) {
    if (clientCanReceiveTelegramSystemMessage(c)) can++;
  }
  return { can, cannot: clients.length - can };
}

export function filterByTelegramCanSend<T extends { telegramChatId?: bigint | number | null }>(
  clients: T[],
  values: TelegramCanSendFilterValue[]
): T[] {
  if (!values.length) return clients;
  const set = new Set(values);
  return clients.filter((c) => {
    const can = clientCanReceiveTelegramSystemMessage(c);
    return (can && set.has('can')) || (!can && set.has('cannot'));
  });
}

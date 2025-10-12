// web/lib/manychat-store.ts
// Спільне сховище для останнього ManyChat-повідомлення й трасування вебхука.

import { kvWrite } from '@/lib/kv';

export type ManychatStoredMessage = {
  id: number | string;
  receivedAt: number;
  source: string;
  title: string;
  handle: string | null;
  fullName: string | null;
  text: string;
  raw: unknown;
};

export type ManychatWebhookTrace = {
  receivedAt: number;
  status: 'accepted' | 'rejected';
  reason?: string | null;
  statusCode?: number | null;
  handle?: string | null;
  fullName?: string | null;
  messagePreview?: string | null;
};

export const MANYCHAT_MESSAGE_KEY = 'manychat:last-message';
export const MANYCHAT_TRACE_KEY = 'manychat:last-trace';

export async function persistManychatSnapshot(
  message: ManychatStoredMessage,
  trace: ManychatWebhookTrace | null = null,
): Promise<void> {
  await kvWrite.setRaw(MANYCHAT_MESSAGE_KEY, JSON.stringify(message));
  if (trace) {
    await kvWrite.setRaw(MANYCHAT_TRACE_KEY, JSON.stringify(trace));
  }
}

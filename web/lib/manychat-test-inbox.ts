// web/lib/manychat-test-inbox.ts
// Lightweight in-memory inbox for visualising ManyChat webhook traffic on the
// admin test page. This intentionally keeps the storage inside the running
// process so preview deployments and local development behave the same way.

export type ManychatInboxMessage = {
  id: string;
  username: string | null;
  handle: string | null;
  fullName: string | null;
  text: string;
  receivedAt: string;
  raw: unknown;
  source?: string | null;
  title?: string | null;
};

type ManychatInboxState = {
  messages: ManychatInboxMessage[];
};

const globalInbox = globalThis as typeof globalThis & {
  __manychatTestInbox?: ManychatInboxState;
};

function getState(): ManychatInboxState {
  if (!globalInbox.__manychatTestInbox) {
    globalInbox.__manychatTestInbox = { messages: [] };
  }
  return globalInbox.__manychatTestInbox;
}

export function listManychatMessages(): ManychatInboxMessage[] {
  return getState().messages;
}

type RecordOptions = {
  username?: string | null;
  handle?: string | null;
  fullName?: string | null;
  text?: string | null;
  raw?: unknown;
  source?: string | null;
  title?: string | null;
};

export function recordManychatMessage(options: RecordOptions): ManychatInboxMessage {
  const now = new Date();
  const message: ManychatInboxMessage = {
    id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    username: options.username ?? null,
    handle: options.handle ?? null,
    fullName: options.fullName ?? null,
    text: (options.text ?? "").trim() || "[без тексту]",
    receivedAt: now.toISOString(),
    raw: options.raw,
    source: options.source ?? null,
    title: options.title ?? null,
  };

  const { messages } = getState();
  messages.unshift(message);
  if (messages.length > 100) {
    messages.length = 100;
  }

  return message;
}

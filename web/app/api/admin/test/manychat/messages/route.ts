import { NextResponse } from "next/server";

export type ManychatTestMessage = {
  id: string;
  username: string | null;
  fullName: string | null;
  text: string;
  receivedAt: string;
  raw: unknown;
};

type PostBody = {
  message?: {
    username?: unknown;
    full_name?: unknown;
    text?: unknown;
  };
};

const globalAny = globalThis as typeof globalThis & {
  __manychatTestInbox?: ManychatTestMessage[];
};

function getInbox(): ManychatTestMessage[] {
  if (!globalAny.__manychatTestInbox) {
    globalAny.__manychatTestInbox = [];
  }
  return globalAny.__manychatTestInbox;
}

export async function GET() {
  const inbox = getInbox();
  return NextResponse.json({ ok: true, items: inbox });
}

export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "invalid_json", message: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const payload = body?.message;
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!text) {
    return NextResponse.json(
      { ok: false, error: "text_required", message: "Поле text є обов'язковим" },
      { status: 400 },
    );
  }

  const username = typeof payload?.username === "string" ? payload.username.trim() : null;
  const fullName = typeof payload?.full_name === "string" ? payload.full_name.trim() : null;

  const message: ManychatTestMessage = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    username,
    fullName,
    text,
    receivedAt: new Date().toISOString(),
    raw: body,
  };

  const inbox = getInbox();
  inbox.unshift(message);
  if (inbox.length > 50) {
    inbox.length = 50;
  }

  return NextResponse.json({ ok: true, message });
}

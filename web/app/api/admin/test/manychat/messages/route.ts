import { NextResponse } from "next/server";

import { normalizeManyChat } from "@/lib/ingest";
import {
  listManychatMessages,
  recordManychatMessage,
  type ManychatInboxMessage,
} from "@/lib/manychat-test-inbox";

export async function GET() {
  const inbox = listManychatMessages();
  return NextResponse.json({ ok: true, items: inbox });
}

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "invalid_json", message: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const message =
    body?.message ??
    body?.event?.data ??
    body?.event ??
    body?.data ??
    body;

  const normalized = normalizeManyChat({
    username:
      message?.username ??
      message?.subscriber?.username ??
      message?.user?.username ??
      message?.handle ??
      body?.username ??
      body?.handle ??
      null,
    text:
      message?.text ??
      message?.message?.text ??
      message?.data?.text ??
      message?.message ??
      message?.content ??
      body?.text ??
      null,
    full_name:
      message?.full_name ??
      message?.name ??
      message?.subscriber?.name ??
      message?.user?.full_name ??
      body?.full_name ??
      body?.name ??
      null,
    first_name:
      message?.first_name ??
      message?.subscriber?.first_name ??
      message?.user?.first_name ??
      body?.first_name ??
      null,
    last_name:
      message?.last_name ??
      message?.subscriber?.last_name ??
      message?.user?.last_name ??
      body?.last_name ??
      null,
  });

  const text = normalized.text || "";
  const username = normalized.handleRaw || null;
  const handle = normalized.handle || null;
  const fullName = normalized.fullName || null;

  const messageText = text.trim() || "[без тексту]";

  const record: ManychatInboxMessage = recordManychatMessage({
    username,
    handle,
    fullName,
    text: messageText,
    raw: body,
    source: "test:manual",
  });

  return NextResponse.json({ ok: true, message: record });
}

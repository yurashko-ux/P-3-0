// web/app/api/mc/manychat/route.ts
// ManyChat webhook handler (IG). Migrated to kvRead/kvWrite + LIST index.
// Keeps behavior minimal: normalize payload, read active campaigns, compute rule matches,
// and return a diagnostic response (routing to KeyCRM is done by /api/keycrm/sync/pair).

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite, campaignKeys } from '@/lib/kv';

type LatestMessage = {
  id: number;
  receivedAt: number;
  source: string;
  title: string;
  handle: string | null;
  fullName: string | null;
  text: string;
  raw: unknown;
};

const MANYCHAT_LATEST_KEY = 'manychat:latest';

let lastMessage: LatestMessage | null = null;
let messageCounter = 0;

function coerceString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const num = Number(value.trim());
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function coerceLatestMessage(input: unknown): LatestMessage | null {
  if (!input) return null;

  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return coerceLatestMessage(parsed);
    } catch {
      return null;
    }
  }

  if (typeof input !== 'object') return null;

  const obj: any = input;

  if (obj.latest && typeof obj.latest === 'object') {
    const nested = coerceLatestMessage(obj.latest);
    if (nested) return nested;
  }

  const raw: unknown = obj.raw ?? obj;
  const candidateHandle =
    coerceString(obj.handle) ||
    coerceString(obj.username) ||
    coerceString(obj.subscriber?.username) ||
    coerceString(obj.user?.username) ||
    coerceString(obj.sender?.username) ||
    coerceString(obj.normalized?.handle) ||
    coerceString(obj.raw?.subscriber?.username) ||
    coerceString(obj.raw?.user?.username) ||
    coerceString(obj.raw?.sender?.username) ||
    null;

  const candidateFullName =
    coerceString(obj.fullName) ||
    coerceString(obj.full_name) ||
    coerceString(obj.name) ||
    coerceString(obj.normalized?.fullName) ||
    coerceString(obj.normalized?.full_name) ||
    coerceString(obj.subscriber?.name) ||
    coerceString(obj.user?.full_name) ||
    coerceString(obj.sender?.name) ||
    coerceString(obj.raw?.subscriber?.name) ||
    coerceString(obj.raw?.user?.full_name) ||
    coerceString(obj.raw?.sender?.name) ||
    null;

  const candidateText =
    coerceString(obj.text) ||
    coerceString(obj.normalized?.text) ||
    coerceString(obj.message?.text) ||
    coerceString(obj.data?.text) ||
    coerceString(obj.message) ||
    coerceString(obj.raw?.message?.text) ||
    coerceString(obj.raw?.data?.text) ||
    coerceString(obj.raw?.message) ||
    '';

  const candidateTitle =
    coerceString(obj.title) ||
    coerceString(obj.normalized?.title) ||
    coerceString(obj.source) ||
    'IG Message';

  const idCandidate =
    coerceNumber(obj.id) ??
    coerceNumber(obj.message_id) ??
    coerceNumber(obj.messageId) ??
    coerceNumber(obj.receivedAt) ??
    coerceNumber(obj.timestamp) ??
    coerceNumber(obj.ts) ??
    coerceNumber(obj.raw?.id);

  const receivedCandidate =
    coerceNumber(obj.receivedAt) ??
    coerceNumber(obj.timestamp) ??
    coerceNumber(obj.ts) ??
    coerceNumber(obj.created_at) ??
    coerceNumber(obj.raw?.receivedAt) ??
    coerceNumber(obj.raw?.timestamp) ??
    coerceNumber(obj.raw?.ts);

  const id = idCandidate ?? Date.now();
  const receivedAt = receivedCandidate ?? Date.now();

  return {
    id,
    receivedAt,
    source: coerceString(obj.source) ?? 'manychat',
    title: candidateTitle ?? 'IG Message',
    handle: candidateHandle,
    fullName: candidateFullName,
    text: candidateText ?? '',
    raw,
  };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Rule = { op: 'contains' | 'equals'; value: string };
type Campaign = {
  id: string;
  name: string;
  created_at: number;
  active?: boolean;
  base_pipeline_id?: number;
  base_status_id?: number;
  rules?: { v1?: Rule; v2?: Rule };
  exp?: Record<string, unknown>;
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

function normalize(body: any) {
  // Fallback-safe extraction for ManyChat IG → { title, handle, text }
  const title =
    body?.message?.title ??
    body?.data?.title ??
    body?.title ??
    'IG Message';
  const handle =
    body?.subscriber?.username ??
    body?.user?.username ??
    body?.sender?.username ??
    body?.handle ??
    '';
  const text =
    body?.message?.text ??
    body?.data?.text ??
    body?.text ??
    body?.message ??
    '';
  return { title, handle, text };
}

function matchRule(text: string, rule?: Rule): boolean {
  if (!rule || !rule.value) return false;
  const t = (text || '').toLowerCase();
  const v = rule.value.toLowerCase();
  if (rule.op === 'equals') return t === v;
  if (rule.op === 'contains') return t.includes(v);
  return false;
}

export async function POST(req: NextRequest) {
  // Optional verification of ManyChat secret if you use it:
  const mcToken = process.env.MC_TOKEN;
  const headerToken = req.headers.get('x-mc-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (mcToken && headerToken && headerToken !== mcToken) {
    return NextResponse.json({ ok: false, error: 'invalid token' }, { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const norm = normalize(payload);

  const username =
    payload?.subscriber?.username ??
    payload?.user?.username ??
    payload?.sender?.username ??
    payload?.username ??
    null;
  const fullName =
    payload?.subscriber?.name ??
    payload?.user?.full_name ??
    payload?.sender?.name ??
    payload?.full_name ??
    payload?.name ??
    null;

  const messagePayload: LatestMessage = {
    id: ++messageCounter,
    receivedAt: Date.now(),
    source: 'webhook:/api/mc/manychat',
    title: norm.title,
    handle: norm.handle || username,
    fullName,
    text: norm.text,
    raw: payload,
  };

  lastMessage = messagePayload;
  if (typeof messagePayload.id === 'number' && Number.isFinite(messagePayload.id)) {
    messageCounter = Math.max(messageCounter, messagePayload.id);
  }

  try {
    await kvWrite.setRaw(MANYCHAT_LATEST_KEY, JSON.stringify(messagePayload));
  } catch {
    // збереження ManyChat-журналу — бест-ефорт; ігноруємо помилки KV
  }

  // Read campaigns via LIST index
  const campaigns = (await kvRead.listCampaigns()) as Campaign[];
  const active = campaigns.filter(c => c.active !== false);

  // Compute matches
  const text = norm.text || '';
  const matches = active.map((c) => {
    const v1 = matchRule(text, c.rules?.v1);
    const v2 = matchRule(text, c.rules?.v2);
    return { id: c.id, name: c.name, v1, v2 };
  }).filter(m => m.v1 || m.v2);

  // (Optional) very light logging to help with diagnostics:
  try {
    const logKey = `logs:mc:${new Date().toISOString().slice(0, 10)}`; // per-day key
    const record = JSON.stringify({ ts: Date.now(), norm, matchesCount: matches.length });
    // Use LPUSH for logs (best-effort; ignore errors)
    await kvWrite.lpush(logKey, record);
  } catch {
    // ignore log errors
  }

  return NextResponse.json({
    ok: true,
    normalized: norm,
    matches,
    totals: { campaigns: campaigns.length, active: active.length },
  });
}

// Optionally allow GET for quick ping/health
export async function GET() {
  if (!lastMessage) {
    try {
      const raw = await kvRead.getRaw(MANYCHAT_LATEST_KEY);
      if (raw) {
        const parsed = coerceLatestMessage(raw);
        if (parsed) {
          lastMessage = parsed;
          if (typeof parsed.id === 'number' && Number.isFinite(parsed.id)) {
            messageCounter = Math.max(messageCounter, parsed.id);
          }
        }
      }
    } catch {
      // якщо KV недоступний — просто повертаємо поточний стан
    }
  }

  const safeMessage = lastMessage ? coerceLatestMessage(lastMessage) : null;
  if (safeMessage) {
    lastMessage = safeMessage;
  } else if (lastMessage) {
    lastMessage = null;
  }

  if (safeMessage && typeof safeMessage.id === 'number' && Number.isFinite(safeMessage.id)) {
    messageCounter = Math.max(messageCounter, safeMessage.id);
  }

  return NextResponse.json({ ok: true, latest: safeMessage ?? null });
}

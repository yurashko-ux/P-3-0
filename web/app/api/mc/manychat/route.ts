// web/app/api/mc/manychat/route.ts
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MC_TOKEN = process.env.MC_TOKEN || process.env.MANYCHAT_TOKEN || '';

function firstStr(...vals: any[]): string | null {
  for (const v of vals) {
    if (v == null) continue;
    const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
    if (s.trim()) return s.trim();
  }
  return null;
}

function okAuth(req: Request, body: any): boolean {
  const bearer = req.headers.get('authorization') || '';
  const token =
    (bearer.startsWith('Bearer ') ? bearer.slice(7) : '') ||
    new URL(req.url).searchParams.get('token') ||
    body?.token ||
    '';
  return !MC_TOKEN || token === MC_TOKEN;
}

function getBaseUrl(req: Request) {
  const url = new URL(req.url);
  const proto = (req.headers.get('x-forwarded-proto') || url.protocol.replace(':', '')).toLowerCase();
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host;
  return `${proto}://${host}`;
}

// Accept POST (ManyChat External Request/Webhook) and GET (quick test)
export async function POST(req: Request) {
  let body: any = {};
  try { body = await req.json(); } catch {}

  if (!okAuth(req, body)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // Try to extract username and text from common ManyChat shapes
  const username =
    firstStr(
      body.username,
      body.user_name,
      body?.contact?.instagram_username,
      body?.contact?.username,
      body?.subscriber?.username,
      body?.subscriber?.instagram_username,
      body?.data?.username,
      body?.user?.username,
      body?.customer?.ig_username,
    ) || '';

  const text =
    firstStr(
      body.text,
      body.message,
      body?.content?.text,
      body?.message?.text,
      body?.last_input,
      body?.last_text_input,
      body?.input,
      body?.data?.text,
      body?.query,
    ) || '';

  const card_id = firstStr(body.card_id, body?.data?.card_id) || undefined;

  if (!username || !text) {
    return NextResponse.json({
      ok: false,
      error: 'missing username or text',
      got: { username, text, card_id, body },
      hint: 'Pass { username, text, [card_id] } or map fields in ManyChat External Request',
    }, { status: 200 });
  }

  // Proxy to the main ingest
  const base = getBaseUrl(req);
  const url = new URL('/api/mc/ingest', base);
  if (MC_TOKEN) url.searchParams.set('token', MC_TOKEN);

  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MC_TOKEN}` },
    body: JSON.stringify({ username, text, ...(card_id ? { card_id } : {}) }),
    // no credentials here – internal server-to-server call
  }).catch((e) => ({ ok: false, status: 500, json: async () => ({ ok: false, error: String(e) }) } as any));

  let ingest: any = null;
  try { ingest = await (resp as any).json?.(); } catch {}

  const out = {
    ok: Boolean(ingest?.ok),
    via: 'manychat',
    normalized: { username, text, ...(card_id ? { card_id } : {}) },
    ingest,
  };
  const status = out.ok ? 200 : 200; // ManyChat prefers 200 to not break the flow
  return NextResponse.json(out, { status });
}

export async function GET(req: Request) {
  // Quick ping: /api/mc/manychat?token=...&username=USER&text=hi[&card_id=...]
  const url = new URL(req.url);
  const q = Object.fromEntries(url.searchParams.entries());
  return POST(new Request(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(q),
  }));
}

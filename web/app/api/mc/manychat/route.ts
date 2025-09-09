// web/app/api/mc/manychat/route.ts
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MC_TOKEN = process.env.MC_TOKEN || process.env.MANYCHAT_TOKEN || '';
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';

function firstStr(...vals: any[]): string | null {
  for (const v of vals) {
    if (v == null) continue;
    const s =
      typeof v === 'string'
        ? v
        : typeof v === 'number'
        ? String(v)
        : ArrayBuffer.isView(v)
        ? Buffer.from(v as any).toString('utf8')
        : '';
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

// --- robust body parser: JSON | form-urlencoded | raw-text-as-query ---
async function parseBody(req: Request): Promise<any> {
  const ct = (req.headers.get('content-type') || '').toLowerCase();
  let raw = '';
  try { raw = await req.text(); } catch {}
  if (!raw) return {};

  if (ct.includes('application/json')) {
    try { return JSON.parse(raw); } catch {}
  }
  if (ct.includes('application/x-www-form-urlencoded')) {
    try {
      const sp = new URLSearchParams(raw);
      const o: any = {};
      sp.forEach((v, k) => (o[k] = v));
      return o;
    } catch {}
  }
  try {
    const sp = new URLSearchParams(raw);
    const o: any = {};
    sp.forEach((v, k) => (o[k] = v));
    if (Object.keys(o).length) return o;
  } catch {}
  try { return JSON.parse(raw); } catch {}
  return {};
}

async function parseJsonSafe(r: Response): Promise<any> {
  try { return await r.json(); } catch {
    try { return JSON.parse(await r.text()); } catch { return null; }
  }
}

// Accept POST (ManyChat) and GET (quick test)
export async function POST(req: Request) {
  const body = await parseBody(req);

  if (!okAuth(req, body)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // normalize typical ManyChat shapes
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
    return NextResponse.json(
      {
        ok: false,
        error: 'missing username or text',
        got: { username, text, card_id, body },
        hint: 'Provide { username, text } via JSON or form-urlencoded.',
      },
      { status: 200 }
    );
  }

  // forward to main ingest (with protection bypass)
  const base = getBaseUrl(req);
  const url = new URL('/api/mc/ingest', base);
  if (MC_TOKEN) url.searchParams.set('token', MC_TOKEN);

  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MC_TOKEN}`,
      ...(BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {}),
    },
    body: JSON.stringify({ username, text, ...(card_id ? { card_id } : {}) }),
    // credentials не потрібні, це s2s
  }).catch((e) => ({ ok: false, status: 500, json: async () => ({ ok: false, error: String(e) }) } as any));

  const ingest = await parseJsonSafe(resp as any);

  return NextResponse.json(
    {
      ok: Boolean(ingest?.ok),
      via: 'manychat',
      normalized: { username, text, ...(card_id ? { card_id } : {}) },
      ingest,
    },
    { status: 200 }
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = Object.fromEntries(url.searchParams.entries());
  return POST(
    new Request(req.url, {
      method: 'POST',
      headers: req.headers,
      body: new URLSearchParams(q as any),
    })
  );
}

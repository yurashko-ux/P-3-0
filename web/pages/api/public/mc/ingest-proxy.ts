import type { NextApiRequest, NextApiResponse } from 'next';

type Data =
  | { ok: true; route: string; allow: string[] }
  | {
      ok: true;
      accepted: any;
      mode: 'keycrm:skipped_stub' | 'forwarded' | 'forward_failed';
      downstream?: { status: number; data: any };
      error?: string;
    }
  | { ok: false; error: string };

function json(res: NextApiResponse, status: number, body: Data) {
  res.status(status).setHeader('content-type', 'application/json');
  res.send(JSON.stringify(body));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Data>) {
  // OPTIONS — ніколи не 405
  if (req.method === 'OPTIONS') {
    res.status(204)
      .setHeader('allow', 'GET,POST,OPTIONS')
      .setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
      .setHeader('access-control-allow-headers', 'content-type,authorization,x-admin-pass')
      .setHeader('access-control-allow-origin', '*')
      .end();
    return;
  }

  // GET — healthcheck
  if (req.method === 'GET') {
    return json(res, 200, { ok: true, route: 'public/mc/ingest-proxy', allow: ['GET','POST','OPTIONS'] });
  }

  if (req.method !== 'POST') {
    res.setHeader('allow', 'GET,POST,OPTIONS');
    return json(res, 405, { ok: false, error: 'Method Not Allowed' });
  }

  // Тіло (підстрахуємо, якщо прийшов рядок)
  let payload: any = req.body ?? {};
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { return json(res, 400, { ok: false, error: 'invalid JSON body' }); }
  }

  const KEYCRM_API_URL = (process.env.KEYCRM_API_URL || '').trim();
  const ADMIN_PASS = (process.env.ADMIN_PASS || process.env.ADMIN_PASSWORD || '').trim();

  // Якщо KEYCRM_API_URL нема — просто не ламаємось
  if (!KEYCRM_API_URL) {
    return json(res, 200, { ok: true, accepted: payload, mode: 'keycrm:skipped_stub' });
  }

  // Форвард на захищений /api/mc/ingest (який у вас уже є в web/app/api/mc/ingest)
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  const host = req.headers.host as string;
  const origin = `${proto}://${host}`;

  try {
    const r = await fetch(`${origin}/api/mc/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(ADMIN_PASS ? { 'x-admin-pass': ADMIN_PASS } : {}),
        'x-forwarded-by': 'public-ingest-proxy',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    let data: any = {};
    try { data = await r.json(); } catch { data = { _note: 'non-JSON downstream' }; }

    return json(res, r.ok ? 200 : r.status, {
      ok: true,
      accepted: payload,
      mode: 'forwarded',
      downstream: { status: r.status, data },
    });
  } catch (err: any) {
    return json(res, 502, {
      ok: true,
      accepted: payload,
      mode: 'forward_failed',
      error: err?.message || 'fetch_failed',
    });
  }
}

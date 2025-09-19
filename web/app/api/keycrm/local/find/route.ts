// web/app/api/keycrm/local/find/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvZRange } from '@/lib/kv';
import { assertAdmin } from '@/lib/auth';

const CARD_KEY   = (id: string | number) => `kc:card:${id}`;
const INDEX_PAIR = (p: number, s: number) => `kc:index:cards:${p}:${s}`;
const INDEX_IG   = (handle: string)     => `kc:index:social:instagram:${handle}`;

export const dynamic = 'force-dynamic';

// --- м'яка авторизація: Bearer ADMIN_PASS або ?pass=
async function ensureAdmin(req: NextRequest) {
  const url = new URL(req.url);
  const passParam = url.searchParams.get('pass');
  const header = req.headers.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expected = process.env.ADMIN_PASS || '';
  if ((expected && bearer === expected) || (expected && passParam === expected)) return true;
  try { await assertAdmin(req); return true; } catch { return false; }
}

function normHandle(s?: string | null) {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  return t.replace(/^@+/, '').toLowerCase();
}

function normStr(s?: string | null) {
  return String(s ?? '').trim().toLowerCase();
}

type Card = {
  id: number;
  title: string;
  pipeline_id: number | null;
  status_id: number | null;
  contact_social_id: string | null;
  contact_full_name: string | null;
  updated_at: string;
};

/** завантажити картку з KV */
async function getCard(id: string | number): Promise<Card | null> {
  const raw = await kvGet<any>(CARD_KEY(id));
  if (!raw) return null;
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as Card;
}

/** пошук за instagram username через індекси; якщо задано пару — фільтруємо */
async function findByUsername(username?: string | null, pipelineId?: number, statusId?: number): Promise<number | null> {
  const h = normHandle(username);
  if (!h) return null;
  const keys = [INDEX_IG(h), INDEX_IG(`@${h}`)];

  for (const key of keys) {
    const ids: string[] = await kvZRange(key, 0, -1).catch(() => []);
    const latestFirst = [...(ids || [])].reverse(); // імітуємо rev
    for (const id of latestFirst) {
      const card = await getCard(id);
      if (!card) continue;
      if (pipelineId && statusId) {
        if (Number(card.pipeline_id) !== pipelineId || Number(card.status_id) !== statusId) continue;
      }
      return Number(card.id);
    }
  }
  return null;
}

/** пошук у межах пари за full_name/title (повільніше, fallback) */
async function findInPairByName(fullname: string, pipelineId: number, statusId: number): Promise<number | null> {
  const indexKey = INDEX_PAIR(pipelineId, statusId);
  const ids: string[] = await kvZRange(indexKey, 0, -1).catch(() => []);
  const latestFirst = [...(ids || [])].reverse();

  const needle = normStr(fullname);
  if (!needle) return null;

  for (const id of latestFirst) {
    const card = await getCard(id);
    if (!card) continue;
    const title = normStr(card.title);
    const fn = normStr(card.contact_full_name);
    if (title.includes(needle) || fn.includes(needle)) {
      return Number(card.id);
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    if (!(await ensureAdmin(req))) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized. Use Authorization: Bearer <ADMIN_PASS> or ?pass=<ADMIN_PASS>' },
        { status: 401 }
      );
    }

    const url = new URL(req.url);
    const username  = url.searchParams.get('username') || undefined;
    const fullname  = url.searchParams.get('fullname') || url.searchParams.get('name') || undefined;
    const pRaw      = url.searchParams.get('pipeline_id') || '';
    const sRaw      = url.searchParams.get('status_id') || '';
    const pipelineId = Number(pRaw) || undefined;
    const statusId   = Number(sRaw) || undefined;

    // 1) якщо є username — спершу через індекси соцмереж
    let found: number | null = await findByUsername(username, pipelineId, statusId);

    // 2) fallback: якщо задано пару і fullname — перебір індексу пари
    if (!found && pipelineId && statusId && fullname) {
      found = await findInPairByName(fullname, pipelineId, statusId);
    }

    // 3) віддаємо також короткий preview картки, якщо знайшли
    let preview: Partial<Card> | null = null;
    if (found) {
      const card = await getCard(found);
      if (card) {
        preview = {
          id: card.id,
          title: card.title,
          pipeline_id: card.pipeline_id,
          status_id: card.status_id,
          contact_social_id: card.contact_social_id,
          contact_full_name: card.contact_full_name,
          updated_at: card.updated_at,
        };
      }
    }

    return NextResponse.json({
      ok: true,
      found_card_id: found,
      preview,
      used: {
        username: username ?? null,
        fullname: fullname ?? null,
        pipeline_id: pipelineId ?? null,
        status_id: statusId ?? null,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 400 }
    );
  }
}

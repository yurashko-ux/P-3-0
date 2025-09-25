// web/app/api/campaigns/route.ts
import { NextResponse, NextRequest } from 'next/server'
import { redis } from '@/lib/redis'

// Нові ключі-списки (щоб обійти старі невірні типи)
const INDEX_MAIN = 'campaigns:index:list'   // LPUSH id
const INDEX_ALT  = 'campaigns:ids:list'     // LPUSH id

// Старі ключі (fallback для читання — раптом там є корисні id)
const OLD_INDEX_A = 'campaigns:index'
const OLD_INDEX_B = 'campaigns:ids'

const ITEM_KEY = (id: string) => `campaigns:item:${id}`

function getAdminToken(req: NextRequest): string | null {
  const h = req.headers.get('x-admin-token')
  if (h && h.trim()) return h.trim()
  const c = req.cookies.get('admin_token')?.value
  return c && c.trim() ? c.trim() : null
}

function guardAdmin(req: NextRequest) {
  const token = getAdminToken(req)
  const pass  = (process.env.ADMIN_PASS || '11111').trim()
  if (!token || token !== pass) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized: missing or invalid admin token' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  return null
}

async function safeLPush(key: string, id: string) {
  try {
    await redis.lpush(key, id)
  } catch {
    // якщо раптом key був не-списком — видаляємо й створюємо список
    try { await redis.del(key) } catch {}
    await redis.lpush(key, id)
  }
}

async function readIds(): Promise<string[]> {
  const a = await redis.lrange(INDEX_MAIN, 0, -1).catch(() => []) as string[]
  const b = await redis.lrange(INDEX_ALT,  0, -1).catch(() => []) as string[]
  // fallback до старих ключів (на випадок, якщо там щось є)
  const oa = await redis.lrange(OLD_INDEX_A, 0, -1).catch(() => []) as string[]
  const ob = await redis.lrange(OLD_INDEX_B, 0, -1).catch(() => []) as string[]

  const seen = new Set<string>()
  const out: string[] = []
  for (const id of [...a, ...b, ...oa, ...ob]) {
    if (id && !seen.has(id)) { seen.add(id); out.push(id) }
  }
  return out
}

export async function GET(req: NextRequest) {
  const unauthorized = guardAdmin(req)
  if (unauthorized) return unauthorized

  try {
    const ids = await readIds()
    const items: any[] = []
    for (const id of ids) {
      const raw = await redis.get(ITEM_KEY(id)).catch(() => null)
      if (!raw) continue
      try { items.push(JSON.parse(raw)) } catch {}
    }
    return NextResponse.json(
      { ok: true, count: items.length, items },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: 'KV read failed', detail: String(e?.message || e) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}

export async function POST(req: NextRequest) {
  const unauthorized = guardAdmin(req)
  if (unauthorized) return unauthorized

  try {
    const body = await req.json().catch(() => ({}))
    const id = Date.now().toString()

    const item = {
      id,
      name: body?.name ?? 'Campaign',
      created_at: Date.now(),
      active: true,
      base_pipeline_id: Number(body?.base_pipeline_id ?? 0),
      base_status_id: Number(body?.base_status_id ?? 0),
      base_pipeline_name: body?.base_pipeline_name ?? null,
      base_status_name: body?.base_status_name ?? null,
      rules: {
        v1: {
          op: (body?.rules?.v1?.op === 'equals' ? 'equals' : 'contains') as 'contains' | 'equals',
          value: String(body?.rules?.v1?.value ?? ''),
        },
        v2: {
          op: (body?.rules?.v2?.op === 'equals' ? 'equals' : 'contains') as 'contains' | 'equals',
          value: String(body?.rules?.v2?.value ?? ''),
        },
      },
      exp: body?.exp ?? {},
      v1_count: 0,
      v2_count: 0,
      exp_count: 0,
    }

    // 1) зберегти сам айтем
    await redis.set(ITEM_KEY(id), JSON.stringify(item))

    // 2) додати id в обидва нові індекси; якщо тип ключа невірний — самовідновлення
    await safeLPush(INDEX_MAIN, id)
    await safeLPush(INDEX_ALT,  id)

    return NextResponse.json(
      { ok: true, id, item },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: 'KV write failed', detail: String(e?.message || e) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}

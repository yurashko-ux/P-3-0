// web/app/api/campaigns/route.ts
import { NextResponse, NextRequest } from 'next/server'
import { redis } from '@/lib/redis'

const INDEX_KEY = 'campaigns:index'              // список id (LPUSH)
const ITEM_KEY  = (id: string) => `campaigns:item:${id}`

function getAdminToken(req: NextRequest): string | null {
  // 1) з заголовка
  const h = req.headers.get('x-admin-token')
  if (h && h.trim()) return h.trim()
  // 2) з куки (middleware має виставляти `admin_token`)
  const c = req.cookies.get('admin_token')?.value
  return c && c.trim() ? c.trim() : null
}

function ensureAdmin(req: NextRequest) {
  const token = getAdminToken(req)
  const pass  = process.env.ADMIN_PASS || '11111'
  if (!token || token !== pass) {
    const r = NextResponse.json({ ok: false, error: 'Unauthorized: missing or invalid admin token' }, { status: 401 })
    r.headers.set('Cache-Control','no-store')
    return r
  }
  return null
}

export async function GET(req: NextRequest) {
  // дозвіл тільки для адміна
  const guard = ensureAdmin(req)
  if (guard) return guard

  try {
    const ids: string[] = await redis.lrange(INDEX_KEY, 0, -1).catch(() => [])
    const items = []
    for (const id of ids) {
      const raw = await redis.get(ITEM_KEY(id)).catch(() => null)
      if (!raw) continue
      try { items.push(JSON.parse(raw)) } catch { /* skip bad */ }
    }
    return NextResponse.json({ ok: true, count: items.length, items }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'KV list failed', detail: String(e?.message || e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  // лише адмін може створювати
  const guard = ensureAdmin(req)
  if (guard) return guard

  try {
    const body = await req.json().catch(() => ({}))
    const id   = Date.now().toString()

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
          op: (body?.rules?.v1?.op === 'equals' ? 'equals' : 'contains') as 'contains'|'equals',
          value: String(body?.rules?.v1?.value ?? ''),
        },
        v2: {
          op: (body?.rules?.v2?.op === 'equals' ? 'equals' : 'contains') as 'contains'|'equals',
          value: String(body?.rules?.v2?.value ?? ''),
        },
      },
      exp: body?.exp ?? {},
      v1_count: 0,
      v2_count: 0,
      exp_count: 0,
    }

    // зберегти
    await redis.set(ITEM_KEY(id), JSON.stringify(item))
    await redis.lpush(INDEX_KEY, id)

    return NextResponse.json({ ok: true, id, item }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'KV write failed', detail: String(e?.message || e) }, { status: 500 })
  }
}

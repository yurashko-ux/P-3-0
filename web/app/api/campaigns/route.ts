// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvSet, kvZAdd, kvZRange } from '@/lib/kv';
import { Campaign, CampaignInput, normalizeCampaign } from '@/lib/types';
import { getPipelineName, getStatusName } from '@/lib/kc-cache';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

const norm = (s?: string | null) => String(s ?? '').trim().toLowerCase();

/** Завантажити всі кампанії з KV (новіші перші) */
async function loadAllCampaigns(): Promise<Campaign[]> {
  // твій kvZRange не має options → беремо як є та робимо reverse для "новіших зверху"
  const ids: string[] = await kvZRange(INDEX, 0, -1).catch(() => []);
  if (!ids?.length) return [];

  const ordered = [...ids].reverse();
  // паралельно витягнемо всі ключі
  const items = await Promise.all(
    ordered.map(async (id) => {
      const raw = await kvGet<any>(KEY(id)).catch(() => null);
      if (!raw) return null;
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return normalizeCampaign(obj);
    })
  );

  return items.filter(Boolean) as Campaign[];
}

/** Збагачення назвами воронки/статусів */
async function enrichNames(c: Campaign): Promise<Campaign> {
  c.base_pipeline_name = await getPipelineName(c.base_pipeline_id);
  c.base_status_name = await getStatusName(c.base_pipeline_id, c.base_status_id);
  if (c.exp) {
    const ep = c.exp;
    (c as any).exp = {
      ...ep,
      to_pipeline_name: await getPipelineName(ep.to_pipeline_id ?? null),
      to_status_name: await getStatusName(ep.to_pipeline_id ?? c.base_pipeline_id, ep.to_status_id ?? null),
    };
  }
  return c;
}

/** Глобальна унікальність V1/V2 серед усіх кампаній; також V1≠V2 всередині кампанії */
function checkGlobalUniqueness(all: Campaign[], candidate: Campaign):
  | { ok: true }
  | { ok: false; message: string } {
  const v1 = norm(candidate.rules?.v1?.value);
  const v2 = norm(candidate.rules?.v2?.value);

  if (v1 && v2 && v1 === v2) {
    return { ok: false, message: 'V1 не може дорівнювати V2 в межах однієї кампанії.' };
  }

  const occupied = new Map<string, string>(); // value → "campaignId:field"
  for (const c of all) {
    if (c.id === candidate.id) continue; // дозволити апдейт власних значень
    const a = norm(c.rules?.v1?.value);
    const b = norm(c.rules?.v2?.value);
    if (a) occupied.set(a, `${c.id}:v1`);
    if (b) occupied.set(b, `${c.id}:v2`);
  }

  const clashes: string[] = [];
  if (v1 && occupied.has(v1)) clashes.push(`V1="${candidate.rules.v1.value}" вже використано (${occupied.get(v1)})`);
  if (v2 && occupied.has(v2)) clashes.push(`V2="${candidate.rules?.v2?.value}" вже використано (${occupied.get(v2)})`);

  if (clashes.length) {
    return {
      ok: false,
      message:
        'Порушення унікальності: ' +
        clashes.join('; ') +
        '. V1/V2 мають бути унікальні глобально серед усіх V1/V2.',
    };
  }
  return { ok: true };
}

export async function GET(req: NextRequest) {
  await assertAdmin(req);

  const all = await loadAllCampaigns();
  const enriched: Campaign[] = [];
  for (const c of all) {
    enriched.push(await enrichNames(c));
  }

  return NextResponse.json(enriched, { status: 200 });
}

export async function POST(req: NextRequest) {
  try {
    await assertAdmin(req);
    const body = (await req.json()) as CampaignInput;

    // нормалізація/дефолти/uuid/лічильники
    const candidate = normalizeCampaign(body);

    // глобальна унікальність V1/V2
    const all = await loadAllCampaigns();
    const unique = checkGlobalUniqueness(all, candidate);
    if (!unique.ok) {
      return NextResponse.json({ error: unique.message }, { status: 400 });
    }

    // зберігаємо повний JSON
    await kvSet(KEY(candidate.id), candidate);

    // індекс за created_at — ⚠️ твоя сигнатура: kvZAdd(key, score, member)
    await kvZAdd(INDEX, candidate.created_at, candidate.id);

    // повернемо зі збагаченими назвами (для UI)
    const withNames = await enrichNames(candidate);
    return NextResponse.json(withNames, { status: 200 });
  } catch (e: any) {
    const msg =
      e?.issues?.[0]?.message ||
      e?.message ||
      'Invalid payload';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

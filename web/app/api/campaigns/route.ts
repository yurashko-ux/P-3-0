// web/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvGet, kvSet, kvZAdd, kvZRange } from '@/lib/kv';
import { Campaign, CampaignInput, normalizeCampaign } from '@/lib/types';
import { getPipelineName, getStatusName } from '@/lib/kc-cache';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

function normVal(s?: string | null) {
  return (s ?? '').trim().toLowerCase();
}

/** Завантажити всі кампанії (повертає вже нормалізовані Campaign) */
async function loadAllCampaigns(): Promise<Campaign[]> {
  const ids: string[] = await kvZRange(INDEX, 0, -1);
  if (!ids?.length) return [];
  const items: Campaign[] = [];
  for (const id of ids) {
    const raw = await kvGet<any>(KEY(id));
    if (!raw) continue;
    const c = normalizeCampaign(typeof raw === 'string' ? JSON.parse(raw) : raw);
    items.push(c);
  }
  // newest first (індекс зростає за created_at, тож просто розвернемо)
  return items.reverse();
}

/** Збагачення назвами з кешу KeyCRM */
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

/** Перевірка глобальної унікальності V1/V2 */
function checkGlobalUniqueness(
  all: Campaign[],
  candidate: Campaign
): { ok: true } | { ok: false; message: string } {
  const candId = candidate.id;
  const v1 = normVal(candidate.rules?.v1?.value);
  const v2 = normVal(candidate.rules?.v2?.value);

  // 1) в межах кампанії
  if (v1 && v2 && v1 === v2) {
    return { ok: false, message: 'V1 не може дорівнювати V2 в межах однієї кампанії.' };
  }

  // 2) глобально між усіма кампаніями (ігноруємо поточну при оновленні)
  const occupied = new Map<string, string>(); // value -> "campaignId:field"
  for (const c of all) {
    if (!c?.rules) continue;
    const id = c.id;
    const a = normVal(c.rules.v1?.value);
    const b = normVal(c.rules.v2?.value);
    if (a) occupied.set(a, `${id}:v1`);
    if (b) occupied.set(b, `${id}:v2`);
  }
  // якщо ми оновлюємо існуючу кампанію — викинемо її власні значення зі списку
  if (candId) {
    const selfV1 = normVal(all.find(x => x.id === candId)?.rules?.v1?.value);
    const selfV2 = normVal(all.find(x => x.id === candId)?.rules?.v2?.value);
    if (selfV1) occupied.delete(selfV1);
    if (selfV2) occupied.delete(selfV2);
  }

  const clashes: string[] = [];
  if (v1 && occupied.has(v1)) clashes.push(`V1="${candidate.rules.v1.value}" вже використано (${occupied.get(v1)})`);
  if (v2 && occupied.has(v2)) clashes.push(`V2="${candidate.rules.v2?.value}" вже використано (${occupied.get(v2)})`);

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
    // гарантуємо дефолти (normalizeCampaign вже поставив rules.v2, лічильники = 0)
    enriched.push(await enrichNames(c));
  }
  return NextResponse.json(enriched, { status: 200 });
}

export async function POST(req: NextRequest) {
  try {
    await assertAdmin(req);
    const body = (await req.json()) as CampaignInput;

    // Нормалізація/дефолти/UUID/лічильники
    const candidate = normalizeCampaign(body);

    // Завантажуємо всі існуючі і перевіряємо унікальність
    const all = await loadAllCampaigns();
    const unique = checkGlobalUniqueness(all, candidate);
    if (!unique.ok) {
      return NextResponse.json({ error: unique.message }, { status: 400 });
    }

    // Зберігаємо повний JSON + оновлюємо індекс за created_at
    await kvSet(KEY(candidate.id), candidate);
    await kvZAdd(INDEX, { score: candidate.created_at, member: candidate.id });

    // Повертаємо вже зі збагаченими назвами
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

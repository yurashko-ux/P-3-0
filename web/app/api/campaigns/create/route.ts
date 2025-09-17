// web/app/api/campaigns/create/route.ts
import { NextRequest } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvSet, kvZAdd } from '@/lib/kv';
import { CampaignInput, normalizeCampaign } from '@/lib/types';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

// ---- helpers: приймаємо JSON, x-www-form-urlencoded, multipart ----
function formDataToObject(fd: FormData) {
  const obj: Record<string, any> = {};
  for (const [k, v] of fd.entries()) obj[k] = typeof v === 'string' ? v : (v as File).name;
  return obj;
}
async function readBody(req: NextRequest): Promise<any> {
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/json')) return req.json();
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    return formDataToObject(await req.formData());
  }
  const txt = await req.text();
  try { return JSON.parse(txt); } catch { return { _raw: txt }; }
}

export async function POST(req: NextRequest) {
  await assertAdmin(req);

  // читаємо «як є», щоб у разі помилки повернути ключі
  const ct = req.headers.get('content-type') || '';
  const rawBody = await readBody(req);

  try {
    const c = normalizeCampaign(rawBody as CampaignInput);

    await kvSet(KEY(c.id), c);
    await kvZAdd(INDEX, c.created_at, c.id);

    return new Response(JSON.stringify(c), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e: any) {
    // детальна діагностика: які саме поля прийшли
    const debug = {
      content_type: ct,
      flat_keys: Object.keys(rawBody ?? {}),
      // найчастіші вкладені варіанти
      sample_rules: {
        'rules.v1': rawBody?.rules?.v1,
        'rules.v2': rawBody?.rules?.v2,
        v1_value: rawBody?.v1_value ?? rawBody?.value ?? rawBody?.value1 ?? rawBody?.['v1.value'],
        v2_value: rawBody?.v2_value ?? rawBody?.value2 ?? rawBody?.['v2.value'],
      },
    };

    const msg = e?.issues?.[0]?.message || e?.message || 'Invalid payload';
    return new Response(JSON.stringify({ error: msg, debug }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
}

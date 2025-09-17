// web/app/api/campaigns/create/route.ts
import { NextRequest } from 'next/server';
import { assertAdmin } from '@/lib/auth';
import { kvSet, kvZAdd } from '@/lib/kv';
import { CampaignInput, normalizeCampaign } from '@/lib/types';

const INDEX = 'campaigns:index';
const KEY = (id: string) => `campaigns:${id}`;

function formDataToObject(fd: FormData) {
  const obj: Record<string, any> = {};
  for (const [k, v] of fd.entries()) {
    obj[k] = typeof v === 'string' ? v : (v as File).name;
  }
  return obj;
}

async function readBody(req: NextRequest): Promise<any> {
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return await req.json();
  }
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    const fd = await req.formData();
    return formDataToObject(fd);
  }
  const txt = await req.text();
  try {
    return JSON.parse(txt);
  } catch {
    return { _raw: txt };
  }
}

export async function POST(req: NextRequest) {
  try {
    await assertAdmin(req);

    const body = (await readBody(req)) as CampaignInput;
    const c = normalizeCampaign(body);

    await kvSet(KEY(c.id), c);
    await kvZAdd(INDEX, c.created_at, c.id);

    return new Response(JSON.stringify(c), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e: any) {
    const msg = e?.issues?.[0]?.message || e?.message || 'Invalid payload';
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
}

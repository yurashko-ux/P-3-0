// web/app/api/debug/kv/route.ts
// — оновлено lrange(): такий самий «розумний» парсер як у lib/kv.ts

import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INDEX_KEY = 'campaign:index';
const ITEM_KEY  = (id: string) => `campaign:${id}`;

function base() { return (process.env.KV_REST_API_URL || '').replace(/\/$/, ''); }
function rdToken() { return process.env.KV_REST_API_READ_ONLY_TOKEN || process.env.KV_REST_API_TOKEN || ''; }
function wrToken() { return process.env.KV_REST_API_TOKEN || ''; }

async function rest(path: string, token: string, init: RequestInit = {}) {
  const url = `${base()}/${path}`;
  const res = await fetch(url, { ...init, headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, cache:'no-store' });
  if (!res.ok) throw new Error(`REST ${path} -> ${res.status}`);
  return res;
}

async function lrange(key: string, token: string, start = 0, stop = -1) {
  try {
    const res = await rest(`lrange/${encodeURIComponent(key)}/${start}/${stop}`, token);
    const txt = await res.text();
    let payload: any = null;
    try { payload = JSON.parse(txt); } catch { payload = txt; }

    let arr: any[] = [];
    if (Array.isArray(payload)) arr = payload;
    else if (payload && Array.isArray(payload.result)) arr = payload.result;
    else if (payload && Array.isArray(payload.data)) arr = payload.data;
    else if (typeof payload === 'string') {
      try {
        const again = JSON.parse(payload);
        if (Array.isArray(again)) arr = again;
        else if (again && Array.isArray(again.result)) arr = again.result;
        else if (again && Array.isArray(again.data)) arr = again.data;
      } catch {}
    }

    return arr.map((x: any) => (typeof x === 'string' ? x : (x?.value ?? x?.member ?? x?.id ?? ''))).filter(Boolean);
  } catch (e) {
    return { error: String(e) };
  }
}

async function getRaw(key: string, token: string) {
  try { const res = await rest(`get/${encodeURIComponent(key)}`, token); return await res.text(); }
  catch { return null; }
}
async function setRaw(key: string, value: string, token: string) {
  await rest(`set/${encodeURIComponent(key)}`, token, { method:'POST', body:value });
}
async function lpush(key: string, value: string, token: string) {
  await rest(`lpush/${encodeURIComponent(key)}`, token, { method:'POST', body: JSON.stringify({ value }) });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const doSeed = url.searchParams.get('seed') === '1';

  const has = {
    KV_REST_API_URL: Boolean(process.env.KV_REST_API_URL),
    KV_REST_API_TOKEN: Boolean(process.env.KV_REST_API_TOKEN),
    KV_REST_API_READ_ONLY_TOKEN: Boolean(process.env.KV_REST_API_READ_ONLY_TOKEN),
  };

  const idsRO = await lrange(INDEX_KEY, rdToken());
  const idsWR = await lrange(INDEX_KEY, wrToken());

  let seeded: any = null;
  if (doSeed && wrToken()) {
    try {
      const id = Date.now().toString();
      const item = { id, name:'UI-created', created_at:Number(id), active:false,
        base_pipeline_id:null, base_status_id:null,
        rules:{ v1:{op:'contains', value:'ціна'}, v2:{op:'equals', value:'привіт'} },
        v1_count:0, v2_count:0, exp_count:0, deleted:false };
      await setRaw(ITEM_KEY(id), JSON.stringify(item), wrToken());
      await lpush(INDEX_KEY, id, wrToken());
      seeded = { ok:true, id };
    } catch (e:any) { seeded = { ok:false, error:e?.message||String(e) }; }
  }

  let sample: any[] = [];
  if (Array.isArray(idsRO)) {
    for (const id of idsRO.slice(0,3)) {
      const raw = await getRaw(ITEM_KEY(String(id)), rdToken());
      if (!raw) continue;
      try { const obj = JSON.parse(raw); sample.push({ id: String(id), name: obj.name, active: !!obj.active }); } catch {}
    }
  }

  return NextResponse.json({ ok:true, time:new Date().toISOString(), env:has, idsRO, idsWR, sample, seeded });
}

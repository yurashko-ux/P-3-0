// web/app/api/keycrm/sync/pair/route.ts
// Minimal webhook to route incoming MC/IG messages by active campaign rules and bump counters.
// Accepts:
//  - normalized: { title?: string, handle?: string, text?: string }
//  - ManyChat-ish: { event, data: { user: { username }, message: { text } } }  (best-effort extraction)
//
// Response: { ok, matched?: boolean, route?: 'v1'|'v2'|'none', campaign?: { id, name }, input: { title, handle, text } }

import { NextRequest, NextResponse } from 'next/server';
import { kvRead, kvWrite, campaignKeys } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Rule = { op: 'contains' | 'equals'; value: string };
type Campaign = {
  id: string;
  name: string;
  active?: boolean;
  rules?: { v1?: Rule; v2?: Rule };
  v1_count?: number;
  v2_count?: number;
  exp_count?: number;
};

// ----- helpers -----

function normStr(s: unknown) {
  return (typeof s === 'string' ? s : '').trim();
}

function extractNormalized(body: any) {
  // already normalized?
  const title = normStr(body?.title);
  const handle = normStr(body?.handle);
  const text = normStr(body?.text);

  if (title || handle || text) {
    return { title, handle, text };
  }

  // ManyChat-ish best effort
  const mcText = normStr(body?.data?.message?.text) || normStr(body?.message?.text);
  const mcHandle = normStr(body?.data?.user?.username) || normStr(body?.user?.username);
  return { title: '', handle: mcHandle, text: mcText };
}

const VALUE_KEYS = ['value', 'label', 'text', 'title', 'name', 'id', 'key', 'code'];

function normalizeCandidate(value: unknown, depth = 5): string {
  if (depth <= 0 || value == null) return '';

  if (typeof value === 'string') {
    let s = value.trim();
    if (!s) return '';

    // значення можуть бути JSON-рядками або задубльованими лапками – розпарсимо їх рекурсивно
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      try {
        const parsed = JSON.parse(s);
        const cand = normalizeCandidate(parsed, depth - 1);
        if (cand) return cand;
      } catch {}
    }

    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      const unquoted = s.slice(1, -1);
      const cand = normalizeCandidate(unquoted, depth - 1);
      if (cand) return cand;
    }

    return s;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const cand = normalizeCandidate(item, depth - 1);
      if (cand) return cand;
    }
    return '';
  }

  if (typeof value === 'object') {
    for (const key of VALUE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const cand = normalizeCandidate((value as any)[key], depth - 1);
        if (cand) return cand;
      }
    }
    for (const v of Object.values(value as Record<string, unknown>)) {
      const cand = normalizeCandidate(v, depth - 1);
      if (cand) return cand;
    }
    return '';
  }

  return String(value);
}

function matchRule(inputs: string[], rule?: Rule): boolean {
  if (!rule || rule.value === undefined || rule.value === null) return false;
  const needle = normalizeCandidate(rule.value).trim().toLowerCase();
  if (!needle) return false;
  return inputs.some(input => {
    const hay = normalizeCandidate(input).trim().toLowerCase();
    if (!hay) return false;
    const op = String(rule.op || 'contains').toLowerCase();
    if (op === 'equals') return hay === needle;
    // default contains
    return hay.includes(needle);
  });
}

function chooseRoute(inputs: string[], rules?: { v1?: Rule; v2?: Rule }): 'v1' | 'v2' | 'none' {
  const r1 = matchRule(inputs, rules?.v1);
  const r2 = matchRule(inputs, rules?.v2);
  if (r1 && !r2) return 'v1';
  if (r2 && !r1) return 'v2';
  // якщо збігаються обидва або жоден — не вирішуємо (можна додати пріоритети пізніше)
  if (r1 && r2) return 'v1'; // простий пріоритет v1, щоб не губити подію
  return 'none';
}

async function bumpCounter(id: string, field: 'v1_count' | 'v2_count' | 'exp_count') {
  const itemKey = campaignKeys.ITEM_KEY(id);
  const raw = await kvRead.getRaw(itemKey);
  if (!raw) return;
  try {
    const obj = JSON.parse(raw);
    obj[field] = (typeof obj[field] === 'number' ? obj[field] : 0) + 1;
    await kvWrite.setRaw(itemKey, JSON.stringify(obj));
    // необов’язково: кладемо id в head, щоб кампанія піднімалась у списку
    try { await kvWrite.lpush(campaignKeys.INDEX_KEY, id); } catch {}
  } catch {}
}

// ----- route handler -----

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const norm = extractNormalized(body);

    // 1) беремо всі кампанії та фільтруємо активні
    let campaigns: Campaign[] = [];
    try {
      campaigns = await kvRead.listCampaigns() as any;
    } catch {
      campaigns = [];
    }
    const active = campaigns.filter(c => c?.active !== false);

    // 2) спроба знайти першу, що матчить
    let chosen: { route: 'v1'|'v2'|'none', campaign?: Campaign } = { route: 'none' };
    const candidates = [norm.text, norm.title, norm.handle].filter(Boolean);
    for (const c of active) {
      const route = chooseRoute(candidates, c.rules);
      if (route !== 'none') {
        chosen = { route, campaign: c };
        break;
      }
    }

    // 3) якщо знайшли — інкрементуємо лічильник
    if (chosen.campaign && chosen.route !== 'none') {
      await bumpCounter(chosen.campaign.id, chosen.route === 'v1' ? 'v1_count' : 'v2_count');
    }

    // TODO (next step): тут же викликати KeyCRM API для створення/руху картки
    return NextResponse.json({
      ok: true,
      matched: chosen.route !== 'none',
      route: chosen.route,
      campaign: chosen.campaign ? { id: chosen.campaign.id, name: chosen.campaign.name } : undefined,
      input: norm,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'pair failed' }, { status: 500 });
  }
}

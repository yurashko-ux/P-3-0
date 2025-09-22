// web/app/api/keycrm/sync/pair/route.ts
// Sync pair: pick active campaign by V1/V2 rules, find/move card in KeyCRM base pipeline/status.
// MOCK-first (ENABLE_REAL_KC env toggles real calls in lib/keycrm).

import { NextResponse } from 'next/server';
import { kcFindCardIdByAny, kcMoveCard } from '@/lib/keycrm';
import { CampaignWithNames } from '@/lib/types';

// ---- helpers ----

type AnyObj = Record<string, any>;
const dynamicOk = { headers: { 'Cache-Control': 'no-store' } };
export const dynamic = 'force-dynamic';

function s(v: any): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Accepts ManyChat-like payload OR already-mapped object; returns { title, handle? } + text? */
function mapInputToTitleHandle(input: AnyObj): { title: string; handle?: string; text?: string } {
  // our /api/map/ig format
  if (s(input.title) || s(input.handle)) {
    return { title: s(input.title)!, handle: s(input.handle), text: s(input.text) };
  }
  // direct ManyChat payload (per user's spec)
  const username = s(input.username);
  const text = s(input.text);
  const fullName =
    s(input.full_name) ||
    s(input.name) ||
    (s(input.first_name) || s(input.last_name)
      ? [s(input.first_name), s(input.last_name)].filter(Boolean).join(' ')
      : undefined);
  const title = fullName || username || '';
  if (!title) throw new Error('Input must include at least full_name/name or username');
  const out: { title: string; handle?: string; text?: string } = { title };
  if (username) out.handle = username;
  if (text) out.text = text;
  return out;
}

function matches(rule: { op?: 'contains' | 'equals'; value?: string } | undefined, title: string) {
  const v = s(rule?.value) || '';
  if (!v) return false;
  const t = title.trim();
  const op = rule?.op || 'contains';
  if (op === 'equals') return t.toLowerCase() === v.toLowerCase();
  return t.toLowerCase().includes(v.toLowerCase());
}

/** pick active campaign by V1/V2 contains rules; V1 has priority if both match */
function chooseCampaign(camps: CampaignWithNames[], title: string) {
  const active = (camps || []).filter((c) => !!c.active);
  let chosen: CampaignWithNames | null = null;
  let matched: 'v1' | 'v2' | 'none' = 'none';

  for (const c of active) {
    if (matches(c.rules?.v1, title)) {
      chosen = c; matched = 'v1'; break;
    }
  }
  if (!chosen) {
    for (const c of active) {
      if (matches(c.rules?.v2, title)) {
        chosen = c; matched = 'v2'; break;
      }
    }
  }
  // fallback: first active campaign (if any) even if no v1/v2 match
  if (!chosen && active[0]) {
    chosen = active[0]; matched = 'none';
  }
  return { chosen, matched };
}

// ---- route handlers ----

export async function POST(req: Request) {
  const started = Date.now();
  try {
    const body = (await req.json().catch(() => ({}))) as AnyObj;
    const input = Array.isArray(body) ? body[0] ?? {} : body ?? {};
    const mapped = mapInputToTitleHandle(input); // { title, handle?, text? }

    // fetch campaigns (reusing our own GET API)
    const res = await fetch(`${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''}/api/campaigns`, {
      cache: 'no-store',
      // Ensure local call also works when no VERCEL_URL – relative fetch in Next is allowed:
      // We'll try relative if absolute fails.
    }).catch(() => null);

    let campaigns: CampaignWithNames[] = [];
    try {
      if (res?.ok) {
        campaigns = (await res.json()) as CampaignWithNames[];
      } else {
        // Try relative path as a fallback (works in Next route runtime)
        const rel = await fetch('/api/campaigns', { cache: 'no-store' }).catch(() => null);
        if (rel?.ok) campaigns = (await rel.json()) as CampaignWithNames[];
      }
    } catch { /* ignore */ }

    const { chosen, matched } = chooseCampaign(campaigns, mapped.title);
    if (!chosen) {
      return NextResponse.json(
        { ok: false, error: 'No active campaign found', mapped, took_ms: Date.now() - started },
        { status: 404, ...dynamicOk }
      );
    }

    // Build search args for KeyCRM
    const searchArgs = {
      username: mapped.handle,
      fullname: mapped.title,
      pipeline_id: chosen.base_pipeline_id,
      status_id: chosen.base_status_id,
      per_page: 50,
      max_pages: 3,
    };

    const cardId = (await kcFindCardIdByAny(searchArgs).catch(() => null)) as number | null;

    let move: { ok: true } | null = null;
    if (cardId) {
      // move to base pair (safe even if already in-place)
      move = await kcMoveCard({
        id: cardId,
        pipeline_id: chosen.base_pipeline_id,
        status_id: chosen.base_status_id,
      }).catch(() => null);
    }

    return NextResponse.json(
      {
        ok: !!cardId,
        matched_rule: matched,
        chosen: {
          id: chosen.id,
          name: chosen.name,
          base_pipeline_id: chosen.base_pipeline_id,
          base_status_id: chosen.base_status_id,
        },
        searchArgs,
        result: { cardId, move },
        mapped,
        took_ms: Date.now() - started,
      },
      dynamicOk
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e), took_ms: Date.now() - started },
      { status: 400, ...dynamicOk }
    );
  }
}

export async function GET() {
  // lightweight self-doc
  return NextResponse.json(
    {
      ok: true,
      expects: { title: 'Full Name', handle: 'ig_username (optional)' },
      example_in: {
        username: 'viktoriak',
        text: 'hello',
        full_name: 'Viktoria Kolachnyk',
        name: 'Viktoria Kolachnyk',
        first_name: 'Viktoria',
        last_name: 'Kolachnyk',
      },
    },
    dynamicOk
  );
}
